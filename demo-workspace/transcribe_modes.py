"""Transcription mode settings (Faster-Whisper local, Azure cloud, or your own remote GPU worker)."""
from __future__ import annotations

MODE_FAST = "fast"
MODE_STANDARD = "standard"
MODE_AZURE = "azure"
MODE_REMOTE = "remote"

VALID_MODES = {MODE_FAST, MODE_STANDARD, MODE_AZURE, MODE_REMOTE}

MODE_LABELS = {
    MODE_FAST: "快速模式（Faster-Whisper small）",
    MODE_STANDARD: "標準模式（Faster-Whisper medium）",
    MODE_AZURE: "Azure 雲端轉錄（zh-TW，較快）",
    MODE_REMOTE: "遠端主機轉錄（自己的 GPU 電腦）",
}

# Modes where the audio leaves this computer and the user must acknowledge it first.
OFFSITE_MODES = {MODE_AZURE, MODE_REMOTE}

# WhisperX uses faster-whisper under the hood for local inference.
MODE_MODELS = {
    MODE_FAST: "small",
    MODE_STANDARD: "medium",
}


def normalize_mode(mode: str | None) -> str:
    if mode in VALID_MODES:
        return mode
    return MODE_STANDARD


def model_for_mode(mode: str) -> str:
    """Local Whisper model for a mode; Azure has no local model, so fall back to standard."""
    return MODE_MODELS.get(normalize_mode(mode), MODE_MODELS[MODE_STANDARD])


def requires_cloud_consent(mode: str) -> bool:
    return normalize_mode(mode) in OFFSITE_MODES


def validate_transcribe_request(mode: str, cloud_consent: bool, azure_ok: bool, remote_ok: bool = False) -> str | None:
    mode = normalize_mode(mode)
    if mode == MODE_AZURE:
        if not cloud_consent:
            return "使用 Azure 雲端轉錄前，請勾選知情同意"
        if not azure_ok:
            return "請先設定 Azure Speech 金鑰與區域"
    if mode == MODE_REMOTE:
        if not cloud_consent:
            return "使用遠端主機轉錄前，請勾選知情同意（音訊會傳到你指定的主機）"
        if not remote_ok:
            return "請先設定遠端主機網址與 Worker Token"
    return None
