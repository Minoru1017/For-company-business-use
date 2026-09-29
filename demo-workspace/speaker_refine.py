"""Re-cut WhisperX cues at word-level speaker changes.

WhisperX labels every word with a diarization speaker, but its SRT writer keeps
Whisper's own segments (often 20–30 s, several turns) and stamps each with the
majority speaker. On short back-and-forth sales calls that hides the customer's
replies inside the salesperson's cue. We read the JSON output (``--output_format
all``) and rebuild the SRT so a new cue starts whenever the speaker changes.
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from srt_utils import SrtCue, serialize_srt

LogFn = Callable[[str], None]

# WhisperX ``--output_format all`` also writes these next to the SRT; the app only
# ever consumed the SRT so we tidy them away afterwards.
EXTRA_SUFFIXES = (".vtt", ".txt", ".tsv", ".json", ".aud")

# A speaker run this short in the middle of someone else's sentence is almost
# always diarization jitter (one character flips), not a real interjection.
MIN_RUN_CHARS = 2
MIN_RUN_SEC = 0.5

_PUNCT_RE = re.compile(r"[\s,.;:!?，。；：！？、「」『』（）()\[\]【】…—\-~～]+")


@dataclass
class Word:
    text: str
    start: float | None
    end: float | None
    speaker: str | None
    # True when the segment text had whitespace right before this token (e.g. "用 Google Meet")
    space_before: bool = False


@dataclass
class SpeakerCue:
    start: float
    end: float
    speaker: str | None
    text: str


def _num(value) -> float | None:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if f >= 0 else None


def _words_of_segment(seg: dict) -> list[Word]:
    words: list[Word] = []
    for w in seg.get("words") or []:
        text = str(w.get("word", "") if isinstance(w, dict) else w)
        if not text:
            continue
        words.append(
            Word(
                text=text,
                start=_num(w.get("start")) if isinstance(w, dict) else None,
                end=_num(w.get("end")) if isinstance(w, dict) else None,
                speaker=(str(w.get("speaker")) if isinstance(w, dict) and w.get("speaker") else None),
            )
        )
    return words


def _fill_speakers(words: list[Word], fallback: str | None) -> None:
    """Punctuation / unaligned characters carry no speaker: inherit from the neighbour."""
    last: str | None = None
    for w in words:
        if w.speaker:
            last = w.speaker
        elif last:
            w.speaker = last
    nxt: str | None = None
    for w in reversed(words):
        if w.speaker:
            nxt = w.speaker
        elif nxt:
            w.speaker = nxt
    for w in words:
        if not w.speaker:
            w.speaker = fallback


def attach_spacing(words: list[Word], seg_text: str) -> None:
    """WhisperX drops whitespace from zh word lists; recover it from the segment text.

    Words are consecutive non-space tokens of ``seg_text`` (one character each for
    Chinese). When the token stream stops matching we leave the remaining words as
    they are rather than guess.
    """
    text = str(seg_text or "")
    pos = 0
    for w in words:
        skipped = False
        while pos < len(text) and text[pos].isspace():
            pos += 1
            skipped = True
        tok = w.text.strip()
        if not tok or not text.startswith(tok, pos):
            return
        w.space_before = skipped
        pos += len(tok)


def join_words(words: list[Word]) -> str:
    out = ""
    for w in words:
        tok = w.text.strip()
        if not tok:
            continue
        if out and w.space_before:
            out += " "
        out += tok
    return out.strip()


def _visible_chars(text: str) -> int:
    return len(_PUNCT_RE.sub("", text))


def _runs_of(words: list[Word]) -> list[list[Word]]:
    runs: list[list[Word]] = []
    for w in words:
        if runs and runs[-1][-1].speaker == w.speaker:
            runs[-1].append(w)
        else:
            runs.append([w])
    return runs


def _run_duration(run: list[Word]) -> float | None:
    starts = [w.start for w in run if w.start is not None]
    ends = [w.end for w in run if w.end is not None]
    if not starts or not ends:
        return None
    return max(0.0, max(ends) - min(starts))


def _relabel(run: list[Word], speaker: str | None) -> None:
    for w in run:
        w.speaker = speaker


def _absorb_jitter(runs: list[list[Word]]) -> list[list[Word]]:
    """Merge diarization flips into the surrounding speaker.

    A one/two-character run sandwiched between two runs of the *same* other
    speaker ("…時間[會]不會太晚") is jitter. A short run at a real turn boundary
    ("你好。" then the other side answers) is kept — unless it is a lone
    character, which we hand to the neighbouring speaker.
    """
    if len(runs) < 2:
        return runs
    out: list[list[Word]] = []
    for idx, run in enumerate(runs):
        chars = _visible_chars(join_words(run))
        dur = _run_duration(run)
        tiny = chars <= MIN_RUN_CHARS and (dur is None or dur < MIN_RUN_SEC)
        prev = out[-1] if out else None
        nxt = runs[idx + 1] if idx + 1 < len(runs) else None
        sandwiched = prev is not None and nxt is not None and prev[0].speaker == nxt[0].speaker
        if tiny and sandwiched:
            _relabel(run, prev[0].speaker)
            prev.extend(run)
        elif tiny and chars <= 1 and prev is not None:
            _relabel(run, prev[0].speaker)
            prev.extend(run)
        elif tiny and chars <= 1 and nxt is not None:
            _relabel(run, nxt[0].speaker)
            nxt[:0] = run
        else:
            out.append(run)
    # Absorbing may have made neighbours share a speaker again.
    merged: list[list[Word]] = []
    for run in out:
        if merged and merged[-1][0].speaker == run[0].speaker:
            merged[-1].extend(run)
        else:
            merged.append(run)
    return merged


def cut_by_speaker(result: dict) -> list[SpeakerCue] | None:
    """Return speaker-homogeneous cues, or None when the JSON has no usable diarization."""
    segments = result.get("segments") if isinstance(result, dict) else None
    if not isinstance(segments, list) or not segments:
        return None

    any_word_speaker = False
    cues: list[SpeakerCue] = []
    for seg in segments:
        if not isinstance(seg, dict):
            continue
        seg_start = _num(seg.get("start"))
        seg_end = _num(seg.get("end"))
        seg_speaker = str(seg.get("speaker")) if seg.get("speaker") else None
        words = _words_of_segment(seg)
        if any(w.speaker for w in words):
            any_word_speaker = True
        if not words:
            text = str(seg.get("text", "")).strip()
            if text and seg_start is not None:
                cues.append(SpeakerCue(seg_start, seg_end if seg_end is not None else seg_start, seg_speaker, text))
            continue

        _fill_speakers(words, seg_speaker)
        attach_spacing(words, str(seg.get("text", "")))
        runs = _absorb_jitter(_runs_of(words))
        prev_end = seg_start
        for i, run in enumerate(runs):
            text = join_words(run)
            if not text:
                continue
            starts = [w.start for w in run if w.start is not None]
            ends = [w.end for w in run if w.end is not None]
            start = min(starts) if starts else prev_end
            if start is None:
                continue
            if ends:
                end = max(ends)
            else:
                nxt = next((w.start for r in runs[i + 1 :] for w in r if w.start is not None), None)
                end = nxt if nxt is not None else (seg_end if seg_end is not None else start)
            end = max(end, start)
            cues.append(SpeakerCue(start, end, run[0].speaker, text))
            prev_end = end

    if not any_word_speaker:
        return None
    cues.sort(key=lambda c: (c.start, c.end))
    for a, b in zip(cues, cues[1:]):
        if a.end > b.start:
            a.end = b.start
    return cues


def cues_to_srt(cues: list[SpeakerCue]) -> str:
    """Same ``[SPEAKER_00]: text`` prefix WhisperX writes, so the web app parses it unchanged."""
    out: list[SrtCue] = []
    for c in cues:
        text = f"[{c.speaker}]: {c.text}" if c.speaker else c.text
        out.append(SrtCue(start=c.start, end=c.end, text=text))
    return serialize_srt(out)


def _write_atomic(path: Path, text: str) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def cleanup_extra_outputs(output_dir: Path, stem: str) -> None:
    for suffix in EXTRA_SUFFIXES:
        try:
            (output_dir / f"{stem}{suffix}").unlink()
        except OSError:
            pass


def refine_speaker_srt(output_dir: Path, stem: str, log: LogFn | None = None) -> bool:
    """Rewrite ``<stem>.srt`` from ``<stem>.json`` with speaker-change cuts.

    Never raises: on any problem the WhisperX SRT is left untouched and False is
    returned. Extra WhisperX formats are removed either way.
    """
    say = log or (lambda _m: None)
    json_path = output_dir / f"{stem}.json"
    srt_path = output_dir / f"{stem}.srt"
    try:
        if not json_path.is_file() or not srt_path.is_file():
            return False
        result = json.loads(json_path.read_text(encoding="utf-8"))
        cues = cut_by_speaker(result)
        if not cues:
            say("[說話者] JSON 沒有逐字說話者資訊，沿用 WhisperX 原始分段")
            return False
        before = sum(1 for s in result.get("segments", []) if isinstance(s, dict) and str(s.get("text", "")).strip())
        _write_atomic(srt_path, cues_to_srt(cues))
        say(f"[說話者] 依逐字說話者重新切句：{before} 段 → {len(cues)} 句")
        return True
    except Exception as exc:  # noqa: BLE001 — refinement must never break a finished transcription
        say(f"[說話者] 重新切句失敗，沿用原始 SRT（{exc}）")
        return False
    finally:
        cleanup_extra_outputs(output_dir, stem)
