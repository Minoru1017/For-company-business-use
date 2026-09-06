#!/usr/bin/env python3
"""
Call Coach 本機助手 — 整合 DEMO 轉錄與電訪分析

用法:
  python demo_app.py
  或雙擊 start_call_coach.pyw / start_call_coach.cmd

會在瀏覽器開啟 Call Coach，並在本機提供轉錄 API（127.0.0.1:8765）。
"""
from __future__ import annotations

import cgi
import json
import mimetypes
import os
import subprocess
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import demo_core

ROOT = demo_core.ROOT
STATIC = ROOT / "demo_app"
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
            return True

    def append(self, msg: str) -> None:
        with self.lock:
            self.logs.append(msg)

    def finish(self, code: int) -> None:
        with self.lock:
            self.exit_code = code
            self.running = False
            self.current_proc = None

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
        with self.lock:
            return {
                "running": self.running,
                "kind": self.kind,
                "logs": list(self.logs),
                "exit_code": self.exit_code,
                "cancel_requested": self.cancel_requested,
                "cancel_uninstall": self.cancel_uninstall,
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

    def _send_json(self, data: dict, status: int = 200) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send_file(self, path: Path) -> None:
        if not path.exists() or not path.is_file():
            self.send_error(404)
            return
        data = path.read_bytes()
        ctype = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/status":
            return self._send_json(demo_core.get_status().to_dict())

        if path == "/api/job":
            snap = JOB.snapshot()
            snap["status"] = demo_core.get_status().to_dict()
            return self._send_json(snap)

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
        file_path = STATIC / rel
        if file_path.exists() and file_path.is_file():
            return self._send_file(file_path)

        self.send_error(404)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else b""

        if path == "/api/setup":
            ok, msg = run_job("setup", demo_core.run_setup)
            return self._send_json({"ok": ok, "message": msg})

        if path == "/api/transcribe":
            data = json.loads(body.decode("utf-8") or "{}")
            mp4 = data.get("mp4")
            hooks = JobHooks(JOB)
            ok, msg = run_job(
                "transcribe",
                lambda log: demo_core.run_transcribe(mp4, log, hooks=hooks),
            )
            return self._send_json({"ok": ok, "message": msg})

        if path == "/api/cancel":
            data = json.loads(body.decode("utf-8") or "{}")
            uninstall = bool(data.get("uninstall"))
            remove_models = bool(data.get("remove_models"))
            ok, msg = JOB.request_cancel(uninstall=uninstall, remove_models=remove_models)
            status = 200 if ok else 409
            return self._send_json({"ok": ok, "message": msg}, status)

        if path == "/api/token":
            data = json.loads(body.decode("utf-8") or "{}")
            token = str(data.get("token", "")).strip()
            try:
                demo_core.save_hf_token(token)
            except ValueError as e:
                return self._send_json({"ok": False, "message": str(e)}, 400)
            return self._send_json({"ok": True, "status": demo_core.get_status().to_dict()})

        if path == "/api/open-folder":
            data = json.loads(body.decode("utf-8") or "{}")
            folder = str(data.get("folder", "output"))
            if folder not in ("input", "output", "models"):
                return self._send_json({"ok": False, "message": "不允許的資料夾"}, 400)
            try:
                demo_core.open_folder(folder)
            except OSError as e:
                return self._send_json({"ok": False, "message": str(e)}, 500)
            return self._send_json({"ok": True})

        if path == "/api/open-url":
            data = json.loads(body.decode("utf-8") or "{}")
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
            data = json.loads(body.decode("utf-8") or "{}")
            remove_models = bool(data.get("remove_models"))
            ok, msg = run_job(
                "uninstall",
                lambda log: demo_core.run_uninstall(remove_models=remove_models, log=log),
            )
            return self._send_json({"ok": ok, "message": msg})

        self.send_error(404)

    def _handle_upload(self) -> None:
        ctype = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in ctype:
            return self._send_json({"ok": False, "message": "需要 multipart 上傳"}, 400)

        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": ctype,
                "CONTENT_LENGTH": self.headers.get("Content-Length", "0"),
            },
        )
        item = form["file"] if "file" in form else None
        if item is None or not getattr(item, "filename", None):
            return self._send_json({"ok": False, "message": "未選擇檔案"}, 400)

        filename = Path(item.filename).name
        if not filename.lower().endswith(".mp4"):
            return self._send_json({"ok": False, "message": "請上傳 MP4 錄影檔"}, 400)

        dest = ROOT / "input" / filename
        (ROOT / "input").mkdir(exist_ok=True)
        tmp = dest.with_suffix(dest.suffix + ".uploading")
        try:
            with tmp.open("wb") as f:
                while True:
                    chunk = item.file.read(1024 * 1024)
                    if not chunk:
                        break
                    f.write(chunk)
            tmp.replace(dest)
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


def main() -> int:
    if not STATIC.exists():
        print(f"[錯誤] 找不到介面檔案: {STATIC}")
        return 1

    host = "127.0.0.1"
    url = CALL_COACH_URL
    print("=== Call Coach 本機助手 ===")
    print(f"工作目錄: {ROOT}")
    print(f"Call Coach: {url}")
    print(f"本機 API: http://{host}:{PORT}/api/status")
    print("（關閉此視窗即停止服務）\n")

    server = ThreadingHTTPServer((host, PORT), Handler)
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
