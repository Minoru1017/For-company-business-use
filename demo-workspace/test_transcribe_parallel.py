#!/usr/bin/env python3
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import transcribe_parallel as tp
from transcribe_parallel import (
    CANCEL_EXIT,
    MAX_CHUNKS,
    chunk_count_for_duration,
    estimate_transcribe_minutes,
    max_parallel_workers,
    memory_safe_parallel,
    run_parallel_transcribe,
)

SRT_ONE = "1\n00:00:01,000 --> 00:00:02,000\n[SPEAKER_00] hi\n"


class ChunkPlanTest(unittest.TestCase):
    def test_short_file_is_not_split(self):
        self.assertEqual(chunk_count_for_duration(10 * 60, parallel=3), 1)
        self.assertEqual(chunk_count_for_duration(20 * 60, parallel=3), 1)

    def test_chunks_are_balanced_against_workers(self):
        # 48 min on 2 workers → 2 × 24 min in a single wave, not 3 chunks with a
        # lonely third chunk running after the first two.
        self.assertEqual(chunk_count_for_duration(48 * 60, parallel=2), 2)
        self.assertEqual(chunk_count_for_duration(48 * 60, parallel=3), 3)
        self.assertEqual(chunk_count_for_duration(100 * 60, parallel=2), 4)
        self.assertEqual(chunk_count_for_duration(125 * 60, parallel=3), 6)
        self.assertEqual(chunk_count_for_duration(600 * 60, parallel=3), MAX_CHUNKS)

    def test_single_worker_keeps_single_file_path(self):
        self.assertEqual(chunk_count_for_duration(48 * 60, parallel=1), 1)

    def test_estimate_eta(self):
        low, high = estimate_transcribe_minutes(48 * 60, 3, 3)
        self.assertGreaterEqual(low, 10)
        self.assertGreater(high, low)


class ParallelCapTest(unittest.TestCase):
    def test_memory_safe_parallel(self):
        self.assertEqual(memory_safe_parallel(15.8, "medium"), 2)
        self.assertEqual(memory_safe_parallel(15.8, "small"), 4)
        self.assertEqual(memory_safe_parallel(7.8, "medium"), 1)
        self.assertEqual(memory_safe_parallel(31.6, "medium"), 6)
        # unknown RAM → conservative default
        self.assertEqual(memory_safe_parallel(0.0, "medium"), 2)

    def test_default_cap_respects_ram(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("CALL_COACH_MAX_PARALLEL", None)
            self.assertEqual(max_parallel_workers(5, "medium", total_gb=15.8), 2)
            self.assertEqual(max_parallel_workers(5, "small", total_gb=15.8), 3)
            self.assertEqual(max_parallel_workers(5, "medium", total_gb=31.6), 3)
            self.assertEqual(max_parallel_workers(2, "medium", total_gb=31.6), 2)

    def test_env_override_bypasses_ram_cap(self):
        with patch.dict(os.environ, {"CALL_COACH_MAX_PARALLEL": "3"}):
            self.assertEqual(max_parallel_workers(5, "medium", total_gb=15.8), 3)
        with patch.dict(os.environ, {"CALL_COACH_MAX_PARALLEL": "99"}):
            self.assertEqual(max_parallel_workers(8, "medium", total_gb=64), tp.HARD_MAX_PARALLEL)

    def test_total_memory_gb_reads_something(self):
        self.assertGreaterEqual(tp.total_memory_gb(), 0.0)
        with patch.dict(os.environ, {"CALL_COACH_RAM_GB": "16"}):
            self.assertEqual(tp.total_memory_gb(), 16.0)


class _Harness:
    """Fake run_command that writes SRTs for chunks and fails on demand."""

    def __init__(self, fail_first: set[int] | None = None, crash_always: set[int] | None = None):
        self.fail_first = set(fail_first or ())
        self.crash_always = set(crash_always or ())
        self.calls: list[list[str]] = []
        self.threads_seen: list[int] = []
        self.batches_seen: list[int] = []

    def __call__(self, cmd, log=None, **_k):
        self.calls.append(cmd)
        out_dir = Path(cmd[cmd.index("--output_dir") + 1])
        idx = int(out_dir.name.split("_")[1])
        self.threads_seen.append(int(cmd[cmd.index("--threads") + 1]))
        self.batches_seen.append(int(cmd[cmd.index("--batch_size") + 1]))
        if idx in self.crash_always:
            return 3221225477  # 0xC0000005
        if idx in self.fail_first:
            self.fail_first.discard(idx)
            return 1
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / f"chunk_{idx:03d}.srt").write_text(SRT_ONE, encoding="utf-8")
        return 0


