#!/usr/bin/env python3
"""Run during installer wizard — prepares WhisperX + verifies bundled ffmpeg."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import demo_core  # noqa: E402


def main() -> int:
    print("=== Call Coach 安裝精靈：準備轉錄環境 ===", flush=True)
    print(f"安裝位置: {ROOT}", flush=True)
    if demo_core.BUNDLED_FFMPEG.is_file():
        print(f"ffmpeg: {demo_core.BUNDLED_FFMPEG}", flush=True)
    code = demo_core.run_full_setup(log=lambda m: print(m, flush=True))
    if code == 0:
        (ROOT / ".setup_complete").write_text("ok\n", encoding="utf-8")
        print("=== 環境準備完成 — 可開啟 Call Coach DEMO 使用 ===", flush=True)
    else:
        print("=== 環境準備失敗 — 請查看上方記錄 ===", flush=True)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
