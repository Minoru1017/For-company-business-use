"""Azure Speech conversation transcription → SRT (zh-TW, speaker diarization)."""
from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Callable

from srt_utils import seconds_to_timestamp

LogFn = Callable[[str], None]

CANCEL_EXIT = 130
TICKS_PER_SECOND = 10_000_000


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
) -> int:
    try:
        import azure.cognitiveservices.speech as speechsdk
    except ImportError:
        log("[錯誤] 未安裝 azure-cognitiveservices-speech，請重新執行「完整環境安裝」")
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
