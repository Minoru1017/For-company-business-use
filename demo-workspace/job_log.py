"""Persist install/transcribe job logs for troubleshooting."""
from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path

from demo_core import ROOT, get_status, is_frozen, PORTABLE_PY

LOGS_DIR = ROOT / "logs"
LATEST_LOG = LOGS_DIR / "latest-install.log"
HF_RE = re.compile(r"hf_[A-Za-z0-9]+")
# tqdm-style bar: "<label>:  45%|████▌     | 9/20 [01:00<01:10, 6.4s/it]"
PROGRESS_RE = re.compile(r"^(?P<prefix>.*?)\s*\d{1,3}%\|")
PROGRESS_LOOKBACK = 8
MAX_LOG_LINES = 5000
HEAD_KEEP = 200
TRIM_MARKER = "……（中段記錄過長已省略）……"


def sanitize_log_line(line: str) -> str:
    return HF_RE.sub("hf_***", line)


def progress_key(line: str) -> str | None:
    m = PROGRESS_RE.match(line)
    return m.group("prefix") if m else None


def append_compact(logs: list[str], msg: str) -> None:
    """Append a job log line, collapsing progress-bar updates in place.

    WhisperX / huggingface print tqdm bars with carriage returns; read in text
    mode each update arrives as its own line, so a long transcription would
    otherwise push tens of thousands of lines through /api/job every 0.8 s.
    """
    key = progress_key(msg)
    if key is not None:
        start = max(0, len(logs) - PROGRESS_LOOKBACK)
        for i in range(len(logs) - 1, start - 1, -1):
            if progress_key(logs[i]) == key:
                logs[i] = msg
                return
    logs.append(msg)
    if len(logs) > MAX_LOG_LINES:
        excess = len(logs) - MAX_LOG_LINES
        del logs[HEAD_KEEP : HEAD_KEEP + excess]
        if logs[HEAD_KEEP] != TRIM_MARKER:
            logs.insert(HEAD_KEEP, TRIM_MARKER)


def collect_diagnostics(kind: str) -> list[str]:
    st = get_status()
    lines = [
        f"時間: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"工作類型: {kind}",
        f"工作目錄: {ROOT}",
        f"Python: {st.python_version} (ok={st.python_ok})",
        f"可攜式 Python: {PORTABLE_PY.is_file()} ({PORTABLE_PY})",
        f"打包模式: {is_frozen()}",
        f"winget: {st.winget_ok}",
        f"ffmpeg: {st.ffmpeg_ok}",
        f"venv: {st.venv_ok}",
        f"whisperx: {st.whisperx_ok}",
        f"HF_TOKEN 已設定: {st.token_ok}",
    ]
    if st.python_warning:
        lines.append(f"提醒: {st.python_warning}")
    return lines


def save_job_log(kind: str, logs: list[str], exit_code: int) -> Path:
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    safe_kind = re.sub(r"[^\w-]+", "_", kind) or "job"
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    filename = f"{safe_kind}-{stamp}-exit{exit_code}.log"
    path = LOGS_DIR / filename

    body_lines = [
        "=== Call Coach 本機助手 — 工作日誌 ===",
        "",
        "--- 環境資訊 ---",
        *collect_diagnostics(kind),
        "",
        "--- 執行記錄 ---",
        *[sanitize_log_line(line) for line in logs],
        "",
        f"--- 結束：exit code {exit_code} ---",
    ]
    text = "\n".join(body_lines) + "\n"
    path.write_text(text, encoding="utf-8")
    LATEST_LOG.write_text(text, encoding="utf-8")
    return path


def read_latest_log() -> tuple[str, str, str]:
    if not LATEST_LOG.is_file():
        raise FileNotFoundError("尚無安裝日誌")
    return LATEST_LOG.name, LATEST_LOG.read_text(encoding="utf-8"), str(LOGS_DIR)
