"""Subprocess helpers: keep child processes from flashing console windows on Windows."""
from __future__ import annotations

import subprocess
import sys


def no_window_kwargs() -> dict:
    """Extra kwargs for subprocess.run/Popen so children don't open a console window.

    The assistant runs as a windowless GUI exe (PyInstaller console=False); without
    these flags every ffmpeg / ffprobe / whisperx / taskkill call pops a cmd window.
    """
    if sys.platform != "win32":
        return {}
    startupinfo = subprocess.STARTUPINFO()
    startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startupinfo.wShowWindow = subprocess.SW_HIDE
    return {
        "creationflags": subprocess.CREATE_NO_WINDOW,
        "startupinfo": startupinfo,
    }


def quiet_run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    kwargs.setdefault("check", False)
    return subprocess.run(cmd, **no_window_kwargs(), **kwargs)
