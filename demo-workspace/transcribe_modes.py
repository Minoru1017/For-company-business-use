"""Transcription mode settings (Faster-Whisper local + optional Azure cloud)."""
from __future__ import annotations

MODE_FAST = "fast"
MODE_STANDARD = "standard"
MODE_AZURE = "azure"

VALID_MODES = {MODE_FAST, MODE_STANDARD, MODE_AZURE}

MODE_LABELS = {
    MODE_FAST: "快速模式（Faster-Whisper small）",
    MODE_STANDARD: "標準模式（Faster-Whisper medium）",
    MODE_AZURE: "Azure 雲端轉錄（zh-TW，較快）",
}

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
    return normalize_mode(mode) == MODE_AZURE


def validate_transcribe_request(mode: str, cloud_consent: bool, azure_ok: bool) -> str | None:
    mode = normalize_mode(mode)
    if mode == MODE_AZURE:
        if not cloud_consent:
            return "使用 Azure 雲端轉錄前，請勾選知情同意"
        if not azure_ok:
            return "請先設定 Azure Speech 金鑰與區域"
    return None
