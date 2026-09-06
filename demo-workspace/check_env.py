#!/usr/bin/env python3
"""環境檢查。用法: python check_env.py"""
from __future__ import annotations

import demo_core


def main() -> int:
    st = demo_core.get_status()
    print("=== 環境檢查 ===\n")
    rows = [
        ("Python 3.10+", st.python_ok, st.python_version),
        ("ffmpeg", st.ffmpeg_ok, ""),
        (".venv", st.venv_ok, ""),
        ("whisperx", st.whisperx_ok, ""),
        ("HF_TOKEN", st.token_ok, ""),
        ("input/", st.input_dir_ok, ""),
        ("output/", st.output_dir_ok, ""),
    ]
    ok = True
    for label, good, extra in rows:
        status = "OK" if good else "缺少!"
        if not good and label in ("Python 3.10+", ".venv", "HF_TOKEN"):
            ok = False
        suffix = f" ({extra})" if extra else ""
        print(f"  [{status:4}] {label}{suffix}")

    print(f"\n  input 內 MP4: {len(st.mp4_files)} 個")
    for name in st.mp4_files:
        print(f"    - {name}")
    if not st.mp4_files:
        print("  [缺少!] 請將 MP4 放入 input 資料夾")
        ok = False

    print("\n" + ("=== 可以轉錄 ===" if st.ready_to_transcribe else "=== 請先修正上述缺少項目 ==="))
    print("\n建議使用圖形介面: python demo_app.py")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
