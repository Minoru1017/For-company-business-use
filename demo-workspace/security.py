"""Security helpers for the local Call Coach bridge API."""
from __future__ import annotations

import secrets
from pathlib import Path

API_TOKEN = secrets.token_urlsafe(32)
MAX_UPLOAD_BYTES = 6 * 1024 * 1024 * 1024  # 6 GB
TOKEN_HEADER = "X-Call-Coach-Token"

ALLOWED_ORIGINS = frozenset(
    {
        "https://minoru1017.github.io",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    }
)

PUBLIC_API_PATHS = frozenset({"/api/bootstrap"})


def is_allowed_origin(origin: str) -> bool:
    return origin in ALLOWED_ORIGINS


def is_allowed_host(host: str, port: int = 8765) -> bool:
    host = host.split(",")[0].strip().lower()
    return host in (f"127.0.0.1:{port}", f"localhost:{port}")


def resolve_under(path: Path, root: Path) -> Path:
    resolved = path.resolve()
    root_resolved = root.resolve()
    if not resolved.is_relative_to(root_resolved):
        raise ValueError("路徑不允許")
    return resolved
