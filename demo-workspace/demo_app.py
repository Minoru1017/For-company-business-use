#!/usr/bin/env python3
"""
DEMO 轉錄助手 — 本機圖形化操作介面（不需 CMD）

用法:
  python demo_app.py
  或雙擊「啟動轉錄助手.pyw」

會在瀏覽器開啟 http://127.0.0.1:8765
音檔全程在本機處理，不上傳雲端。
"""
from __future__ import annotations

import cgi
import json
import mimetypes
import os
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


class JobState:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.running = False
        self.kind = ""
        self.logs: list[str] = []
        self.exit_code: int | None = None

    def reset(self, kind: str) -> bool:
        with self.lock:
            if self.running:
                return False
            self.running = True
            self.kind = kind
            self.logs = []
            self.exit_code = None
            return True

    def append(self, msg: str) -> None:
        with self.lock:
            self.logs.append(msg)

    def finish(self, code: int) -> None:
        with self.lock:
            self.exit_code = code
            self.running = False

    def snapshot(self) -> dict:
        with self.lock:
            return {
                "running": self.running,
                "kind": self.kind,
                "logs": list(self.logs),
                "exit_code": self.exit_code,
            }


JOB = JobState()


def run_job(kind: str, fn) -> tuple[bool, str]:
    if not JOB.reset(kind):
        return False, "已有工作進行中，請稍候"

    def worker() -> None:
        try:
            code = fn(JOB.append)
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
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path: Path) -> None:
        if not path.exists() or not path.is_file():
            self.send_error(404)
            return
        data = path.read_bytes()
        ctype = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/status":
            return self._send_json(demo_core.get_status().to_dict())

        if path == "/api/job":
            snap = JOB.snapshot()
            snap["status"] = demo_core.get_status().to_dict()
            return self._send_json(snap)

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
            ok, msg = run_job("transcribe", lambda log: demo_core.run_transcribe(mp4, log))
            return self._send_json({"ok": ok, "message": msg})

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

        if path == "/api/upload":
            return self._handle_upload()

        self.send_error(404)

    def _handle_upload(self) -> None:
        ctype = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in ctype:
            return self._send_json({"ok": False, "message": "需要 multipart 上傳"}, 400)

        form = cgi.FieldStorage(fp=self.rfile, headers=self.headers, environ={"REQUEST_METHOD": "POST"})
        item = form["file"] if "file" in form else None
        if item is None or not getattr(item, "filename", None):
            return self._send_json({"ok": False, "message": "未選擇檔案"}, 400)

        filename = Path(item.filename).name
        if not filename.lower().endswith(".mp4"):
            return self._send_json({"ok": False, "message": "請上傳 MP4 錄影檔"}, 400)

        dest = ROOT / "input" / filename
        (ROOT / "input").mkdir(exist_ok=True)
        with dest.open("wb") as f:
            f.write(item.file.read())

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
    url = f"http://{host}:{PORT}/"
    print("=== DEMO 轉錄助手 ===")
    print(f"工作目錄: {ROOT}")
    print(f"請在瀏覽器開啟: {url}")
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
