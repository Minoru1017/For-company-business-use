"""Team config: pre-provisioned settings an admin hands to colleagues.

A `team-config.env` file (same KEY=VALUE format as `.env`) can be dropped next to
the assistant (or imported from the UI). On startup its values fill any blank or
placeholder entries in `.env`, so a colleague who installs the assistant with a
team config already has Azure transcription working — no HF token, no WhisperX
download, no venv.

Secrets live in a file the admin shares privately; they are never baked into the
public installer.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

TEAM_CONFIG_NAME = "team-config.env"
ENV_OVERRIDE = "CALL_COACH_TEAM_CONFIG"

# Keys a team config may set. Anything else is ignored (and reported) so a stray
# file can't inject arbitrary environment.
ALLOWED_KEYS = (
    "CALL_COACH_TEAM_NAME",
    "CALL_COACH_DEFAULT_MODE",
    "AZURE_SPEECH_KEY",
    "AZURE_SPEECH_REGION",
    "AZURE_SPEECH_ENDPOINT",
    "HF_TOKEN",
)
SECRET_KEYS = frozenset({"AZURE_SPEECH_KEY", "HF_TOKEN"})
PLACEHOLDER_MARKER = "在這裡"
KEY_RE = re.compile(r"^[A-Z][A-Z0-9_]{2,63}$")
MAX_TEXT_BYTES = 64 * 1024


class TeamConfigError(ValueError):
    pass


def team_config_path(root: Path) -> Path:
    override = os.environ.get(ENV_OVERRIDE, "").strip()
    if override:
        return Path(override)
    return root / TEAM_CONFIG_NAME


def is_placeholder(value: str) -> bool:
    v = value.strip()
    return not v or PLACEHOLDER_MARKER in v


def parse_env_text(text: str) -> tuple[dict[str, str], list[str]]:
    """Parse KEY=VALUE lines. Returns (allowed values, ignored key names)."""
    if len(text.encode("utf-8", errors="replace")) > MAX_TEXT_BYTES:
        raise TeamConfigError("設定檔過大（上限 64 KB）")
    values: dict[str, str] = {}
    ignored: list[str] = []
    for raw in text.replace("\ufeff", "").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.lower().startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if not KEY_RE.match(key):
            continue
        if key not in ALLOWED_KEYS:
            ignored.append(key)
            continue
        if is_placeholder(value):
            continue
        values[key] = value
    if "AZURE_SPEECH_REGION" in values:
        values["AZURE_SPEECH_REGION"] = values["AZURE_SPEECH_REGION"].lower()
    if "CALL_COACH_DEFAULT_MODE" in values:
        values["CALL_COACH_DEFAULT_MODE"] = values["CALL_COACH_DEFAULT_MODE"].lower()
    return values, ignored


def validate_team_config(values: dict[str, str]) -> None:
    from azure_transcribe import REGION_RE
    from transcribe_modes import VALID_MODES

    if not values:
        raise TeamConfigError("設定檔沒有任何可用的設定（需要 AZURE_SPEECH_KEY / AZURE_SPEECH_REGION 或 HF_TOKEN）")
    key = values.get("AZURE_SPEECH_KEY")
    region = values.get("AZURE_SPEECH_REGION")
    if bool(key) != bool(region):
        raise TeamConfigError("AZURE_SPEECH_KEY 與 AZURE_SPEECH_REGION 需同時提供")
    if region and not REGION_RE.match(region):
        raise TeamConfigError(f"AZURE_SPEECH_REGION 格式不正確：{region!r}（例：southeastasia）")
    endpoint = values.get("AZURE_SPEECH_ENDPOINT")
    if endpoint and not endpoint.startswith("https://"):
        raise TeamConfigError("AZURE_SPEECH_ENDPOINT 必須以 https:// 開頭")
    token = values.get("HF_TOKEN")
    if token and not token.startswith("hf_"):
        raise TeamConfigError("HF_TOKEN 必須以 hf_ 開頭")
    mode = values.get("CALL_COACH_DEFAULT_MODE")
    if mode and mode not in VALID_MODES:
        raise TeamConfigError(f"CALL_COACH_DEFAULT_MODE 只能是 {' / '.join(sorted(VALID_MODES))}")


def load_team_config(path: Path) -> dict[str, str]:
    if not path.is_file():
        return {}
    values, _ = parse_env_text(path.read_text(encoding="utf-8", errors="replace"))
    try:
        validate_team_config(values)
    except TeamConfigError:
        return {}
    return values


def merge_missing(team: dict[str, str], env: dict[str, str]) -> dict[str, str]:
    """Values from `team` that should be written because `.env` lacks a real value."""
    updates: dict[str, str] = {}
    for key, value in team.items():
        if is_placeholder(env.get(key, "")):
            updates[key] = value
    return updates


def render_team_config(values: dict[str, str], *, team_name: str = "") -> str:
    lines = [
        "# Call Coach 團隊設定檔（team-config.env）",
        "# 放到 Call Coach 助手資料夾（與 CallCoachAssistant.exe 同層），或在助手頁面按「匯入團隊設定」。",
        "# 含金鑰，請以公司內部管道分享，勿上傳到公開位置。",
        "",
    ]
    if team_name:
        lines.append(f"CALL_COACH_TEAM_NAME={team_name}")
    for key in ALLOWED_KEYS:
        if key == "CALL_COACH_TEAM_NAME":
            continue
        if key in values and not is_placeholder(values[key]):
            lines.append(f"{key}={values[key]}")
    return "\n".join(lines) + "\n"


def redact(values: dict[str, str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for key, value in values.items():
        if key in SECRET_KEYS and value:
            out[key] = value[:4] + "…" + value[-2:] if len(value) > 8 else "***"
        else:
            out[key] = value
    return out
