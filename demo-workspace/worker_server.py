"""Worker mode: turn a spare machine (e.g. a home PC with an NVIDIA GPU) into a transcription server.

The company PC keeps doing what it does today (extract the audio track with ffmpeg, drive the
progress UI, write the SRT into ``output/``) but instead of running WhisperX on its own CPU it
posts the WAV here and streams the WhisperX log back. Everything is plain HTTP + a shared token:

    GET  /                          plain-text banner (no auth) — handy to check a tunnel in a browser
    GET  /worker/health             GPU / model / busy status
    POST /worker/jobs               raw audio body → {job_id}; header X-Job-Name (basename only)
    GET  /worker/jobs/<id>?since=N  {state, lines[N:], next, exit_code}
    GET  /worker/jobs/<id>/srt      the finished SRT (text/plain)
    POST /worker/jobs/<id>/cancel
    POST /worker/jobs/<id>/delete   remove the job folder once the client has the SRT

Only one WhisperX process runs at a time; extra jobs queue. Reach the worker over Tailscale
(``http://100.x.y.z:8766``) or a Cloudflare Tunnel (``https://…``) — never port-forward it
naked to the internet, the token is the only lock on the door.
"""
from __future__ import annotations

import json
import os
import queue
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable
from urllib.parse import parse_qs, urlparse

import demo_core
import security

ROOT = demo_core.ROOT
WORKER_DIR = ROOT / "worker"
DEFAULT_PORT = 8766
DEFAULT_BIND = "0.0.0.0"
JOB_TTL_S = 2 * 60 * 60
MAX_LOG_LINES = 5000
SAFE_JOB_NAME_RE = re.compile(r"^[A-Za-z0-9._ -]{1,120}$")
JOB_ID_RE = re.compile(r"^[0-9a-f]{32}$")
VERSION = "1.0"

LogFn = Callable[[str], None]


def _setting(key: str, default: str = "") -> str:
    """Environment variable first, then the worker machine's .env, then the default."""
    value = os.environ.get(key, "").strip()
    if not value:
        value = demo_core.load_env().get(key, "").strip()
    return value or default


def worker_port() -> int:
    try:
        return int(_setting("CALL_COACH_WORKER_PORT", str(DEFAULT_PORT)))
    except ValueError:
        return DEFAULT_PORT


def worker_bind() -> str:
    return _setting("CALL_COACH_WORKER_BIND", DEFAULT_BIND)


def worker_model(gpu: bool) -> str:
    return _setting("CALL_COACH_WORKER_MODEL") or ("large-v3" if gpu else demo_core.MODEL)


def safe_job_name(name: str) -> str:
    base = Path(name or "").name.strip()
    if not base or not SAFE_JOB_NAME_RE.match(base):
        return "audio.wav"
    return base


def local_addresses() -> list[str]:
    """IPv4 addresses this machine answers on (Tailscale 100.x shows up here too)."""
    found: list[str] = []
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip not in found and not ip.startswith("127."):
                found.append(ip)
    except socket.gaierror:
        pass
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        s.close()
        if ip not in found and not ip.startswith("127."):
            found.insert(0, ip)
    except OSError:
        pass
    tailscale = [ip for ip in found if ip.startswith("100.")]
    others = [ip for ip in found if not ip.startswith("100.")]
    return tailscale + others


class WorkerJob:
    def __init__(self, job_id: str, name: str, job_dir: Path) -> None:
        self.id = job_id
        self.name = name
        self.dir = job_dir
        self.audio = job_dir / name
        self.state = "queued"
        self.lines: list[str] = []
        self.exit_code: int | None = None
        self.created_at = time.time()
        self.finished_at: float | None = None
        self.cancel_requested = False
        self.proc: subprocess.Popen | None = None
        self.srt: Path | None = None
        self.audio_bytes = 0

    def to_dict(self, since: int = 0) -> dict:
        since = max(0, min(since, len(self.lines)))
        return {
            "ok": True,
            "job_id": self.id,
            "name": self.name,
            "state": self.state,
            "lines": self.lines[since:],
            "next": len(self.lines),
            "exit_code": self.exit_code,
            "srt_ready": self.srt is not None and self.srt.is_file(),
            "created_at": self.created_at,
            "finished_at": self.finished_at,
        }


