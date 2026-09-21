"""Hsinchu / home GPU PC — host agent for remote sleep & status (company PC only sends commands).

Run on the machine you want to sleep/wake (keeps listening while awake). Wake while fully
off/asleep still needs Wake-on-LAN (magic packet) from the company app; enable WoL in BIOS/NIC.

    python hsinchu_host_agent.py
    or: CallCoachAssistant.exe --host-agent   (when wired in demo_app)

HTTP (default port 8769, token required except GET /host/health):

    GET  /host/health     { ok, hostname, addresses, agent_version }
    GET  /host/status     same + uptime (auth)
    POST /host/sleep      sleep/hibernate (auth)
    POST /host/wol        relay magic packet on this LAN (auth, optional always-on relay)
"""
from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import demo_core
import security
import wol_utils

AGENT_VERSION = "1.0"
DEFAULT_PORT = 8769
DEFAULT_BIND = "0.0.0.0"
TOKEN_HEADER = "X-Call-Coach-Host-Token"
ROOT = demo_core.ROOT


def _setting(key: str, default: str = "") -> str:
    value = os.environ.get(key, "").strip()
    if not value:
        value = demo_core.load_env().get(key, "").strip()
    return value or default


def host_port() -> int:
    try:
        return int(_setting("CALL_COACH_HOST_AGENT_PORT", str(DEFAULT_PORT)))
    except ValueError:
        return DEFAULT_PORT


def host_bind() -> str:
    return _setting("CALL_COACH_HOST_AGENT_BIND", DEFAULT_BIND)


def host_token() -> str:
    tok = _setting("CALL_COACH_HOST_AGENT_TOKEN", "")
    if tok:
        return tok
    tok = security.new_worker_token()
    demo_core.update_env_values({"CALL_COACH_HOST_AGENT_TOKEN": tok})
    return tok


def local_addresses() -> list[str]:
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


def host_health() -> dict:
    return {
        "ok": True,
        "agent_version": AGENT_VERSION,
        "hostname": socket.gethostname(),
        "addresses": local_addresses(),
        "time": time.time(),
    }


def request_sleep(mode: str = "sleep") -> None:
    if sys.platform != "win32":
        raise OSError("目前僅支援 Windows 休眠")
    mode = (mode or "sleep").strip().lower()
    if mode in ("hibernate", "h", "hybrid"):
        subprocess.Popen(["shutdown", "/h"], cwd=str(ROOT))  # noqa: S603
        return
    # Sleep (suspend to RAM)
    subprocess.Popen(  # noqa: S603
        [
            "rundll32.exe",
            "powrprof.dll,SetSuspendState",
            "0",
            "1",
            "0",
        ],
        cwd=str(ROOT),
    )


class Handler(BaseHTTPRequestHandler):
    server_version = "CallCoachHostAgent/1.0"

    def log_message(self, fmt: str, *args) -> None:
        return

    def _send_json(self, data: dict, status: int = 200) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _auth_ok(self) -> bool:
        expected = host_token()
        provided = (self.headers.get(TOKEN_HEADER, "") or "").strip()
        return security.worker_token_matches(expected, provided)

    def _reject(self, status: int, message: str) -> None:
        self._send_json({"ok": False, "message": message}, status)

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/host/health":
            return self._send_json(host_health())
        if path == "/host/status":
            if not self._auth_ok():
                return self._reject(401, "Host Token 不正確")
            data = host_health()
            data["uptime_s"] = int(time.time() - SERVER_STARTED)
            return self._send_json(data)
        self._reject(404, "Not found")

    def do_POST(self) -> None:
        if not self._auth_ok():
            return self._reject(401, "Host Token 不正確")
        path = urlparse(self.path).path
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            body = json.loads(raw.decode("utf-8") or "{}") if raw else {}
        except json.JSONDecodeError:
            body = {}

        if path == "/host/sleep":
            try:
                request_sleep(str(body.get("mode", "sleep")))
            except OSError as e:
                return self._reject(500, str(e))
            return self._send_json({"ok": True, "message": "已送出休眠指令"})

        if path == "/host/wol":
            mac = str(body.get("mac", "")).strip()
            broadcast = str(body.get("broadcast", "255.255.255.255")).strip()
            port = int(body.get("port", 9))
            try:
                wol_utils.send_magic_packet(mac, broadcast=broadcast, port=port)
            except ValueError as e:
                return self._reject(400, str(e))
            except OSError as e:
                return self._reject(500, str(e))
            return self._send_json({"ok": True, "message": f"已在本機 LAN 送出 WoL → {broadcast}:{port}"})

        self._reject(404, "Not found")


