#!/usr/bin/env python3
"""
Call Coach 本機助手 — 整合 DEMO 轉錄與電訪分析

用法:
  python demo_app.py
  或雙擊 start_call_coach.pyw / start_call_coach.cmd

會在瀏覽器開啟 Call Coach，並在本機提供轉錄 API（127.0.0.1:8765）。
"""
from __future__ import annotations

import json
import mimetypes
import os
import subprocess
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import demo_core
import job_log
import security
import upload_parse

ROOT = demo_core.ROOT
STATIC = demo_core.STATIC
PORT = 8765
CALL_COACH_URL = demo_core.CALL_COACH_URL


class JobState:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.running = False
        self.kind = ""
        self.logs: list[str] = []
        self.exit_code: int | None = None
        self.cancel_requested = False
        self.cancel_uninstall = False
        self.cancel_remove_models = False
        self.current_proc: subprocess.Popen | None = None
        self.log_file: str | None = None

    def reset(self, kind: str) -> bool:
        with self.lock:
            if self.running:
                return False
            self.running = True
            self.kind = kind
            self.logs = []
            self.exit_code = None
            self.cancel_requested = False
            self.cancel_uninstall = False
            self.cancel_remove_models = False
            self.current_proc = None
            self.log_file = None
            return True

    def append(self, msg: str) -> None:
        with self.lock:
            self.logs.append(msg)

    def finish(self, code: int) -> None:
        import job_log

        with self.lock:
            logs_copy = list(self.logs)
            kind = self.kind
            self.exit_code = code
            self.running = False
            self.current_proc = None
        if kind:
            path = job_log.save_job_log(kind, logs_copy, code)
            with self.lock:
                self.log_file = str(path)

    def request_cancel(self, uninstall: bool = False, remove_models: bool = False) -> tuple[bool, str]:
        with self.lock:
            if not self.running:
                return False, "目前沒有進行中的工作"
            if self.kind != "transcribe":
                return False, "僅轉錄進行中時可取消"
            self.cancel_requested = True
            self.cancel_uninstall = uninstall
            self.cancel_remove_models = remove_models
            proc = self.current_proc
        if proc is not None:
            demo_core.kill_proc(proc)
        return True, "正在取消轉錄…"

    def snapshot(self) -> dict:
        import re

        hf_re = re.compile(r"hf_[A-Za-z0-9]+")
        with self.lock:
            return {
                "running": self.running,
                "kind": self.kind,
                "logs": [hf_re.sub("hf_***", line) for line in self.logs],
                "exit_code": self.exit_code,
                "cancel_requested": self.cancel_requested,
                "cancel_uninstall": self.cancel_uninstall,
                "log_file": self.log_file,
                "logs_folder": str(job_log.LOGS_DIR),
            }


class JobHooks(demo_core.JobHooks):
    def __init__(self, job: JobState) -> None:
        self.job = job

    def register_proc(self, proc: subprocess.Popen | None) -> None:
        with self.job.lock:
            self.job.current_proc = proc

    def is_cancelled(self) -> bool:
        with self.job.lock:
            return self.job.cancel_requested


JOB = JobState()


def run_job(kind: str, fn) -> tuple[bool, str]:
    if not JOB.reset(kind):
        return False, "已有工作進行中，請稍候"

    def worker() -> None:
        code = 0
        try:
            code = fn(JOB.append)
            with JOB.lock:
                cancelled = JOB.cancel_requested
                do_uninstall = JOB.cancel_uninstall
                remove_models = JOB.cancel_remove_models
            if cancelled:
                JOB.append("[已取消] 轉錄已停止")
            if do_uninstall:
                JOB.append("--- 接續解除安裝轉錄環境 ---")
                uninstall_code = demo_core.run_uninstall(remove_models=remove_models, log=JOB.append)
                if not cancelled and uninstall_code != 0:
                    code = uninstall_code
            if cancelled:
                code = demo_core.CANCEL_EXIT
        except Exception as e:  # noqa: BLE001
            JOB.append(f"[錯誤] {e}")
            code = 1
        JOB.finish(code)

    threading.Thread(target=worker, daemon=True).start()
    return True, "已開始"