class _JobHooks(demo_core.JobHooks):
    def __init__(self, job: WorkerJob, lock: threading.Lock) -> None:
        self.job = job
        self.lock = lock

    def register_proc(self, proc: subprocess.Popen | None) -> None:
        with self.lock:
            self.job.proc = proc

    def is_cancelled(self) -> bool:
        with self.lock:
            return self.job.cancel_requested


Runner = Callable[[WorkerJob, LogFn, demo_core.JobHooks, "WorkerState"], int]


def whisperx_runner(job: WorkerJob, log: LogFn, hooks: demo_core.JobHooks, state: "WorkerState") -> int:
    """Run WhisperX on the uploaded audio; the SRT lands next to it inside the job folder."""
    args = demo_core.whisperx_args(
        job.audio,
        model=state.model,
        threads=demo_core.transcribe_threads(),
        batch=state.batch,
        output_dir=job.dir,
        device=state.device,
        compute_type=state.compute_type,
    )
    log(f"[Worker] WhisperX {state.model} on {state.device} ({state.compute_type})")
    code = demo_core.run_command(demo_core.whisperx_cmd() + args, log=log, env=demo_core.cache_env(), hooks=hooks)
    if code == 0:
        srt = job.dir / f"{job.audio.stem}.srt"
        if not srt.is_file():
            candidates = sorted(job.dir.glob("*.srt"))
            if not candidates:
                log("[錯誤] WhisperX 結束但找不到 SRT 輸出")
                return 1
            srt = candidates[0]
        job.srt = srt
    return code