class RunParallelTest(unittest.TestCase):
    def _run(self, run_command, chunk_count=2, cancel_check=lambda: False, hooks=None):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            wav = root / "demo.mp4"
            wav.write_bytes(b"\x00" * 64)
            parts = []
            for i in range(chunk_count):
                p = root / f"chunk_{i:03d}.wav"
                p.write_bytes(b"\x00" * 64)
                parts.append((p, i * 1440.0))
            out = root / "output"
            final = out / "demo.srt"
            logs: list[str] = []

            with patch("transcribe_parallel.split_audio_chunks", return_value=parts), patch(
                "transcribe_parallel.probe_duration_seconds", return_value=48 * 60.0
            ):
                code = run_parallel_transcribe(
                    audio=wav,
                    chunk_count=chunk_count,
                    ffmpeg="ffmpeg",
                    work_root=out,
                    output_dir=out,
                    final_srt=final,
                    whisperx_cmd=["whisperx"],
                    model="medium",
                    default_threads=8,
                    batch=8,
                    env_vars={},
                    run_command=run_command,
                    log=logs.append,
                    hooks=hooks,
                    cancel_check=cancel_check,
                    parallel=2,
                )
            return code, logs, final.is_file(), (out / ".chunks").exists()

    def test_success_merges_and_cleans_up(self):
        h = _Harness()
        code, logs, has_srt, chunks_left = self._run(h)
        self.assertEqual(code, 0)
        self.assertTrue(has_srt)
        self.assertFalse(chunks_left, "chunk scratch dir should be removed after success")
        self.assertTrue(any("最多 2 段同時跑" in line for line in logs))
        self.assertTrue(any("2/2 段已完成" in line for line in logs))

    def test_failed_chunk_is_retried_alone_with_full_threads(self):
        h = _Harness(fail_first={1})
        code, logs, has_srt, _ = self._run(h)
        self.assertEqual(code, 0)
        self.assertTrue(has_srt)
        self.assertEqual(len(h.calls), 3)
        # first wave: half the threads; retry: all threads, half the batch
        self.assertEqual(h.threads_seen[-1], 8)
        self.assertEqual(h.batches_seen[-1], 4)
        self.assertTrue(any("重試成功" in line for line in logs))

    def test_persistent_crash_reports_error_and_keeps_scratch(self):
        h = _Harness(crash_always={0})
        code, logs, has_srt, chunks_left = self._run(h)
        self.assertEqual(code, 1)
        self.assertFalse(has_srt)
        self.assertTrue(chunks_left, "keep chunk output for troubleshooting")
        self.assertTrue(any(line.startswith("[錯誤]") for line in logs))

    def test_cancel_kills_all_and_returns_130(self):
        class Hooks:
            killed = 0

            def kill_all(self):
                Hooks.killed += 1

        state = {"cancel": False}

        def run_command(cmd, log=None, **_k):
            state["cancel"] = True
            return CANCEL_EXIT

        code, _logs, has_srt, _ = self._run(
            run_command, cancel_check=lambda: state["cancel"], hooks=Hooks()
        )
        self.assertEqual(code, CANCEL_EXIT)
        self.assertFalse(has_srt)


if __name__ == "__main__":
    unittest.main()
