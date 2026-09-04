#!/usr/bin/env python3
"""一次性安裝：建立 .venv 並安裝 whisperx。用法: python setup_demo.py"""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENV_PY = ROOT / ".venv" / "Scripts" / "python.exe"
REQUIRED = (3, 10)


def run(cmd: list[str], **kwargs) -> None:
    print(">", " ".join(cmd))
    subprocess.run(cmd, check=True, cwd=ROOT, **kwargs)


def main() -> int:
    print("=== DEMO Workspace 安裝 ===")
    print(f"資料夾: {ROOT}\n")

    if sys.version_info < REQUIRED:
        print(f"[錯誤] 需要 Python {REQUIRED[0]}.{REQUIRED[1]}+，目前 {sys.version}")
        return 1

    for name in ("models", "input", "output"):
        (ROOT / name).mkdir(exist_ok=True)

    if not VENV_PY.exists():
        print("建立虛擬環境 .venv ...")
        run([sys.executable, "-m", "venv", str(ROOT / ".venv")])

    run([str(VENV_PY), "-m", "pip", "install", "-U", "pip", "wheel"])
    print("\n安裝 whisperx（首次約 5～15 分鐘）...")
    run([str(VENV_PY), "-m", "pip", "install", "whisperx", "huggingface_hub"])

    env_file = ROOT / ".env"
    if not env_file.exists():
        shutil.copy(ROOT / ".env.example", env_file)
        print("\n已建立 .env — 請填入 HF_TOKEN=hf_你的token")

    if not shutil.which("ffmpeg"):
        print("\n[提醒] 找不到 ffmpeg: winget install Gyan.FFmpeg")

    print("\n=== 安裝完成 ===")
    print("下一步: python transcribe_demo.py")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as e:
        print(f"\n[錯誤] 指令失敗 (結束碼 {e.returncode})")
        raise SystemExit(1)
