#!/usr/bin/env python3
"""
DEMO 一鍵轉錄（不需 .bat）

用法:
  python transcribe_demo.py
  python transcribe_demo.py input/某檔案.mp4

將 MP4 放入 input/ 後執行即可，SRT 輸出至 output/
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENV_PY = ROOT / ".venv" / "Scripts" / "python.exe"
WHISPERX = ROOT / ".venv" / "Scripts" / "whisperx.exe"
MODEL = "medium"
THREADS = 8
BATCH = 4


def load_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def find_mp4(arg: str | None) -> Path:
    if arg:
        p = Path(arg)
        if not p.is_absolute():
            p = ROOT / p
        if p.exists():
            return p
        raise FileNotFoundError(f"找不到: {p}")

    preferred = ROOT / "input" / "demo.mp4"
    if preferred.exists():
        return preferred

    mp4s = sorted((ROOT / "input").glob("*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True)
    if mp4s:
        return mp4s[0]

    raise FileNotFoundError("input 資料夾沒有 MP4。請放入 input/ 或指定路徑。")


def run(cmd: list[str], env: dict[str, str] | None = None) -> None:
    print(">", " ".join(cmd))
    subprocess.run(cmd, check=True, cwd=ROOT, env=env)


def main() -> int:
    print("=== DEMO 轉錄 ===\n")

    if not VENV_PY.exists():
        print("[錯誤] 尚未安裝。請先執行: python setup_demo.py")
        return 1

    if not WHISPERX.exists():
        print("[錯誤] 找不到 whisperx。請先執行: python setup_demo.py")
        return 1

    env_vars = os.environ.copy()
    env_vars["HF_HOME"] = str(ROOT / "models")
    env_vars["HUGGINGFACE_HUB_CACHE"] = str(ROOT / "models" / "hub")
    env_vars["TORCH_HOME"] = str(ROOT / "models" / "torch")

    dotenv = load_env(ROOT / ".env")
    token = dotenv.get("HF_TOKEN", "").strip()
    if not token or token.startswith("hf_在這裡"):
        print("[錯誤] 請在 .env 設定 HF_TOKEN=hf_你的token")
        return 1
    env_vars["HF_TOKEN"] = token

    (ROOT / "models").mkdir(exist_ok=True)
    (ROOT / "output").mkdir(exist_ok=True)
    (ROOT / "input").mkdir(exist_ok=True)

    try:
        mp4 = find_mp4(sys.argv[1] if len(sys.argv) > 1 else None)
    except FileNotFoundError as e:
        print(f"[錯誤] {e}")
        return 1

    print(f"錄影: {mp4.name}")
    wav = mp4.with_suffix(".wav")
    audio = mp4

    ffmpeg = shutil_which("ffmpeg")
    if ffmpeg:
        print("\n[1/2] 抽取音軌 ...")
        run(
            [
                ffmpeg,
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(mp4),
                "-vn",
                "-ac",
                "1",
                "-ar",
                "16000",
                "-c:a",
                "pcm_s16le",
                str(wav),
            ],
            env=env_vars,
        )
        audio = wav
    else:
        print("[提醒] 未安裝 ffmpeg，直接對 MP4 轉錄")

    print("\n[2/2] 開始轉錄（請接電源，2 小時 DEMO 約 1.5～3 小時）\n")
    run(
        [
            str(WHISPERX),
            str(audio),
            "--model",
            MODEL,
            "--language",
            "zh",
            "--device",
            "cpu",
            "--compute_type",
            "int8",
            "--threads",
            str(THREADS),
            "--batch_size",
            str(BATCH),
            "--diarize",
            "--hf_token",
            token,
            "--min_speakers",
            "2",
            "--max_speakers",
            "2",
            "--output_format",
            "srt",
            "--output_dir",
            str(ROOT / "output"),
        ],
        env=env_vars,
    )

    srts = list((ROOT / "output").glob("*.srt"))
    print("\n=== 完成 ===")
    for s in srts:
        print(f"逐字稿: {s}")
    print("\n上傳 .srt 至 Call Coach:")
    print("https://minoru1017.github.io/For-company-business-use/")
    return 0


def shutil_which(name: str) -> str | None:
    import shutil

    return shutil.which(name)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as e:
        print(f"\n[錯誤] 轉錄失敗 (結束碼 {e.returncode})")
        raise SystemExit(1)
