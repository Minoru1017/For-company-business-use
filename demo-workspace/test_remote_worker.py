#!/usr/bin/env python3
"""End-to-end: company-side client ↔ in-process Worker server (WhisperX replaced by a fake runner)."""
import json
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest import mock

import demo_core
import progress_tracker
import remote_transcribe
import security
import worker_server
from transcribe_modes import MODE_REMOTE, requires_cloud_consent, validate_transcribe_request

TOKEN = "test-worker-token-0123456789abcdef"
FAKE_SRT = "1\n00:00:00,000 --> 00:00:01,000\n[SPEAKER_00] 你好\n\n2\n00:00:01,000 --> 00:00:02,000\n[SPEAKER_01] 哈囉\n"


def fake_runner(job, log, hooks, state):
    log(">>Performing transcription...")
    log("Progress: 50%")
    log(">>Performing alignment...")
    log(">>Performing diarization...")
    for _ in range(20):
        if hooks.is_cancelled():
            return demo_core.CANCEL_EXIT
        time.sleep(0.01)
    srt = job.dir / f"{job.audio.stem}.srt"
    srt.write_text(FAKE_SRT, encoding="utf-8")
    job.srt = srt
    return 0


def failing_runner(job, log, hooks, state):
    log("[錯誤] CUDA out of memory")
    return 3


class WorkerServerFixture:
    def __init__(self, runner, gpu=None):
        self.tmp = tempfile.TemporaryDirectory()
        self.patches = [
            mock.patch.object(worker_server, "WORKER_DIR", Path(self.tmp.name) / "worker"),
            mock.patch.object(demo_core, "WHISPERX", Path(self.tmp.name) / "whisperx.exe"),
            mock.patch.object(demo_core, "VENV_PY", Path(self.tmp.name) / "venv-python.exe"),
            mock.patch.object(demo_core, "has_valid_token", lambda: True),
        ]
        for p in self.patches:
            p.start()
        (Path(self.tmp.name) / "venv-python.exe").write_text("")
        self.state = worker_server.WorkerState(token=TOKEN, runner=runner, gpu=gpu or {"available": True, "name": "NVIDIA GeForce RTX 5070"})
        self.server = worker_server.make_server(self.state, "127.0.0.1", 0)
        self.port = self.server.server_address[1]
        self.url = f"http://127.0.0.1:{self.port}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()