SERVER_STARTED = time.time()


def _banner_lines(token: str, port: int, bind: str) -> list[str]:
    addrs = local_addresses()
    return [
        "=== Call Coach 新竹主機代理 ===",
        f"監聽 http://{bind}:{port}/host/health",
        f"Tailscale / 區網：{', '.join(addrs) or '（未取得）'}",
        f"Host Token：{token}",
        "請複製 Token 給公司端 start_company_remote_sleep.cmd",
        "建議寫入 .env：CALL_COACH_HOST_AGENT_TOKEN=…",
    ]


def _run_with_window(server: ThreadingHTTPServer, token: str, port: int, bind: str) -> int:
    import tkinter as tk
    from tkinter import messagebox

    lines = _banner_lines(token, port, bind)

    def serve() -> None:
        server.serve_forever()

    threading.Thread(target=serve, daemon=True).start()

    root = tk.Tk()
    root.title("Call Coach 新竹主機代理")
    root.geometry("520x320")
    root.resizable(True, False)
    tk.Label(root, text="新竹主機代理（公司可遠端睡眠）", font=("", 12, "bold")).pack(pady=(10, 4))
    tk.Label(root, text=f"Port {port} · 請保持此視窗開啟", fg="#555").pack()
    tk.Label(root, text="Host Token（貼到公司端「新竹遠端睡眠」）", font=("", 10, "bold")).pack(pady=(6, 2))
    token_row = tk.Frame(root)
    token_row.pack(padx=10, fill="x")
    token_entry = tk.Entry(token_row, font=("Consolas", 10))
    token_entry.insert(0, token)
    token_entry.configure(state="readonly")
    token_entry.pack(side="left", fill="x", expand=True)
    text = tk.Text(root, height=8, width=62, font=("Consolas", 9))
    text.pack(padx=10, pady=8)
    text.insert("end", "\n".join(lines))
    text.configure(state="disabled")

    def copy_token() -> None:
        root.clipboard_clear()
        root.clipboard_append(token)
        messagebox.showinfo("已複製", "Host Token 已複製 — 貼到公司端遠端睡眠設定")

    def on_quit() -> None:
        if messagebox.askokcancel("結束", "確定要停止主機代理嗎？公司將無法遠端睡眠"):
            server.shutdown()
            root.destroy()

    row = tk.Frame(root)
    row.pack(pady=6)
    tk.Button(row, text="複製 Token", command=copy_token, width=14).pack(side="left", padx=4)
    tk.Button(row, text="結束代理", command=on_quit, width=14).pack(side="left", padx=4)
    root.protocol("WM_DELETE_WINDOW", on_quit)
    root.mainloop()
    server.server_close()
    return 0


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    demo_core.ensure_workspace_files()
    token = host_token()
    port = host_port()
    bind = host_bind()
    try:
        server = ThreadingHTTPServer((bind, port), Handler)
    except OSError as e:
        print(f"[錯誤] 無法監聽 {bind}:{port}：{e}")
        return 1

    use_window = "--console" not in argv and (
        demo_core.is_frozen() or sys.platform == "win32"
    )
    if use_window:
        return _run_with_window(server, token, port, bind)

    for line in _banner_lines(token, port, bind):
        print(line)
    print("\n（Ctrl+C 停止）\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