class Handler(BaseHTTPRequestHandler):
    server_version = "DEMODemoApp/1.0"

    def log_message(self, fmt: str, *args) -> None:
        return

    def _origin(self) -> str:
        return self.headers.get("Origin", "")

    def _apply_cors(self) -> None:
        origin = self._origin()
        if security.is_allowed_origin(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header(
            "Access-Control-Allow-Headers",
            f"Content-Type, {security.TOKEN_HEADER}",
        )

    def _send_json(self, data: dict, status: int = 200) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._apply_cors()
        self.end_headers()
        self.wfile.write(body)

    def _parse_json(self, body: bytes) -> dict | None:
        if not body:
            return {}
        try:
            return json.loads(body.decode("utf-8"))
        except json.JSONDecodeError:
            return None

    def _reject(self, status: int, message: str) -> None:
        self._send_json({"ok": False, "message": message}, status)

    def _check_host(self) -> bool:
        host = self.headers.get("Host", "")
        if not security.is_allowed_host(host, PORT):
            self._reject(403, "不允許的 Host")
            return False
        return True

    def _check_api_access(self, path: str) -> bool:
        if not self._check_host():
            return False
        if path in security.PUBLIC_API_PATHS:
            origin = self._origin()
            if origin and not security.is_allowed_origin(origin):
                self._reject(403, "不允許的來源")
                return False
            return True
        token = self.headers.get(security.TOKEN_HEADER, "")
        if token != security.API_TOKEN:
            self._reject(401, "未授權的本機 API 請求")
            return False
        return True

    def _send_file(self, path: Path) -> None:
        if not path.exists() or not path.is_file():
            self.send_error(404)
            return
        data = path.read_bytes()
        ctype = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self._apply_cors()
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self) -> None:
        if not self._check_host():
            return
        self.send_response(204)
        self._apply_cors()
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/bootstrap":
            if not self._check_api_access(path):
                return
            return self._send_json({"ok": True, "token": security.API_TOKEN})

        if path.startswith("/api/"):
            if not self._check_api_access(path):
                return

        if path == "/api/status":
            return self._send_json(demo_core.get_status().to_dict())

        if path == "/api/job":
            snap = JOB.snapshot()
            snap["status"] = demo_core.get_status().to_dict()
            return self._send_json(snap)

        if path == "/api/job/log/latest":
            try:
                name, content, folder = job_log.read_latest_log()
            except FileNotFoundError:
                return self._send_json({"ok": False, "message": "尚無安裝日誌"}, 404)
            return self._send_json(
                {
                    "ok": True,
                    "filename": name,
                    "content": content,
                    "folder": folder,
                }
            )

        if path == "/api/srt/latest":
            try:
                name, content = demo_core.read_srt()
            except FileNotFoundError:
                return self._send_json({"ok": False, "message": "尚無 SRT"}, 404)
            return self._send_json({"ok": True, "filename": name, "content": content})

        if path.startswith("/api/srt/"):
            name = Path(path).name
            if name.endswith(".srt"):
                try:
                    fname, content = demo_core.read_srt(name)
                except FileNotFoundError:
                    return self._send_json({"ok": False, "message": "找不到檔案"}, 404)
                return self._send_json({"ok": True, "filename": fname, "content": content})

        if path in ("/", "/index.html"):
            return self._send_file(STATIC / "index.html")

        rel = path.lstrip("/")
        try:
            file_path = security.resolve_under(STATIC / rel, STATIC)
        except ValueError:
            return self.send_error(403)
        if file_path.is_file():
            return self._send_file(file_path)

        self.send_error(404)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        if path.startswith("/api/"):
            if not self._check_api_access(path):
                return

        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else b""

        if path == "/api/setup":
            ok, msg = run_job("setup", demo_core.run_setup)
            return self._send_json({"ok": ok, "message": msg})

        if path == "/api/install-ffmpeg":
            ok, msg = run_job("install-ffmpeg", demo_core.run_install_ffmpeg)
            return self._send_json({"ok": ok, "message": msg})

        if path == "/api/full-setup":
            ok, msg = run_job("full-setup", demo_core.run_full_setup)
            return self._send_json({"ok": ok, "message": msg})

        if path == "/api/transcribe":
            data = self._parse_json(body)
            if data is None:
                return self._reject(400, "JSON 格式錯誤")
            mp4 = data.get("mp4")
            if mp4:
                try:
                    mp4 = demo_core.safe_mp4_name(str(mp4))
                except ValueError as e:
                    return self._reject(400, str(e))
            hooks = JobHooks(JOB)
            ok, msg = run_job(
                "transcribe",
                lambda log: demo_core.run_transcribe(mp4, log, hooks=hooks),
            )
            return self._send_json({"ok": ok, "message": msg})

        if path == "/api/cancel":
            data = self._parse_json(body)
            if data is None:
                return self._reject(400, "JSON 格式錯誤")
            uninstall = bool(data.get("uninstall"))
            remove_models = bool(data.get("remove_models"))
            ok, msg = JOB.request_cancel(uninstall=uninstall, remove_models=remove_models)
            status = 200 if ok else 409
            return self._send_json({"ok": ok, "message": msg}, status)

        if path == "/api/token":
            data = self._parse_json(body)
            if data is None:
                return self._reject(400, "JSON 格式錯誤")
            token = str(data.get("token", "")).strip()
            try:
                demo_core.save_hf_token(token)
            except ValueError as e:
                return self._send_json({"ok": False, "message": str(e)}, 400)
            return self._send_json({"ok": True, "status": demo_core.get_status().to_dict()})

        if path == "/api/open-folder":
            data = self._parse_json(body)
            if data is None:
                return self._reject(400, "JSON 格式錯誤")
            folder = str(data.get("folder", "output"))
            if folder not in ("input", "output", "models", "logs"):
                return self._send_json({"ok": False, "message": "不允許的資料夾"}, 400)
            try:
                demo_core.open_folder(folder)
            except OSError as e:
                return self._send_json({"ok": False, "message": str(e)}, 500)
            return self._send_json({"ok": True})

        if path == "/api/open-url":
            data = self._parse_json(body)
            if data is None:
                return self._reject(400, "JSON 格式錯誤")
            url = str(data.get("url", "")).strip()
            if not url:
                return self._send_json({"ok": False, "message": "缺少 url"}, 400)
            try:
                demo_core.open_url(url)
            except ValueError as e:
                return self._send_json({"ok": False, "message": str(e)}, 400)
            except OSError as e:
                return self._send_json({"ok": False, "message": str(e)}, 500)
            return self._send_json({"ok": True})

        if path == "/api/upload":
            return self._handle_upload()

        if path == "/api/uninstall":
            if JOB.running:
                return self._send_json({"ok": False, "message": "轉錄或安裝進行中，請稍後再解除安裝"}, 409)
            data = self._parse_json(body)
            if data is None:
                return self._reject(400, "JSON 格式錯誤")
            remove_models = bool(data.get("remove_models"))
            ok, msg = run_job(
                "uninstall",
                lambda log: demo_core.run_uninstall(remove_models=remove_models, log=log),
            )
            return self._send_json({"ok": ok, "message": msg})

        self.send_error(404)

    def _handle_upload(self) -> None:
        if JOB.running:
            return self._send_json({"ok": False, "message": "轉錄或安裝進行中，請稍後再上傳"}, 409)

        length = int(self.headers.get("Content-Length", 0))
        if length > security.MAX_UPLOAD_BYTES:
            return self._reject(413, f"檔案過大（上限 {security.MAX_UPLOAD_BYTES // (1024**3)} GB）")

        ctype = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in ctype:
            return self._send_json({"ok": False, "message": "需要 multipart 上傳"}, 400)

        dest_dir = ROOT / "input"
        dest_dir.mkdir(exist_ok=True)
        tmp = dest_dir / "upload.uploading"
        try:
            with tmp.open("wb") as f:
                raw_name = upload_parse.stream_multipart_file(
                    self.rfile,
                    ctype,
                    f,
                    max_bytes=security.MAX_UPLOAD_BYTES,
                )
            filename = demo_core.safe_mp4_name(raw_name)
            dest = dest_dir / filename
            tmp.replace(dest)
        except ValueError as e:
            tmp.unlink(missing_ok=True)
            return self._send_json({"ok": False, "message": str(e)}, 400)
        except OSError as e:
            tmp.unlink(missing_ok=True)
            return self._send_json({"ok": False, "message": f"寫入失敗: {e}"}, 500)

        return self._send_json(
            {
                "ok": True,
                "filename": filename,
                "status": demo_core.get_status().to_dict(),
            }
        )