class WorkerEndToEndTest(unittest.TestCase):
    def setUp(self):
        self.fx = WorkerServerFixture(fake_runner)
        self.addCleanup(self.fx.close)
        self.work = tempfile.TemporaryDirectory()
        self.addCleanup(self.work.cleanup)
        self.audio = Path(self.work.name) / "demo call.wav"
        self.audio.write_bytes(b"RIFF" + b"\0" * (3 * 1024 * 1024))
        self.out = Path(self.work.name) / "out" / "demo call.srt"

    def test_health_requires_token(self):
        req = urllib.request.Request(f"{self.fx.url}/worker/health")
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req, timeout=5)
        self.assertEqual(ctx.exception.code, 401)
        with self.assertRaises(remote_transcribe.WorkerError):
            remote_transcribe.fetch_health(self.fx.url, "wrong-token-wrong-token")

    def test_banner_without_token(self):
        with urllib.request.urlopen(f"{self.fx.url}/", timeout=5) as resp:
            self.assertIn("Call Coach Worker", resp.read().decode("utf-8"))

    def test_health_reports_gpu(self):
        health = remote_transcribe.fetch_health(self.fx.url, TOKEN)
        self.assertTrue(health["gpu_available"])
        self.assertEqual(health["gpu"], "NVIDIA GeForce RTX 5070")
        self.assertEqual(health["device"], "cuda")
        self.assertEqual(health["compute_type"], "float16")
        self.assertEqual(health["model"], "large-v3")
        self.assertFalse(health["busy"])

    def test_full_round_trip_with_progress(self):
        logs = []
        progress = progress_tracker.ProgressTracker(logs.append, mode="remote", plan="remote")
        progress.phase("extract")
        code = remote_transcribe.run_remote_transcribe(
            self.audio,
            self.out,
            worker_url=self.fx.url + "/",
            token=TOKEN,
            duration_s=48 * 60,
            log=logs.append,
            cancel_check=lambda: False,
            progress=progress,
            sleep=lambda s: time.sleep(0.02),
        )
        self.assertEqual(code, 0, logs)
        self.assertEqual(self.out.read_text(encoding="utf-8"), FAKE_SRT)
        human = [l for l in logs if not l.startswith(progress_tracker.PROGRESS_PREFIX)]
        joined = "\n".join(human)
        self.assertIn("RTX 5070", joined)
        self.assertIn("上傳完成", joined)
        self.assertIn(">>Performing diarization", joined)
        self.assertIn("預估總耗時", joined)
        # progress went through upload and transcribe phases; WhisperX markers were parsed for part 0
        snap = progress.to_dict()
        self.assertEqual([p["key"] for p in snap["phases"]], ["extract", "upload", "transcribe", "save"])
        self.assertEqual(snap["phase_index"], 2)
        self.assertIn(snap["parts"][0]["step"], ("diarize", "write"))
        self.assertTrue(snap["parts"][0]["done"])
        # worker cleaned up after the client deleted the job
        time.sleep(0.05)
        self.assertEqual(self.fx.state.jobs, {})
        self.assertEqual(self.fx.state.done_count, 1)

    def test_remote_failure_surfaces_worker_log(self):
        fx = WorkerServerFixture(failing_runner)
        self.addCleanup(fx.close)
        logs = []
        code = remote_transcribe.run_remote_transcribe(
            self.audio,
            self.out,
            worker_url=fx.url,
            token=TOKEN,
            log=logs.append,
            cancel_check=lambda: False,
            sleep=lambda s: time.sleep(0.02),
        )
        self.assertEqual(code, 3)
        self.assertFalse(self.out.exists())
        self.assertTrue(any("CUDA out of memory" in l for l in logs))
        self.assertTrue(any(l.startswith("[錯誤] 遠端轉錄失敗") for l in logs))

    def test_cancel_during_poll_cancels_remote_job(self):
        logs = []
        polls = {"n": 0}

        def cancel_check():
            return polls["n"] >= 2

        def sleep(_s):
            polls["n"] += 1
            time.sleep(0.02)

        def slow_runner(job, log, hooks, state):
            time.sleep(0.5)
            return demo_core.CANCEL_EXIT if hooks.is_cancelled() else 1

        slow = WorkerServerFixture(slow_runner)
        self.addCleanup(slow.close)
        code = remote_transcribe.run_remote_transcribe(
            self.audio, self.out, worker_url=slow.url, token=TOKEN, log=logs.append, cancel_check=cancel_check, sleep=sleep
        )
        self.assertEqual(code, remote_transcribe.CANCEL_EXIT)
        self.assertTrue(any("[已取消]" in l for l in logs))

    def test_wrong_token_fails_fast(self):
        logs = []
        code = remote_transcribe.run_remote_transcribe(
            self.audio, self.out, worker_url=self.fx.url, token="not-the-right-token-at-all", log=logs.append, cancel_check=lambda: False
        )
        self.assertEqual(code, 1)
        self.assertTrue(any("Token 不正確" in l for l in logs))

    def test_unreachable_host_gives_hint(self):
        logs = []
        code = remote_transcribe.run_remote_transcribe(
            self.audio, self.out, worker_url="http://127.0.0.1:9", token=TOKEN, log=logs.append, cancel_check=lambda: False
        )
        self.assertEqual(code, 1)
        self.assertTrue(any("無法連線遠端主機" in l and "Tailscale" in l for l in logs))

    def test_upload_rejects_when_worker_not_installed(self):
        with mock.patch.object(demo_core, "WHISPERX", Path(self.work.name) / "nope.exe"), mock.patch.object(
            demo_core, "VENV_PY", Path(self.work.name) / "nope-python.exe"
        ):
            req = urllib.request.Request(
                f"{self.fx.url}/worker/jobs",
                data=b"x" * 1024,
                method="POST",
                headers={security.WORKER_TOKEN_HEADER: TOKEN, "X-Job-Name": "a.wav"},
            )
            with self.assertRaises(urllib.error.HTTPError) as ctx:
                urllib.request.urlopen(req, timeout=5)
            self.assertEqual(ctx.exception.code, 503)
            self.assertIn("WhisperX", json.loads(ctx.exception.read())["message"])

    def test_max_upload_bytes_video_vs_audio(self):
        self.assertGreater(worker_server._max_upload_bytes("demo.mp4"), security.WORKER_MAX_AUDIO_BYTES)
        self.assertEqual(worker_server._max_upload_bytes("a.wav"), security.WORKER_MAX_AUDIO_BYTES)

    def test_job_name_sanitised_and_unknown_job_404(self):
        self.assertEqual(worker_server.safe_job_name("../../etc/passwd"), "passwd")
        self.assertEqual(worker_server.safe_job_name("bad|name.wav"), "audio.wav")
        self.assertEqual(worker_server.safe_job_name("DEMO 2026-09-14.wav"), "DEMO 2026-09-14.wav")
        status, body = remote_transcribe._request("GET", f"{self.fx.url}/worker/jobs/{'0' * 32}", TOKEN, timeout=5)
        self.assertEqual(status, 404)


