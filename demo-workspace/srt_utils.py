"""SRT parsing and merging for parallel DEMO transcription."""
from __future__ import annotations

import re
from dataclasses import dataclass

SPEAKER_RE = re.compile(r"\[(SPEAKER_\d+)\]\s*")
TIMESTAMP_RE = re.compile(
    r"(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})"
)


@dataclass
class SrtCue:
    start: float
    end: float
    text: str


def timestamp_to_seconds(h: int, m: int, s: int, ms: int) -> float:
    return h * 3600 + m * 60 + s + ms / 1000.0


def seconds_to_timestamp(sec: float) -> str:
    if sec < 0:
        sec = 0.0
    ms = int(round((sec % 1) * 1000))
    total = int(sec)
    h = total // 3600
    m = (total % 3600) // 60
    s = total % 60
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def parse_srt(content: str) -> list[SrtCue]:
    content = content.replace("\r\n", "\n").strip()
    if not content:
        return []

    cues: list[SrtCue] = []
    blocks = re.split(r"\n\s*\n", content)
    for block in blocks:
        lines = [ln.strip() for ln in block.split("\n") if ln.strip()]
        if len(lines) < 2:
            continue
        time_line = lines[1] if lines[0].isdigit() else lines[0]
        text_lines = lines[2:] if lines[0].isdigit() else lines[1:]
        match = TIMESTAMP_RE.search(time_line)
        if not match:
            continue
        g = [int(x) for x in match.groups()]
        start = timestamp_to_seconds(*g[:4])
        end = timestamp_to_seconds(*g[4:])
        text = "\n".join(text_lines).strip()
        if text:
            cues.append(SrtCue(start=start, end=end, text=text))
    return cues


def serialize_srt(cues: list[SrtCue]) -> str:
    parts: list[str] = []
    for idx, cue in enumerate(cues, start=1):
        parts.append(str(idx))
        parts.append(f"{seconds_to_timestamp(cue.start)} --> {seconds_to_timestamp(cue.end)}")
        parts.append(cue.text)
        parts.append("")
    return "\n".join(parts).rstrip() + "\n"


def merge_srt_parts(parts: list[tuple[str, float]]) -> str:
    """Merge chunk SRT texts with per-chunk time offsets (seconds)."""
    merged: list[SrtCue] = []
    for content, offset in parts:
        for cue in parse_srt(content):
            merged.append(
                SrtCue(
                    start=cue.start + offset,
                    end=cue.end + offset,
                    text=cue.text,
                )
            )
    merged.sort(key=lambda c: (c.start, c.end))
    return serialize_srt(merged)
