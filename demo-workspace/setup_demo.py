#!/usr/bin/env python3
"""一次性安裝。用法: python setup_demo.py"""
from __future__ import annotations

import sys

import demo_core


def main() -> int:
    return demo_core.run_setup()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