def _run_with_window(server: ThreadingHTTPServer, host: str, url: str) -> int:
    import tkinter as tk
    from tkinter import messagebox

    def open_browser() -> None:
        webbrowser.open(url)

    def on_quit() -> None:
        if messagebox.askokcancel("結束", "確定要停止本機轉錄助手嗎？"):
            server.shutdown()
            root.destroy()

    def serve() -> None:
        server.serve_forever()

    threading.Timer(1.0, open_browser).start()
    threading.Thread(target=serve, daemon=True).start()

    root = tk.Tk()
    root.title("Call Coach 本機助手")
    root.geometry("380x210")
    root.resizable(False, False)
    tk.Label(root, text="Call Coach 本機助手", font=("", 13, "bold")).pack(pady=(18, 6))
    tk.Label(root, text=f"本機 API：http://{host}:{PORT}/").pack()
    tk.Label(root, text="請保持此視窗開啟，關閉即停止服務", fg="#555").pack(pady=(8, 12))
    tk.Button(root, text="開啟 Call Coach", command=open_browser, width=28).pack(pady=4)
    tk.Button(root, text="結束助手", command=on_quit, width=28).pack(pady=4)
    root.protocol("WM_DELETE_WINDOW", on_quit)
    root.mainloop()
    server.server_close()
    return 0


def main() -> int:
    demo_core.ensure_workspace_files()

    if not STATIC.exists():
        print(f"[錯誤] 找不到介面檔案: {STATIC}")
        return 1

    _, ver, warning = demo_core.python_version_info()
    if warning and not demo_core.is_frozen():
        print(f"[提醒] {warning}")

    host = "127.0.0.1"
    url = CALL_COACH_URL
    if not demo_core.is_frozen():
        print("=== Call Coach 本機助手 ===")
        print(f"工作目錄: {ROOT}")
        print(f"Python: {ver}")
        print(f"Call Coach: {url}")
        print(f"本機 API: http://{host}:{PORT}/api/status")
        print("（關閉此視窗即停止服務）\n")

    server = ThreadingHTTPServer((host, PORT), Handler)

    if demo_core.is_frozen():
        return _run_with_window(server, host, url)

    threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
