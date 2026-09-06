#!/usr/bin/env python3
"""
DEMO 一鍵轉錄（不需 .bat）

用法:
  python transcribe_demo.py
  python transcribe_demo.py input/某檔案.mp4
"""
from __future__ import annotations

import sys

import demo_core


def main() -> int:
    mp4 = sys.argv[1] if len(sys.argv) > 1 else None
    if mp4 and mp4.startswith("input/"):
        mp4 = mp4.split("/", 1)[1]
    elif mp4:
        from pathlib import Path
        mp4 = Path(mp4).name
    return demo_core.run_transcribe(mp4)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
