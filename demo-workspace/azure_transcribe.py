"""Azure Speech → SRT (zh-TW, speaker diarization).

Two backends:
- Fast transcription REST API (default). Pure stdlib, so it works inside the
  packaged assistant with no WhisperX venv and no Azure SDK — the zero-setup path.
- Speech SDK ConversationTranscriber (fallback when the resource's region has no
  fast transcription, and the SDK happens to be importable, e.g. dev mode).
"""
from __future__ import annotations

import json
import re
import threading
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Callable

from srt_utils import seconds_to_timestamp

LogFn = Callable[[str], None]

CANCEL_EXIT = 130
TICKS_PER_SECOND = 10_000_000

FAST_API_VERSION = "2024-11-15"
# Regions that offer the fast transcription API (Speech service regions table).
# eastasia (Hong Kong) is notably absent — Taiwan users should pick southeastasia or japaneast.
FAST_TRANSCRIPTION_REGIONS = frozenset(
    {
        "australiaeast", "brazilsouth", "canadacentral", "centralindia", "eastus", "eastus2",
        "francecentral", "germanywestcentral", "italynorth", "japaneast", "japanwest",
        "koreacentral", "northcentralus", "northeurope", "southcentralus", "southeastasia",
        "swedencentral", "uksouth", "westeurope", "westus", "westus2", "westus3",
    }
)
RECOMMENDED_FAST_REGIONS = ("southeastasia", "japaneast")
# Fast transcription limits (Standard S0): < 2 h with diarization, < 250 MB upload.
FAST_MAX_BYTES = 250 * 1024 * 1024
FAST_TIMEOUT_SECONDS = 20 * 60
REGION_RE = re.compile(r"^[a-z0-9]{3,32}$")


def region_supports_fast(region: str) -> bool:
    return region.strip().lower() in FAST_TRANSCRIPTION_REGIONS


def fast_transcription_url(region: str, endpoint: str | None = None) -> str:
    base = (endpoint or "").strip().rstrip("/")
    if not base:
        base = f"https://{region.strip().lower()}.api.cognitive.microsoft.com"
    if not base.startswith("https://"):
        raise ValueError("Azure 端點必須是 https:// 開頭")
    return f"{base}/speechtotext/transcriptions:transcribe?api-version={FAST_API_VERSION}"


def encode_multipart(fields: dict[str, str], file_field: str, filename: str, data: bytes) -> tuple[bytes, str]:
    boundary = f"----CallCoach{uuid.uuid4().hex}"
    parts: list[bytes] = []
    for name, value in fields.items():
        parts.append(
            (
                f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n"
                f"Content-Type: application/json\r\n\r\n{value}\r\n"
            ).encode("utf-8")
        )
    parts.append(
        (
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{file_field}\"; filename=\"{filename}\"\r\n"
            "Content-Type: application/octet-stream\r\n\r\n"
        ).encode("utf-8")
    )
    parts.append(data)
    parts.append(f"\r\n--{boundary}--\r\n".encode("utf-8"))
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def phrases_to_srt(phrases: list[dict]) -> str:
    """Fast-transcription `phrases` → SRT with [SPEAKER_NN] prefixes (WhisperX-compatible)."""
    lines: list[str] = []
    speaker_map: dict[str, str] = {}
    idx = 0
    for phrase in sorted(phrases, key=lambda p: int(p.get("offsetMilliseconds", 0))):
        text = str(phrase.get("text", "")).strip()
        if not text:
            continue
        start = int(phrase.get("offsetMilliseconds", 0)) / 1000.0
        end = start + int(phrase.get("durationMilliseconds", 0)) / 1000.0
        raw_speaker = phrase.get("speaker")
        speaker = map_speaker_id(str(raw_speaker) if raw_speaker is not None else None, speaker_map)
        idx += 1
        lines.append(str(idx))
        lines.append(f"{seconds_to_timestamp(start)} --> {seconds_to_timestamp(max(end, start))}")
        lines.append(f"[{speaker}] {text}")
        lines.append("")
    return "\n".join(lines).strip() + ("\n" if lines else "")


class FastTranscriptionUnavailable(Exception):
    """The resource/region does not serve the fast transcription API."""


def _describe_http_error(status: int, body: str, region: str) -> tuple[str, bool]:
    """(message, fast_unavailable)"""
    code = ""
    try:
        code = str(json.loads(body).get("error", {}).get("code", ""))
    except (ValueError, AttributeError):
        pass
    if status == 401 or status == 403:
        return "Azure 金鑰無效或無權限（請確認 Speech 資源的金鑰與區域）", False
    if status == 404 or code in {"NotFound", "InvalidRegion", "UnsupportedApiVersion"}:
        return (
            f"區域 {region} 沒有提供 Fast Transcription（建議改用 "
            f"{' / '.join(RECOMMENDED_FAST_REGIONS)}）",
            True,
        )
    if status == 429:
        return "Azure 回應請求過多（429），請稍後再試", False
    if code == "AudioLengthLimitExceeded":
        return "音檔超過 Azure Fast Transcription 上限（含發言者辨識為 2 小時）", False
    snippet = body.strip().replace("\n", " ")[:200]
    return f"Azure 回應 HTTP {status}：{snippet or code or '未知錯誤'}", False


