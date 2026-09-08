#!/usr/bin/env python3
"""Run during installer wizard — prepares WhisperX + verifies bundled ffmpeg."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import demo_core  # noqa: E402

LOG_PATH = ROOT / "logs" / "install-setup.log"


def main() -> int:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    lines: list[str] = []

    def log(msg: str) -> None:
        lines.append(msg)
        print(msg, flush=True)
        LOG_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")

    log("=== Call Coach 安裝精靈：準備轉錄環境 ===")
    log(f"安裝位置: {ROOT}")
    if demo_core.BUNDLED_FFMPEG.is_file():
        log(f"ffmpeg: {demo_core.BUNDLED_FFMPEG}")
    else:
        log("[提醒] 找不到內建 ffmpeg")

    code = demo_core.run_full_setup(log=log)
    if code == 0:
        (ROOT / ".setup_complete").write_text("ok\n", encoding="utf-8")
        log("=== 環境準備完成 — 可開啟 Call Coach DEMO 使用 ===")
    else:
        log("=== 環境準備失敗 — 請啟動「Call Coach 本機助手」按「修復轉錄環境」重試 ===")
        log(f"日誌檔案: {LOG_PATH}")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
