"""Settings for the company-side wake / DeskIn launcher app."""
from __future__ import annotations

import json
import os
from pathlib import Path

APP_DIR_NAME = "CallCoachCompanyWake"
SETTINGS_FILE = "settings.json"

DEFAULTS = {
    "profile_name": "新竹 GPU 主機",
    "host_ip": "",
    "host_mac": "",
    "wol_broadcast": "255.255.255.255",
    "wol_port": 9,
    "agent_port": 8769,
    "host_token": "",
    "sleep_mode": "sleep",
    "deskin_path": "",
    "deskin_args": "",
    "auto_deskin_after_wake": True,
    "wake_poll_seconds": 120,
    "use_agent_wol_relay": False,
    "wol_relay_broadcast": "255.255.255.255",
}


def config_dir() -> Path:
    base = os.environ.get("APPDATA") or os.environ.get("HOME") or "."
    path = Path(base) / APP_DIR_NAME
    path.mkdir(parents=True, exist_ok=True)
    return path


def settings_path() -> Path:
    return config_dir() / SETTINGS_FILE


def load_settings() -> dict:
    path = settings_path()
    if not path.is_file():
        return dict(DEFAULTS)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return dict(DEFAULTS)
    out = dict(DEFAULTS)
    for key in DEFAULTS:
        if key in data:
            out[key] = data[key]
    return out


def save_settings(data: dict) -> None:
    out = dict(DEFAULTS)
    for key in DEFAULTS:
        if key in data:
            out[key] = data[key]
    settings_path().write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