class WorkerState:
    def __init__(self, *, token: str, runner: Runner | None = None, gpu: dict | None = None) -> None:
        self.lock = threading.Lock()
        self.token = token
        self.jobs: dict[str, WorkerJob] = {}
        self.queue: "queue.Queue[str]" = queue.Queue()
        self.current: str | None = None
        self.done_count = 0
        self.started_at = time.time()
        self.runner: Runner = runner or whisperx_runner
        self.gpu = gpu or {"available": False, "name": None}
        gpu_ok = bool(self.gpu.get("available"))
        self.device = "cuda" if gpu_ok else "cpu"
        self.compute_type = "float16" if gpu_ok else "int8"
        self.batch = 16 if gpu_ok else demo_core.transcribe_batch()
        self.model = worker_model(gpu_ok)
        self.name = _setting("CALL_COACH_WORKER_NAME") or socket.gethostname()
        self._thread = threading.Thread(target=self._loop, daemon=True, name="worker-runner")
        self._thread.start()

    # ----- status -----------------------------------------------------------------------------

    def health(self) -> dict:
        with self.lock:
            busy = self.current is not None
            queued = sum(1 for j in self.jobs.values() if j.state == "queued")
        return {
            "ok": True,
            "worker": "call-coach",
            "version": VERSION,
            "name": self.name,
            "device": self.device,
            "gpu": self.gpu.get("name"),
            "gpu_available": bool(self.gpu.get("available")),
            "gpu_reason": self.gpu.get("reason"),
            "model": self.model,
            "compute_type": self.compute_type,
            "whisperx_ok": demo_core.WHISPERX.exists() or demo_core.VENV_PY.exists(),
            "hf_token_ok": demo_core.has_valid_token(),
            "busy": busy,
            "queued": queued,
            "jobs_done": self.done_count,
            "uptime_s": int(time.time() - self.started_at),
        }

    # ----- jobs -------------------------------------------------------------------------------

    def new_job(self, name: str) -> WorkerJob:
        job_id = uuid.uuid4().hex
        job_dir = WORKER_DIR / job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        job = WorkerJob(job_id, safe_job_name(name), job_dir)
        with self.lock:
            self.jobs[job_id] = job
        return job

    def enqueue(self, job: WorkerJob) -> None:
        job.lines.append(f"[Worker] 已收到 {job.name}（{job.audio_bytes / (1024**2):.1f} MB），排入佇列")
        self.queue.put(job.id)
        self.prune()

    def get(self, job_id: str) -> WorkerJob | None:
        with self.lock:
            return self.jobs.get(job_id)

    def cancel(self, job: WorkerJob) -> None:
        with self.lock:
            if job.state in ("done", "failed", "cancelled"):
                return
            job.cancel_requested = True
            proc = job.proc
            if job.state == "queued":
                job.state = "cancelled"
                job.exit_code = demo_core.CANCEL_EXIT
                job.finished_at = time.time()
        if proc is not None:
            demo_core.kill_proc(proc)

    def delete(self, job: WorkerJob) -> None:
        self.cancel(job)
        with self.lock:
            self.jobs.pop(job.id, None)
        shutil.rmtree(job.dir, ignore_errors=True)

    def prune(self, now: float | None = None) -> None:
        now = time.time() if now is None else now
        with self.lock:
            stale = [j for j in self.jobs.values() if j.finished_at and now - j.finished_at > JOB_TTL_S]
            for j in stale:
                self.jobs.pop(j.id, None)
        for j in stale:
            shutil.rmtree(j.dir, ignore_errors=True)

    # ----- runner loop ------------------------------------------------------------------------

    def _loop(self) -> None:
        while True:
            job_id = self.queue.get()
            job = self.get(job_id)
            if job is None or job.state != "queued":
                continue
            self._run(job)

    def _run(self, job: WorkerJob) -> None:
        with self.lock:
            job.state = "running"
            self.current = job.id

        def log(msg: str) -> None:
            with self.lock:
                if len(job.lines) < MAX_LOG_LINES:
                    job.lines.append(msg)

        hooks = _JobHooks(job, self.lock)
        code = 1
        try:
            code = self.runner(job, log, hooks, self)
        except Exception as e:  # noqa: BLE001
            log(f"[錯誤] Worker 例外：{e}")
            code = 1
        with self.lock:
            if job.cancel_requested or code == demo_core.CANCEL_EXIT:
                job.state = "cancelled"
                code = demo_core.CANCEL_EXIT
            elif code == 0 and job.srt is not None:
                job.state = "done"
                self.done_count += 1
            else:
                job.state = "failed"
                code = code or 1
            job.exit_code = code
            job.finished_at = time.time()
            job.proc = None
            self.current = None
        try:
            job.audio.unlink()
        except OSError:
            pass
        log(f"[Worker] 工作結束（exit code {code}）")


STATE: WorkerState | None = None


