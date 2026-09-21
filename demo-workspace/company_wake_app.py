#!/usr/bin/env python3
"""Company PC only — wake Hsinchu host (WoL), optional sleep, launch DeskIn.

Does not install on the home/GPU machine; use hsinchu_host_agent.py there.
"""
from __future__ import annotations

import json
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import company_wake_config as cfg
import wol_utils

TOKEN_HEADER = "X-Call-Coach-Host-Token"


def _http_json(method: str, url: str, token: str, body: dict | None = None, timeout: float = 8.0) -> dict:
    data = None
    headers = {TOKEN_HEADER: token}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            err = json.loads(raw)
            msg = err.get("message") or raw
        except json.JSONDecodeError:
            msg = raw or f"HTTP {e.code}"
        raise RuntimeError(msg) from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"無法連線：{e.reason}") from e


def host_base(settings: dict) -> str:
    ip = str(settings.get("host_ip", "")).strip().rstrip("/")
    if not ip:
        raise ValueError("請填入主機 IP（建議 Tailscale 100.x.x.x）")
    if not ip.startswith("http"):
        port = int(settings.get("agent_port") or 8769)
        ip = f"http://{ip}:{port}"
    return ip.rstrip("/")


def fetch_health(settings: dict, *, auth: bool = False) -> dict:
    base = host_base(settings)
    path = "/host/status" if auth else "/host/health"
    if auth:
        token = str(settings.get("host_token", "")).strip()
        if not token:
            raise ValueError("請填入 Host Token")
        return _http_json("GET", f"{base}{path}", token)
    return _http_json("GET", f"{base}{path}", "")


def send_sleep(settings: dict) -> dict:
    base = host_base(settings)
    token = str(settings.get("host_token", "")).strip()
    if not token:
        raise ValueError("請填入 Host Token")
    mode = str(settings.get("sleep_mode") or "sleep")
    return _http_json("POST", f"{base}/host/sleep", token, {"mode": mode})


def send_wake(settings: dict, log) -> None:
    mac = str(settings.get("host_mac", "")).strip()
    if not mac:
        raise ValueError("請填入新竹主機 MAC 位址（WoL）")
    broadcast = str(settings.get("wol_broadcast") or "255.255.255.255").strip()
    port = int(settings.get("wol_port") or 9)
    use_relay = bool(settings.get("use_agent_wol_relay"))
    if use_relay:
        token = str(settings.get("host_token", "")).strip()
        if not token:
            raise ValueError("使用代理 WoL 時需 Host Token")
        relay_bc = str(settings.get("wol_relay_broadcast") or broadcast).strip()
        base = host_base(settings)
        log(f"透過主機代理在本機 LAN 送 WoL → {relay_bc}:{port}")
        _http_json(
            "POST",
            f"{base}/host/wol",
            token,
            {"mac": mac, "broadcast": relay_bc, "port": port},
        )
    else:
        log(f"送出 Magic Packet → {broadcast}:{port}（MAC {wol_utils.normalize_mac(mac)}）")
        wol_utils.send_magic_packet(mac, broadcast=broadcast, port=port)


def launch_deskin(settings: dict) -> None:
    path = str(settings.get("deskin_path", "")).strip()
    if not path:
        raise ValueError("請設定 DeskIn 程式路徑（或桌面捷徑）")
    exe = Path(path)
    if not exe.is_file():
        raise FileNotFoundError(f"找不到 DeskIn：{path}")
    args = str(settings.get("deskin_args") or "").strip()
    cmd = [str(exe)]
    if args:
        cmd.extend(args.split())
    subprocess.Popen(cmd)  # noqa: S603


def poll_until_online(settings: dict, log, stop_event: threading.Event) -> bool:
    deadline = time.time() + max(30, int(settings.get("wake_poll_seconds") or 120))
    while time.time() < deadline and not stop_event.is_set():
        try:
            fetch_health(settings, auth=False)
            log("主機已回應 — 可開 DeskIn 遠端")
            return True
        except RuntimeError:
            time.sleep(3)
    return False


