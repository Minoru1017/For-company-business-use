"""Hsinchu / home GPU PC — host agent for remote sleep & status (company PC only sends commands).

Run on the machine you want to sleep/wake (keeps listening while awake). Wake while fully
off/asleep still needs Wake-on-LAN (magic packet) from the company app; enable WoL in BIOS/NIC.

    python hsinchu_host_agent.py
    or: CallCoachAssistant.exe --host-agent   (when wired in demo_app)

HTTP (default port 8769, token required except GET /host/health):

    GET  /host/health         { ok, hostname, addresses, agent_version, schedule status }
    GET  /host/status         same + uptime (auth)
    POST /host/sleep          sleep/hibernate (auth); optional wake_after_min / wake_at → one-off RTC wake first
    POST /host/wake/schedule  { wake_after_min | wake_at } register one-off RTC wake without sleeping (auth)
    POST /host/wake/cancel    drop pending one-off wake (auth)
    POST /host/wake/test      wake test: one-off wake in 2 min, then sleep (auth)
    POST /host/schedule/reload re-read host_schedule.json, re-register weekly wakes (auth)
    POST /host/wol            relay magic packet on this LAN (auth, optional always-on relay)
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
import host_power_schedule
import security
import wol_utils

AGENT_VERSION = "1.2"
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
    sched = host_power_schedule.load_schedule()
    data = {
        "ok": True,
        "agent_version": AGENT_VERSION,
        "hostname": socket.gethostname(),
        "addresses": local_addresses(),
        "time": time.time(),
    }
    data.update(host_power_schedule.schedule_status_dict(sched))
    return data


def request_sleep(mode: str = "sleep") -> None:
    if sys.platform != "win32":
        raise OSError("目前僅支援 Windows 休眠")
    mode = (mode or "sleep").strip().lower()
    if mode in ("hibernate", "h", "hybrid"):
        subprocess.Popen(["shutdown", "/h"], cwd=str(ROOT))  # noqa: S603
        return
    # Sleep (S3). Do NOT use `rundll32 powrprof.dll,SetSuspendState 0 1 0`: rundll32 passes a
    # string pointer for every argument, so bHibernate / bWakeupEventsDisabled are both non-zero
    # → the PC hibernates with wake timers disabled and RTC wake can never fire.
    threading.Thread(target=_suspend_s3, daemon=True).start()


def _suspend_s3() -> None:
    """SetSuspendState(hibernate=False, force=False, wakeEventsDisabled=False) via ctypes.

    Runs on a worker thread after a short delay so the HTTP response is flushed first.
    Falls back to the .NET call through PowerShell if the direct call fails.
    """
    import ctypes

    time.sleep(0.5)
    try:
        powrprof = ctypes.windll.powrprof  # type: ignore[attr-defined]
        powrprof.SetSuspendState.argtypes = [ctypes.c_ubyte, ctypes.c_ubyte, ctypes.c_ubyte]
        powrprof.SetSuspendState.restype = ctypes.c_ubyte
        if powrprof.SetSuspendState(0, 0, 0):
            return
    except (OSError, AttributeError):
        pass
    subprocess.Popen(  # noqa: S603
        [
            "powershell.exe",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            "Add-Type -AssemblyName System.Windows.Forms; "
            "[System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false) | Out-Null",
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
            sched = host_power_schedule.load_schedule()
            if sched.enabled and not sched.remote_sleep_ok():
                nxt = host_power_schedule.next_wake_time(sched)
                hint = f"；下次喚醒 {nxt.strftime('%m/%d %H:%M')}" if nxt else ""
                return self._reject(
                    403,
                    f"目前不在允許遠端睡眠的時段（見新竹 host_schedule.json）{hint}",
                )
            mode = str(body.get("mode", "sleep"))
            wake_note = ""
            if body.get("wake_after_min") or body.get("wake_at"):
                if mode.strip().lower() in ("hibernate", "h", "hybrid"):
                    return self._reject(400, "預約喚醒僅支援 sleep（休眠 hibernate 無法由 RTC 喚醒）")
                try:
                    when = host_power_schedule.resolve_wake_datetime(
                        wake_after_min=body.get("wake_after_min"),
                        wake_at=body.get("wake_at"),
                    )
                except ValueError as e:
                    return self._reject(400, str(e))
                ok, msg = host_power_schedule.schedule_one_time_wake(when, reason="remote")
                if not ok:
                    return self._reject(500, f"{msg}（未睡眠）")
                wake_note = "；" + msg
            try:
                request_sleep(mode)
            except OSError as e:
                return self._reject(500, str(e))
            return self._send_json({"ok": True, "message": "已送出休眠指令" + wake_note})

        if path == "/host/wake/schedule":
            try:
                when = host_power_schedule.resolve_wake_datetime(
                    wake_after_min=body.get("wake_after_min"),
                    wake_at=body.get("wake_at"),
                )
            except ValueError as e:
                return self._reject(400, str(e))
            ok, msg = host_power_schedule.schedule_one_time_wake(when, reason="remote")
            return self._send_json({"ok": ok, "message": msg, **host_power_schedule.schedule_status_dict()}, 200 if ok else 500)

        if path == "/host/wake/cancel":
            ok, msg = host_power_schedule.cancel_one_time_wake()
            return self._send_json({"ok": ok, "message": msg, **host_power_schedule.schedule_status_dict()})

        if path == "/host/wake/test":
            ok, msg = run_wake_test()
            return self._send_json({"ok": ok, "message": msg}, 200 if ok else 500)

        if path == "/host/wake/diag":
            p = host_power_schedule.write_wake_diagnostics("由 API 要求")
            return self._send_json({"ok": True, "path": str(p), "report": p.read_text(encoding="utf-8")})

        if path == "/host/schedule/reload":
            host_power_schedule.ensure_example_file()
            sched = host_power_schedule.load_schedule()
            ok, msg = host_power_schedule.sync_wake_tasks(sched)
            return self._send_json(
                {
                    "ok": ok,
                    "message": msg,
                    **host_power_schedule.schedule_status_dict(sched),
                }
            )

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


def run_wake_test(delay_min: int = host_power_schedule.TEST_WAKE_DELAY_MIN) -> tuple[bool, str]:
    """Schedule a one-off wake shortly, then sleep. Result shows up in logs/last_wake.json."""
    from datetime import datetime, timedelta

    when = (datetime.now() + timedelta(minutes=delay_min)).replace(second=0, microsecond=0)
    ok, msg = host_power_schedule.schedule_one_time_wake(when, reason="test", stay_awake_minutes=10)
    if not ok:
        host_power_schedule.write_wake_diagnostics(f"測試喚醒：預約失敗 — {msg}")
        return False, msg
    policy = host_power_schedule.wake_timer_policy()
    warn = ""
    if policy == "disabled":
        warn = "；注意：電源方案「允許喚醒計時器」為停用，請改為啟用"
    elif policy == "important_only":
        warn = "；注意：電源方案為「僅重要喚醒計時器」，會擋住本排程，請改為啟用"
    host_power_schedule.write_wake_diagnostics(f"測試喚醒：已預約 {when:%H:%M}，即將睡眠。policy={policy}")
    try:
        request_sleep("sleep")
    except OSError as e:
        host_power_schedule.cancel_one_time_wake(quiet=True)
        return False, str(e)
    return True, f"{msg}；主機即將睡眠，若 {when.strftime('%H:%M')} 自行醒來代表 RTC 喚醒可用{warn}"


def _banner_lines(token: str, port: int, bind: str) -> list[str]:
    addrs = local_addresses()
    sched = host_power_schedule.load_schedule()
    lines = [
        "=== Call Coach 新竹主機代理 ===",
        f"監聽 http://{bind}:{port}/host/health",
        f"Tailscale / 區網：{', '.join(addrs) or '（未取得）'}",
        f"Host Token：{token}",
        "請複製 Token 給公司端 start_company_remote_sleep.cmd",
        "建議寫入 .env：CALL_COACH_HOST_AGENT_TOKEN=…",
        "",
    ]
    lines.extend(sched.summary_lines())
    last = host_power_schedule.load_last_wake()
    if last:
        lines.append(f"  最近排程喚醒：{last.get('time')}（{last.get('reason')}）")
    lines.append("排程設定：host_schedule.json（同資料夾，可從 host_schedule.example.json 複製）")
    return lines


def _run_with_window(server: ThreadingHTTPServer, token: str, port: int, bind: str) -> int:
    import tkinter as tk
    from tkinter import messagebox

    lines = _banner_lines(token, port, bind)

    def serve() -> None:
        server.serve_forever()

    threading.Thread(target=serve, daemon=True).start()

    root = tk.Tk()
    root.title("Call Coach 新竹主機代理")
    root.geometry("560x440")
    root.resizable(True, False)
    tk.Label(root, text="新竹主機代理（公司可遠端睡眠）", font=("", 12, "bold")).pack(pady=(10, 4))
    tk.Label(root, text=f"Port {port} · CallCoachAssistant.exe --host-agent", fg="#555").pack()
    tk.Label(root, text="Host Token（貼到公司端「新竹遠端睡眠」）", font=("", 10, "bold")).pack(pady=(6, 2))
    token_row = tk.Frame(root)
    token_row.pack(padx=10, fill="x")
    token_entry = tk.Entry(token_row, font=("Consolas", 10))
    token_entry.insert(0, token)
    token_entry.configure(state="readonly")
    token_entry.pack(side="left", fill="x", expand=True)
    text = tk.Text(root, height=9, width=64, font=("Consolas", 9))
    text.pack(padx=10, pady=8)
    text.insert("end", "\n".join(lines))
    text.configure(state="disabled")

    status_var = tk.StringVar(value="")
    tk.Label(root, textvariable=status_var, fg="#1a6b1a", wraplength=520, justify="left").pack(padx=10, anchor="w")

    def refresh_text() -> None:
        text.configure(state="normal")
        text.delete("1.0", "end")
        text.insert("end", "\n".join(_banner_lines(token, port, bind)))
        text.configure(state="disabled")

    last_seen = {"epoch": (host_power_schedule.load_last_wake() or {}).get("epoch")}

    def poll_wake() -> None:
        last = host_power_schedule.load_last_wake()
        if last and last.get("epoch") != last_seen["epoch"]:
            last_seen["epoch"] = last.get("epoch")
            status_var.set(
                f"排程喚醒成功：{last.get('time')}（{last.get('reason')}，保持清醒 {last.get('stay_awake_minutes')} 分鐘）"
            )
            refresh_text()
        root.after(5000, poll_wake)

    root.after(5000, poll_wake)

    def copy_token() -> None:
        root.clipboard_clear()
        root.clipboard_append(token)
        messagebox.showinfo("已複製", "Host Token 已複製 — 貼到公司端遠端睡眠設定")

    def on_quit() -> None:
        if messagebox.askokcancel("結束", "確定要停止主機代理嗎？公司將無法遠端睡眠"):
            server.shutdown()
            root.destroy()

    def on_assistant() -> None:
        import subprocess

        subprocess.Popen([sys.executable, "--assistant"], cwd=str(ROOT), close_fds=False)

    def on_schedule() -> None:
        host_power_schedule.ensure_example_file()
        path = host_power_schedule.SCHEDULE_FILE
        if not path.is_file():
            path.write_text(
                (host_power_schedule.EXAMPLE_FILE.read_text(encoding="utf-8")),
                encoding="utf-8",
            )
        os.startfile(str(path))  # type: ignore[attr-defined]
        ok, msg = host_power_schedule.sync_wake_tasks(host_power_schedule.load_schedule())
        messagebox.showinfo("排程", f"已開啟 host_schedule.json\n\n{msg}\n\n存檔後按「重讀排程」或重啟代理。")

    def on_reload() -> None:
        ok, msg = host_power_schedule.sync_wake_tasks(host_power_schedule.load_schedule())
        refresh_text()
        (messagebox.showinfo if ok else messagebox.showwarning)("重讀排程", msg)

    def on_test_wake() -> None:
        if not messagebox.askokcancel(
            "測試喚醒",
            f"將預約 {host_power_schedule.TEST_WAKE_DELAY_MIN} 分鐘後喚醒，並讓這台電腦立刻睡眠。\n\n"
            "若電腦準時自己醒來，本視窗會顯示「排程喚醒成功」。\n"
            "若沒醒：請按電源鍵喚醒，並檢查 BIOS 是否允許 RTC / 定時喚醒。\n\n繼續？",
        ):
            return
        ok, msg = run_wake_test()
        if not ok:
            messagebox.showerror("測試喚醒", msg)
        else:
            status_var.set(msg)

    def on_diag() -> None:
        p = host_power_schedule.write_wake_diagnostics("由視窗「喚醒診斷」產生")
        policy = host_power_schedule.wake_timer_policy()
        os.startfile(str(p))  # type: ignore[attr-defined]
        if policy in ("disabled", "important_only"):
            messagebox.showwarning(
                "喚醒診斷",
                "電源方案「允許喚醒計時器」目前為：" + ("停用" if policy == "disabled" else "僅重要喚醒計時器") + "\n\n"
                "請改為「啟用」：控制台 → 電源選項 → 變更計劃設定 → 變更進階電源設定 → 睡眠 → 允許喚醒計時器。\n"
                "或按「結束代理」後以系統管理員身分重新開啟主機代理，程式會自動設定。",
            )

    row = tk.Frame(root)
    row.pack(pady=6)
    tk.Button(row, text="複製 Token", command=copy_token, width=12).pack(side="left", padx=2)
    tk.Button(row, text="睡眠排程", command=on_schedule, width=12).pack(side="left", padx=2)
    tk.Button(row, text="重讀排程", command=on_reload, width=10).pack(side="left", padx=2)
    tk.Button(row, text="另開助手", command=on_assistant, width=10).pack(side="left", padx=2)
    tk.Button(row, text="結束代理", command=on_quit, width=10).pack(side="left", padx=2)
    row2 = tk.Frame(root)
    row2.pack(pady=(0, 8))
    tk.Button(
        row2,
        text=f"測試喚醒（{host_power_schedule.TEST_WAKE_DELAY_MIN} 分鐘後自動醒）",
        command=on_test_wake,
        width=30,
    ).pack(side="left", padx=2)
    tk.Button(row2, text="喚醒診斷", command=on_diag, width=12).pack(side="left", padx=2)
    root.protocol("WM_DELETE_WINDOW", on_quit)
    root.mainloop()
    server.server_close()
    return 0


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    demo_core.ensure_workspace_files()
    host_power_schedule.ensure_example_file()
    sched = host_power_schedule.load_schedule()
    ok, wake_msg = host_power_schedule.sync_wake_tasks(sched)
    if not ok:
        print(f"[提醒] 定時喚醒工作：{wake_msg}")
    elif sched.enabled and sched.wake_at:
        print(f"[排程] {wake_msg}")
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