class WorkerHandler(BaseHTTPRequestHandler):
    server_version = "CallCoachWorker/" + VERSION
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:
        return

    # ----- helpers ----------------------------------------------------------------------------

    def _send(self, status: int, body: bytes, ctype: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, data: dict, status: int = 200) -> None:
        self._send(status, json.dumps(data, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    def _reject(self, status: int, message: str) -> None:
        self._json({"ok": False, "message": message}, status)

    def _authorized(self) -> bool:
        assert STATE is not None
        provided = self.headers.get(security.WORKER_TOKEN_HEADER, "")
        if security.worker_token_matches(STATE.token, provided):
            return True
        self._reject(401, "Worker Token 不正確")
        return False

    def _drain(self) -> None:
        """Consume an unread body so the keep-alive connection stays in sync."""
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            length = 0
        remaining = length
        while remaining > 0:
            chunk = self.rfile.read(min(remaining, 1024 * 1024))
            if not chunk:
                break
            remaining -= len(chunk)

    def _job_from_path(self, path: str) -> tuple[WorkerJob | None, str]:
        """('/worker/jobs/<id>[/action]') → (job, action)."""
        assert STATE is not None
        parts = path.strip("/").split("/")
        if len(parts) < 3 or parts[0] != "worker" or parts[1] != "jobs" or not JOB_ID_RE.match(parts[2]):
            return None, ""
        return STATE.get(parts[2]), parts[3] if len(parts) > 3 else ""

    # ----- routes -----------------------------------------------------------------------------

    def do_GET(self) -> None:
        assert STATE is not None
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/":
            return self._send(200, f"Call Coach Worker {VERSION} — {STATE.name}\n".encode("utf-8"), "text/plain; charset=utf-8")
        if not self._authorized():
            return None
        if path == "/worker/health":
            return self._json(STATE.health())
        job, action = self._job_from_path(path)
        if path.startswith("/worker/jobs/"):
            if job is None:
                return self._reject(404, "找不到工作（可能已過期）")
            if action == "":
                since = 0
                try:
                    since = int(parse_qs(parsed.query).get("since", ["0"])[0])
                except ValueError:
                    since = 0
                with STATE.lock:
                    return self._json(job.to_dict(since))
            if action == "srt":
                if job.state != "done" or job.srt is None or not job.srt.is_file():
                    return self._reject(409, "SRT 尚未完成")
                return self._send(200, job.srt.read_bytes(), "text/plain; charset=utf-8")
        return self._reject(404, "未知的 API")

    def do_POST(self) -> None:
        assert STATE is not None
        path = urlparse(self.path).path
        if not self._authorized():
            self._drain()
            return None
        if path == "/worker/jobs":
            return self._receive_job()
        job, action = self._job_from_path(path)
        self._drain()
        if path.startswith("/worker/jobs/"):
            if job is None:
                return self._reject(404, "找不到工作（可能已過期）")
            if action == "cancel":
                STATE.cancel(job)
                return self._json({"ok": True, "state": job.state})
            if action == "delete":
                STATE.delete(job)
                return self._json({"ok": True})
        return self._reject(404, "未知的 API")

    def _receive_job(self) -> None:
        assert STATE is not None
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            length = 0
        if length <= 0:
            return self._reject(400, "缺少音訊內容")
        if length > security.WORKER_MAX_AUDIO_BYTES:
            self._drain()
            return self._reject(413, f"音訊過大（上限 {security.WORKER_MAX_AUDIO_BYTES // (1024**2)} MB）")
        if not (demo_core.WHISPERX.exists() or demo_core.VENV_PY.exists()):
            self._drain()
            return self._reject(503, "Worker 尚未安裝 WhisperX 環境，請在家用主機執行 start_worker.cmd 完成安裝")
        if not demo_core.has_valid_token():
            self._drain()
            return self._reject(503, "Worker 尚未設定 HF_TOKEN（分軌模型授權），請在家用主機的 .env 填入")

        job = STATE.new_job(self.headers.get("X-Job-Name", "audio.wav"))
        remaining = length
        try:
            with job.audio.open("wb") as f:
                while remaining > 0:
                    chunk = self.rfile.read(min(remaining, 1024 * 1024))
                    if not chunk:
                        raise OSError("連線中斷，音訊未完整送達")
                    f.write(chunk)
                    remaining -= len(chunk)
        except OSError as e:
            STATE.delete(job)
            return self._reject(400, f"接收音訊失敗：{e}")
        job.audio_bytes = length
        STATE.enqueue(job)
        return self._json({"ok": True, "job_id": job.id, "state": job.state, "queued": STATE.health()["queued"]}, 201)


# ----- entrypoint ---------------------------------------------------------------------------------


def make_server(state: WorkerState, host: str, port: int) -> ThreadingHTTPServer:
    global STATE
    STATE = state
    WORKER_DIR.mkdir(exist_ok=True)
    server = ThreadingHTTPServer((host, port), WorkerHandler)
    server.daemon_threads = True
    return server


def _banner(state: WorkerState, port: int) -> list[str]:
    lines = [
        "=== Call Coach 遠端轉錄 Worker ===",
        f"主機名稱: {state.name}",
    ]
    if state.gpu.get("available"):
        lines.append(f"GPU: {state.gpu.get('name')}（torch {state.gpu.get('torch')}, CUDA {state.gpu.get('cuda')}）")
    else:
        lines.append(f"GPU: 未偵測到 — {state.gpu.get('reason', '將以 CPU 執行，速度不會比公司電腦快')}")
    lines.append(f"模型: {state.model}（{state.device} / {state.compute_type}）")
    lines.append(f"WhisperX: {'已安裝' if demo_core.WHISPERX.exists() or demo_core.VENV_PY.exists() else '未安裝 — 請先執行 start_worker.cmd 安裝'}")
    lines.append(f"HF_TOKEN: {'已設定' if demo_core.has_valid_token() else '未設定 — 請在 .env 填入（分軌模型需要）'}")
    lines.append("")
    lines.append("公司電腦要填的資料：")
    for ip in local_addresses():
        tag = "（Tailscale）" if ip.startswith("100.") else "（區網）"
        lines.append(f"  網址: http://{ip}:{port}  {tag}")
    lines.append(f"  Token: {state.token}")
    lines.append("")
    lines.append("走 Cloudflare Tunnel 時，網址改填 tunnel 的 https 網址（不加埠號）。")
    lines.append("關閉此視窗即停止 Worker。")
    return lines


def _run_with_window(server: ThreadingHTTPServer, state: WorkerState, port: int) -> int:
    import tkinter as tk
    from tkinter import messagebox

    def serve() -> None:
        server.serve_forever()

    threading.Thread(target=serve, daemon=True).start()
    root = tk.Tk()
    root.title("Call Coach 遠端轉錄 Worker")
    root.geometry("560x420")
    tk.Label(root, text="Call Coach 遠端轉錄 Worker", font=("", 13, "bold")).pack(pady=(14, 4))
    text = tk.Text(root, height=16, width=70, wrap="word")
    text.insert("1.0", "\n".join(_banner(state, port)))
    text.configure(state="disabled")
    text.pack(padx=12, pady=6)

    def copy_token() -> None:
        root.clipboard_clear()
        root.clipboard_append(state.token)
        messagebox.showinfo("已複製", "Worker Token 已複製，貼到公司電腦的「遠端主機設定」即可")

    def on_quit() -> None:
        if messagebox.askokcancel("結束", "確定要停止 Worker 嗎？進行中的轉錄會中斷"):
            server.shutdown()
            root.destroy()

    row = tk.Frame(root)
    row.pack(pady=6)
    tk.Button(row, text="複製 Token", command=copy_token, width=18).pack(side="left", padx=6)
    tk.Button(row, text="結束 Worker", command=on_quit, width=18).pack(side="left", padx=6)
    root.protocol("WM_DELETE_WINDOW", on_quit)
    root.mainloop()
    server.server_close()
    return 0


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    demo_core.ensure_workspace_files()
    port = worker_port()
    host = worker_bind()
    token = demo_core.ensure_worker_token(log=print)

    print("偵測 GPU（首次載入 torch 需數秒）…")
    gpu = demo_core.detect_gpu()
    state = WorkerState(token=token, gpu=gpu)
    try:
        server = make_server(state, host, port)
    except OSError as e:
        print(f"[錯誤] 無法監聽 {host}:{port}：{e}")
        return 1

    if demo_core.is_frozen() and "--console" not in argv:
        return _run_with_window(server, state, port)

    for line in _banner(state, port):
        print(line)
    print(f"\n監聽 {host}:{port}（Ctrl+C 停止）\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