def run_azure_fast_transcribe(
    audio: Path,
    output_srt: Path,
    *,
    speech_key: str,
    speech_region: str,
    log: LogFn,
    cancel_check: Callable[[], bool],
    endpoint: str | None = None,
    max_speakers: int = 2,
) -> int:
    size = audio.stat().st_size
    if size > FAST_MAX_BYTES:
        log(f"[錯誤] 音檔 {size / (1024**2):.0f} MB 超過 Azure 上限 250 MB（約 2 小時 16 kHz 單聲道）")
        return 1
    url = fast_transcription_url(speech_region, endpoint)
    definition = json.dumps(
        {
            "locales": ["zh-TW"],
            "diarization": {"maxSpeakers": max(2, max_speakers), "enabled": True},
            "profanityFilterMode": "None",
        }
    )
    body, content_type = encode_multipart({"definition": definition}, "audio", audio.name, audio.read_bytes())
    log(f"[Azure] 上傳 {size / (1024**2):.0f} MB 音訊至 Azure Speech Fast Transcription（{speech_region}，zh-TW，發言者辨識）…")
    log("[Azure] 音訊僅用於轉錄，不會存入 Call Coach 網站；Azure 處理完即不保留")

    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Ocp-Apim-Subscription-Key": speech_key,
            "Content-Type": content_type,
            "Accept": "application/json",
        },
    )

    result: dict = {}

    def worker() -> None:
        try:
            with urllib.request.urlopen(req, timeout=FAST_TIMEOUT_SECONDS) as resp:
                result["status"] = resp.status
                result["body"] = resp.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as e:
            result["status"] = e.code
            result["body"] = e.read().decode("utf-8", errors="replace")
        except Exception as e:  # noqa: BLE001
            result["exc"] = e

    thread = threading.Thread(target=worker, daemon=True)
    started = time.monotonic()
    next_log_at = 30
    thread.start()
    while thread.is_alive():
        if cancel_check():
            log("[已取消] 已放棄等待 Azure 回應")
            return CANCEL_EXIT
        thread.join(timeout=0.5)
        elapsed = int(time.monotonic() - started)
        if elapsed >= next_log_at:
            log(f"[Azure] 等待 Azure 處理中…（{elapsed // 60} 分 {elapsed % 60} 秒）")
            next_log_at += 30

    if "exc" in result:
        log(f"[錯誤] 無法連線 Azure：{result['exc']}")
        return 1
    status = int(result.get("status", 0))
    body_text = result.get("body", "")
    if status != 200:
        message, fast_unavailable = _describe_http_error(status, body_text, speech_region)
        if fast_unavailable:
            raise FastTranscriptionUnavailable(message)
        log(f"[錯誤] {message}")
        return 1
    try:
        payload = json.loads(body_text)
    except ValueError:
        log("[錯誤] Azure 回傳的內容不是 JSON")
        return 1
    phrases = payload.get("phrases") or []
    srt = phrases_to_srt(phrases)
    if not srt.strip():
        log("[錯誤] Azure 未回傳任何轉錄結果（音檔可能沒有語音）")
        return 1
    output_srt.parent.mkdir(parents=True, exist_ok=True)
    output_srt.write_text(srt, encoding="utf-8")
    dur = int(payload.get("durationMilliseconds", 0)) // 1000
    log(f"[Azure] 完成：{len(phrases)} 句、音訊 {dur // 60} 分 {dur % 60} 秒、耗時 {int(time.monotonic() - started)} 秒 → {output_srt.name}")
    return 0


def ticks_to_seconds(ticks: int) -> float:
    return max(0.0, ticks / TICKS_PER_SECOND)


def map_speaker_id(raw: str | None, mapping: dict[str, str]) -> str:
    key = (raw or "Guest-1").strip()
    if key not in mapping:
        mapping[key] = f"SPEAKER_{len(mapping):02d}"
    return mapping[key]


def segments_to_srt(segments: list[dict]) -> str:
    lines: list[str] = []
    speaker_map: dict[str, str] = {}
    for i, seg in enumerate(segments, start=1):
        start = ticks_to_seconds(int(seg.get("offset", 0)))
        duration = ticks_to_seconds(int(seg.get("duration", 0)))
        end = start + duration
        speaker = map_speaker_id(seg.get("speaker"), speaker_map)
        text = str(seg.get("text", "")).strip()
        if not text:
            continue
        lines.append(str(i))
        lines.append(f"{seconds_to_timestamp(start)} --> {seconds_to_timestamp(end)}")
        lines.append(f"[{speaker}] {text}")
        lines.append("")
    return "\n".join(lines).strip() + ("\n" if lines else "")


