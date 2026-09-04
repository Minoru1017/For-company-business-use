#!/usr/bin/env python3
"""環境檢查。用法: python check_env.py"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent

checks = [
    ("工作目錄", ROOT, True),
    (".env", ROOT / ".env", False),
    (".venv python", ROOT / ".venv" / "Scripts" / "python.exe", True),
    ("whisperx", ROOT / ".venv" / "Scripts" / "whisperx.exe", False),
    ("input 資料夾", ROOT / "input", True),
    ("output 資料夾", ROOT / "output", False),
]

print("=== 環境檢查 ===\n")
ok = True
for label, path, required in checks:
    exists = path.exists()
    status = "OK" if exists else ("缺少!" if required else "無")
    if required and not exists:
        ok = False
    print(f"  [{status:4}] {label}: {path}")

mp4s = list((ROOT / "input").glob("*.mp4")) if (ROOT / "input").exists() else []
print(f"\n  input 內 MP4: {len(mp4s)} 個")
for p in mp4s:
    print(f"    - {p.name}")

if not mp4s:
    print("  [缺少!] 請將 MP4 放入 input 資料夾")
    ok = False

env = ROOT / ".env"
if env.exists():
    text = env.read_text(encoding="utf-8")
    has_token = "HF_TOKEN=hf_" in text and "在這裡" not in text
    print(f"\n  HF_TOKEN: {'OK' if has_token else '請填入 .env'}")
    if not has_token:
        ok = False

print("\n" + ("=== 可以執行 python transcribe_demo.py ===" if ok else "=== 請先修正上述缺少項目 ==="))
