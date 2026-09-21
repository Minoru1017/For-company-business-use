"""Small tkinter helpers for the packaged Call Coach assistant (.exe on Windows)."""
from __future__ import annotations

import subprocess
import sys
import threading
from typing import Callable

import demo_core

LogFn = Callable[[str], None]


def confirm_full_uninstall(parent) -> tuple[bool, bool, bool]:
    """Ask whether to remove models and logs. Returns (proceed, remove_models, remove_logs)."""
    from tkinter import messagebox

    if not messagebox.askyesno(
        "完整解除安裝",
        "將刪除本機 WhisperX 環境（.venv）、遠端 Worker 暫存，並啟動 Windows 解除安裝程式\n"
        "（移除 Call Coach 程式與安裝資料夾）。\n\n"
        "input / output / .env 會保留在解除安裝前；若需一併刪除整個資料夾，可在解除安裝精靈中選擇。\n\n"
        "確定要繼續嗎？",
        parent=parent,
    ):
        return False, False, False
    remove_models = messagebox.askyesno(
        "刪除模型快取",
        "是否同時刪除 models 資料夾（AI 模型快取，約 3～6 GB）？\n\n"
        "選「是」可釋放空間；選「否」保留快取，日後重裝較快。",
        parent=parent,
        default="yes",
    )
    remove_logs = messagebox.askyesno(
        "刪除日誌",
        "是否刪除 logs 資料夾內的安裝／轉錄日誌？",
        parent=parent,
        default="yes",
    )
    return True, remove_models, remove_logs


def run_full_uninstall_async(
    parent,
    *,
    remove_models: bool,
    remove_logs: bool,
    on_done: Callable[[int], None] | None = None,
) -> None:
    """Run full uninstall off the UI thread; shows result in a messagebox when finished."""

    def worker() -> None:
        from tkinter import messagebox

        lines: list[str] = []

        def log(msg: str) -> None:
            lines.append(msg)

        code = demo_core.run_full_uninstall(
            log=log,
            remove_models=remove_models,
            remove_logs=remove_logs,
            launch_setup_uninstaller=True,
        )
        summary = "\n".join(lines[-8:]) if lines else ""

        def finish() -> None:
            if on_done:
                on_done(code)
            elif code == 0:
                messagebox.showinfo(
                    "完整解除安裝",
                    "已清理轉錄環境。\n"
                    "若已跳出 Windows 解除安裝精靈，請在精靈中完成移除程式。\n\n"
                    f"{summary}",
                    parent=parent,
                )
            else:
                messagebox.showerror("完整解除安裝", summary or f"失敗（exit code {code}）", parent=parent)

        try:
            parent.after(0, finish)
        except Exception:
            finish()

    threading.Thread(target=worker, daemon=True).start()


def launch_full_uninstall_dialog(parent, *, then_exit: bool = False) -> None:
    proceed, remove_models, remove_logs = confirm_full_uninstall(parent)
    if not proceed:
        return

    if then_exit:
        try:
            parent.destroy()
        except Exception:
            pass
        code = demo_core.run_full_uninstall(
            log=print,
            remove_models=remove_models,
            remove_logs=remove_logs,
            launch_setup_uninstaller=True,
        )
        raise SystemExit(0 if code == 0 else code)

    run_full_uninstall_async(parent, remove_models=remove_models, remove_logs=remove_logs)


def switch_exe_to_host_agent(server, root) -> None:
    """Stop the local assistant HTTP server and re-exec in host-agent mode."""
    from tkinter import messagebox

    if not messagebox.askyesno(
        "啟動新竹主機代理",
        "將停止「本機助手」並改為「新竹主機代理」模式。\n\n"
        "視窗會顯示 Host Token，供公司端「新竹遠端睡眠」使用。\n"
        "本機 DEMO 轉錄 API 會停止，直到您重新開啟本機助手。\n\n"
        "（Worker 與主機代理可各開一個視窗；若已在跑 Worker 請直接另開主機代理。）\n\n"
        "繼續？",
        parent=root,
    ):
        return
    server.shutdown()
    root.destroy()
    server.server_close()
    args = [sys.executable, "--host-agent"]
    if sys.platform == "win32":
        subprocess.Popen(args, cwd=str(demo_core.ROOT), close_fds=False)
    else:
        subprocess.Popen(args, cwd=str(demo_core.ROOT))
    raise SystemExit(0)