def run_gui() -> int:
    import tkinter as tk
    from tkinter import filedialog, messagebox, scrolledtext, ttk

    settings = cfg.load_settings()
    stop_poll = threading.Event()

    root = tk.Tk()
    root.title("Call Coach — 新竹主機喚醒（公司端）")
    root.geometry("520x640")
    root.minsize(480, 560)

    main = ttk.Frame(root, padding=12)
    main.pack(fill="both", expand=True)

    ttk.Label(main, text="新竹主機遠端喚醒 / 休眠", font=("", 12, "bold")).pack(anchor="w")
    ttk.Label(
        main,
        text="僅供公司電腦使用。請先在新竹主機執行 host agent，並在 BIOS/NIC 開啟 Wake-on-LAN。",
        wraplength=480,
    ).pack(anchor="w", pady=(4, 10))

    form = ttk.Frame(main)
    form.pack(fill="x")

    fields: dict[str, tk.Variable] = {}

    def add_row(label: str, key: str, width: int = 42, show: str | None = None) -> None:
        row = ttk.Frame(form)
        row.pack(fill="x", pady=2)
        ttk.Label(row, text=label, width=14).pack(side="left")
        var = tk.StringVar(value=str(settings.get(key, "")))
        fields[key] = var
        entry = ttk.Entry(row, textvariable=var, width=width, show=show or "")
        entry.pack(side="left", fill="x", expand=True)

    add_row("名稱", "profile_name", 30)
    add_row("主機 IP", "host_ip", 30)
    ttk.Label(form, text="（Tailscale 例 100.64.0.2）", font=("", 8)).pack(anchor="e")
    add_row("MAC 位址", "host_mac", 30)
    add_row("WoL 廣播位址", "wol_broadcast", 30)
    ttk.Label(form, text="（同網段廣播 192.168.x.255，或路由器設定的 WoL 目標）", font=("", 8)).pack(anchor="e")
    add_row("WoL Port", "wol_port", 8)
    add_row("Agent Port", "agent_port", 8)
    add_row("Host Token", "host_token", 36, show="*")

    auto_deskin = tk.BooleanVar(value=bool(settings.get("auto_deskin_after_wake")))
    use_relay = tk.BooleanVar(value=bool(settings.get("use_agent_wol_relay")))

    ttk.Checkbutton(main, text="喚醒成功後自動開啟 DeskIn", variable=auto_deskin).pack(anchor="w", pady=(8, 2))
    ttk.Checkbutton(
        main,
        text="WoL 改由主機代理轉送（需家裡有 always-on 中繼或同一台 awake 時測試）",
        variable=use_relay,
    ).pack(anchor="w")

    desk_row = ttk.Frame(form)
    desk_row.pack(fill="x", pady=2)
    ttk.Label(desk_row, text="DeskIn 路徑", width=14).pack(side="left")
    fields["deskin_path"] = tk.StringVar(value=str(settings.get("deskin_path", "")))
    ttk.Entry(desk_row, textvariable=fields["deskin_path"], width=32).pack(side="left", fill="x", expand=True)
    ttk.Button(
        desk_row,
        text="瀏覽…",
        command=lambda: fields["deskin_path"].set(
            filedialog.askopenfilename(title="選擇 DeskIn.exe", filetypes=[("Executable", "*.exe"), ("All", "*.*")])
            or fields["deskin_path"].get()
        ),
    ).pack(side="left", padx=4)

    log_box = scrolledtext.ScrolledText(main, height=10, font=("Consolas", 9))
    log_box.pack(fill="both", expand=True, pady=(10, 8))

    def log(msg: str) -> None:
        log_box.insert("end", f"{time.strftime('%H:%M:%S')} {msg}\n")
        log_box.see("end")

    def gather() -> dict:
        data = cfg.load_settings()
        for key, var in fields.items():
            val = var.get().strip() if isinstance(var, tk.StringVar) else var.get()
            if key in ("wol_port", "agent_port", "wake_poll_seconds"):
                try:
                    data[key] = int(val)
                except ValueError:
                    data[key] = cfg.DEFAULTS[key]
            elif key == "auto_deskin_after_wake":
                pass
            else:
                data[key] = val
        data["auto_deskin_after_wake"] = auto_deskin.get()
        data["use_agent_wol_relay"] = use_relay.get()
        return data

    def save() -> None:
        cfg.save_settings(gather())
        log("已儲存設定")

    def on_wake() -> None:
        stop_poll.set()
        stop_poll.clear()
        try:
            s = gather()
            cfg.save_settings(s)
            send_wake(s, log)
            log("等待主機上線…")

            def worker() -> None:
                ok = poll_until_online(s, log, stop_poll)
                if ok and s.get("auto_deskin_after_wake"):
                    try:
                        launch_deskin(s)
                        log("已啟動 DeskIn")
                    except (OSError, ValueError) as e:
                        log(f"DeskIn：{e}")
                elif not ok:
                    log("等待逾時 — 若主機仍未醒，請確認 BIOS WoL、路由器轉發或改 WoL 廣播位址")

            threading.Thread(target=worker, daemon=True).start()
        except (ValueError, RuntimeError, OSError) as e:
            messagebox.showerror("喚醒失敗", str(e))
            log(f"錯誤：{e}")

    def on_sleep() -> None:
        if not messagebox.askyesno("休眠", "確定要讓新竹主機進入休眠？（需主機目前在線）"):
            return
        try:
            s = gather()
            send_sleep(s)
            log("已送出休眠指令")
        except (ValueError, RuntimeError) as e:
            messagebox.showerror("休眠失敗", str(e))

    def on_status() -> None:
        try:
            s = gather()
            h = fetch_health(s, auth=False)
            log(f"在線 — {h.get('hostname')} @ {', '.join(h.get('addresses') or [])}")
        except RuntimeError as e:
            log(f"離線或 unreachable：{e}")

    def on_deskin() -> None:
        try:
            launch_deskin(gather())
            log("已啟動 DeskIn")
        except (OSError, ValueError) as e:
            messagebox.showerror("DeskIn", str(e))

    btns = ttk.Frame(main)
    btns.pack(fill="x")
    ttk.Button(btns, text="喚醒新竹主機", command=on_wake).pack(side="left", padx=(0, 6))
    ttk.Button(btns, text="查詢狀態", command=on_status).pack(side="left", padx=6)
    ttk.Button(btns, text="遠端休眠", command=on_sleep).pack(side="left", padx=6)
    ttk.Button(btns, text="開啟 DeskIn", command=on_deskin).pack(side="left", padx=6)
    ttk.Button(btns, text="儲存設定", command=save).pack(side="right")

    log(f"設定檔：{cfg.settings_path()}")
    root.mainloop()
    return 0


def main() -> int:
    if sys.platform != "win32":
        print("此工具僅供 Windows 公司電腦使用。")
        return 1
    return run_gui()


if __name__ == "__main__":
    raise SystemExit(main())