def run_azure_transcribe(
    audio: Path,
    output_srt: Path,
    *,
    speech_key: str,
    speech_region: str,
    log: LogFn,
    cancel_check: Callable[[], bool],
    endpoint: str | None = None,
) -> int:
    """Prefer the stdlib REST path; fall back to the SDK only if REST is unavailable."""
    region = speech_region.strip().lower()
    if not REGION_RE.match(region):
        log(f"[錯誤] Azure 區域格式不正確：{speech_region!r}（例：southeastasia）")
        return 1
    if not region_supports_fast(region) and not endpoint:
        log(
            f"[Azure] 區域 {region} 未列在 Fast Transcription 支援清單，仍會嘗試；"
            f"若失敗請改用 {' / '.join(RECOMMENDED_FAST_REGIONS)}"
        )
    try:
        return run_azure_fast_transcribe(
            audio,
            output_srt,
            speech_key=speech_key,
            speech_region=region,
            log=log,
            cancel_check=cancel_check,
            endpoint=endpoint,
        )
    except FastTranscriptionUnavailable as e:
        log(f"[Azure] {e}")
    except ValueError as e:
        log(f"[錯誤] {e}")
        return 1
    log("[Azure] 改用 Speech SDK 逐句轉錄（較慢）…")
    return run_azure_sdk_transcribe(
        audio,
        output_srt,
        speech_key=speech_key,
        speech_region=region,
        log=log,
        cancel_check=cancel_check,
    )


def run_azure_sdk_transcribe(
    audio: Path,
    output_srt: Path,
    *,
    speech_key: str,
    speech_region: str,
    log: LogFn,
    cancel_check: Callable[[], bool],
) -> int:
    try:
        import azure.cognitiveservices.speech as speechsdk
    except ImportError:
        log(
            "[錯誤] 此區域沒有 Fast Transcription，且未安裝 Azure Speech SDK。"
            f"建議把 Speech 資源建立在 {' / '.join(RECOMMENDED_FAST_REGIONS)}，即可免安裝直接使用"
        )
        return 1

    log("[Azure] 上傳音訊至 Microsoft Azure Speech 進行轉錄（zh-TW，含發言者辨識）…")
    log("[Azure] 音訊僅用於轉錄，不會存入 Call Coach 網站")

    speech_config = speechsdk.SpeechConfig(subscription=speech_key, region=speech_region)
    speech_config.speech_recognition_language = "zh-TW"
    speech_config.set_property(
        speechsdk.PropertyId.SpeechServiceResponse_RequestWordLevelTimestamps,
        "true",
    )

    audio_config = speechsdk.audio.AudioConfig(filename=str(audio))
    transcriber = speechsdk.transcription.ConversationTranscriber(speech_config, audio_config)

    segments: list[dict] = []
    done = threading.Event()
    error_message: str | None = None

    def on_transcribed(evt: speechsdk.SpeechRecognitionEventArgs) -> None:
        if cancel_check():
            return
        result = evt.result
        if result.reason != speechsdk.ResultReason.RecognizedSpeech:
            return
        segments.append(
            {
                "speaker": result.speaker_id,
                "text": result.text,
                "offset": result.offset,
                "duration": result.duration,
            }
        )
        preview = result.text.replace("\n", " ")
        if len(preview) > 60:
            preview = preview[:60] + "…"
        log(f"  [Azure {result.speaker_id}] {preview}")

    def on_canceled(evt: speechsdk.SessionEventArgs) -> None:
        nonlocal error_message
        details = getattr(evt, "result", None)
        if details is not None and details.reason == speechsdk.ResultReason.Canceled:
            cancellation = speechsdk.CancellationDetails.from_result(details)
            error_message = cancellation.error_details or "Azure 轉錄已取消"
        done.set()

    def on_stopped(_evt: speechsdk.SessionEventArgs) -> None:
        done.set()

    transcriber.transcribed.connect(on_transcribed)
    transcriber.canceled.connect(on_canceled)
    transcriber.session_stopped.connect(on_stopped)

    try:
        transcriber.start_transcribing_async().get()
        while not done.is_set():
            if cancel_check():
                log("[已取消] 正在停止 Azure 轉錄…")
                transcriber.stop_transcribing_async().get()
                return CANCEL_EXIT
            time.sleep(0.5)
        transcriber.stop_transcribing_async().get()
    except Exception as e:  # noqa: BLE001
        log(f"[錯誤] Azure 轉錄失敗：{e}")
        return 1

    if error_message:
        log(f"[錯誤] {error_message}")
        return 1
    if not segments:
        log("[錯誤] Azure 未回傳任何轉錄結果")
        return 1

    output_srt.parent.mkdir(parents=True, exist_ok=True)
    output_srt.write_text(segments_to_srt(segments), encoding="utf-8")
    log(f"[Azure] 已寫入 {output_srt.name}（{len(segments)} 句）")
    return 0