def launch_host_agent_subprocess() -> None:
    """Start host-agent mode in a second process (assistant / worker keep running)."""
    args = [sys.executable, "--host-agent"]
    if sys.platform == "win32":
        subprocess.Popen(args, cwd=str(demo_core.ROOT), close_fds=False)
    else:
        subprocess.Popen(args, cwd=str(demo_core.ROOT))


def switch_exe_to_worker(server, root) -> None:
    """Stop the local assistant HTTP server and re-exec this binary in Worker mode."""
    from tkinter import messagebox

    if not messagebox.askyesno(
        "啟動遠端轉錄 Worker",
        "將停止「本機助手」並改為「遠端轉錄 Worker」模式。\n\n"
        "適合家用 GPU 主機：視窗會顯示公司電腦要填的網址與 Token。\n"
        "公司電腦上的瀏覽器將無法再連線本機轉錄 API，直到您重新開啟本機助手。\n\n"
        "繼續？",
        parent=root,
    ):
        return
    server.shutdown()
    root.destroy()
    server.server_close()
    args = [sys.executable, "--worker"]
    if sys.platform == "win32":
        subprocess.Popen(args, cwd=str(demo_core.ROOT), close_fds=False)
    else:
        subprocess.Popen(args, cwd=str(demo_core.ROOT))
    raise SystemExit(0)


def run_launcher() -> str:
    """Mode picker when CallCoachAssistant.exe is started without CLI mode flags.

    Returns assistant|worker|host_agent|full_uninstall|exit.
    """
    import tkinter as tk
    from tkinter import messagebox

    choice = "exit"

    root = tk.Tk()
    root.title("Call Coach")
    root.geometry("460x400")
    root.resizable(False, False)
    tk.Label(root, text="Call Coach 本機助手", font=("", 14, "bold")).pack(pady=(16, 4))
    tk.Label(
        root,
        text="請選擇要啟動的模式（安裝後也可從開始選單直接開啟）",
        fg="#555",
        wraplength=400,
    ).pack(pady=(0, 12))

    def pick(mode: str) -> None:
        nonlocal choice
        choice = mode
        root.destroy()

    tk.Button(root, text="本機助手（公司電腦 · DEMO 轉錄）", command=lambda: pick("assistant"), width=42).pack(pady=4)
    tk.Label(root, text="開啟瀏覽器並提供 127.0.0.1:8765 轉錄 API", fg="#666", font=("", 8)).pack()
    tk.Button(
        root,
        text="遠端轉錄 Worker（家用 GPU 主機）",
        command=lambda: pick("worker"),
        width=42,
    ).pack(pady=(10, 4))
    tk.Label(root, text="顯示網址與 Token，供公司電腦連線轉錄", fg="#666", font=("", 8)).pack()
    tk.Button(
        root,
        text="新竹主機代理（公司可遠端睡眠）",
        command=lambda: pick("host_agent"),
        width=42,
    ).pack(pady=(10, 4))
    tk.Label(root, text="顯示 Host Token · 與本機助手同一支 CallCoachAssistant.exe", fg="#666", font=("", 8)).pack()

    def on_full_uninstall() -> None:
        launch_full_uninstall_dialog(root, then_exit=True)

    tk.Button(root, text="完整解除安裝…", command=on_full_uninstall, width=42).pack(pady=(14, 4))
    tk.Button(root, text="關閉", command=root.destroy, width=42).pack(pady=4)
    root.protocol("WM_DELETE_WINDOW", root.destroy)
    root.mainloop()
    return choice