class RemoteModeTest(unittest.TestCase):
    def test_consent_and_config_required(self):
        self.assertTrue(requires_cloud_consent(MODE_REMOTE))
        self.assertIn("知情同意", validate_transcribe_request(MODE_REMOTE, False, False, True))
        self.assertIn("遠端主機", validate_transcribe_request(MODE_REMOTE, True, False, False))
        self.assertIsNone(validate_transcribe_request(MODE_REMOTE, True, False, True))

    def test_estimate_remote_minutes(self):
        low, high = progress_tracker.estimate_remote_minutes(48 * 60, gpu=True)
        self.assertLessEqual(low, 5)
        self.assertLessEqual(high, 10)
        cpu_low, cpu_high = progress_tracker.estimate_remote_minutes(48 * 60, gpu=False)
        self.assertGreater(cpu_low, high)
        self.assertGreater(cpu_high, cpu_low)

    def test_remote_plan_exists(self):
        keys = [k for k, _, _ in progress_tracker.MODE_PHASES["remote"]]
        self.assertEqual(keys, ["extract", "upload", "transcribe", "save"])
        self.assertEqual(sum(w for _, _, w in progress_tracker.MODE_PHASES["remote"]), 100)


class WorkerConfigTest(unittest.TestCase):
    def test_normalize_worker_url(self):
        self.assertEqual(demo_core.normalize_worker_url(" http://100.64.0.2:8766/ "), "http://100.64.0.2:8766")
        self.assertEqual(demo_core.normalize_worker_url("https://worker.example.com"), "https://worker.example.com")
        for bad in ("", "ftp://x", "100.64.0.2:8766", "http://host:8766/worker/health", "http://a b"):
            with self.assertRaises(ValueError, msg=bad):
                demo_core.normalize_worker_url(bad)

    def test_save_and_read_worker_config(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with mock.patch.object(demo_core, "ROOT", root):
                with self.assertRaises(ValueError):
                    demo_core.save_worker_config("http://100.64.0.2:8766", "short")
                demo_core.save_worker_config("http://100.64.0.2:8766/", TOKEN)
                self.assertEqual(demo_core.worker_config(), ("http://100.64.0.2:8766", TOKEN))
                self.assertTrue(demo_core.has_worker_config())
                self.assertEqual(demo_core.default_transcribe_mode(), MODE_REMOTE)
                self.assertTrue(demo_core.get_status().to_dict()["worker_ok"])

    def test_ensure_worker_token_persists(self):
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(demo_core, "ROOT", Path(tmp)):
                first = demo_core.ensure_worker_token(log=lambda _m: None)
                self.assertGreaterEqual(len(first), security.WORKER_TOKEN_MIN_LEN)
                self.assertEqual(demo_core.ensure_worker_token(log=lambda _m: None), first)

    def test_worker_token_matches(self):
        self.assertTrue(security.worker_token_matches(TOKEN, TOKEN))
        self.assertFalse(security.worker_token_matches(TOKEN, TOKEN + "x"))
        self.assertFalse(security.worker_token_matches("short", "short"))
        self.assertFalse(security.worker_token_matches("", ""))


if __name__ == "__main__":
    unittest.main()
