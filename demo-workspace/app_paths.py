"""Path helpers for script and PyInstaller builds."""
from __future__ import annotations

import sys
from pathlib import Path


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def resolve_paths() -> tuple[Path, Path]:
    """Writable ROOT (next to exe) and read-only BUNDLE (PyInstaller _MEIPASS)."""
    if is_frozen():
        root = Path(sys.executable).resolve().parent
        bundle = Path(getattr(sys, "_MEIPASS", root))
        return root, bundle
    root = Path(__file__).resolve().parent
    return root, root
