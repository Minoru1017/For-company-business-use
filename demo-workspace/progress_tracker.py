"""Structured progress for long-running jobs (transcription).

The tracker rides on the existing ``log: LogFn`` callback: every state change is
emitted as one line prefixed with ``PROGRESS_PREFIX`` followed by JSON. ``JobState``
intercepts those lines (they never reach the human-readable log) and exposes the
latest one via ``/api/job`` as ``progress``; the frontend turns it into a phase
stepper, percent bar and ETA so the wait is predictable instead of a black box.

Percent is derived at read time (``enrich``) from three sources, in priority order:

1. explicit percent reported by the tool (ffmpeg ``out_time=``, WhisperX ``Progress: xx%``)
2. sub-step markers inside a tool run (WhisperX ``>>Performing transcription/alignment/diarization``)
3. wall-clock elapsed vs. the estimate for the current phase (never exceeds 90 % of the phase)

so the bar always moves, but never claims completion before the job really ends.
"""
from __future__ import annotations

import json
import re
import threading
import time
from typing import Callable

LogFn = Callable[[str], None]

PROGRESS_PREFIX = "@@progress "

# WhisperX sub-steps as (lo, hi) percent ranges inside one transcription run.
WHISPERX_RANGES: dict[str, tuple[int, int]] = {
    "load": (0, 8),
    "transcribe": (8, 50),
    "align": (50, 60),
    "diarize": (60, 98),
    "write": (98, 100),
}
WHISPERX_STEP_LABELS = {
    "load": "載入模型",
    "transcribe": "語音辨識",
    "align": "字詞對齊",
    "diarize": "發言者分軌",
    "write": "寫入 SRT",
}

_WX_MARKER_RE = re.compile(r">>\s*Performing\s+(transcription|alignment|diarization)", re.IGNORECASE)
_WX_PROGRESS_RE = re.compile(r"Progress:\s*([0-9]+(?:\.[0-9]+)?)%")
_WX_WRITE_RE = re.compile(r"\.srt\b|Saving|writing", re.IGNORECASE)
_FFMPEG_KV_RE = re.compile(
    r"^(frame|fps|stream_\d+_\d+_q|bitrate|total_size|out_time_us|out_time_ms|out_time|dup_frames|drop_frames|speed|progress)="
)
_FFMPEG_OUT_TIME_RE = re.compile(r"^out_time=(\d+):(\d+):(\d+(?:\.\d+)?)")

MODE_PHASES: dict[str, list[tuple[str, str, int]]] = {
    # key, label, weight (percent of whole job)
    "azure": [
        ("extract", "抽出音軌", 15),
        ("azure", "上傳並由 Azure 辨識", 80),
        ("save", "寫入逐字稿", 5),
    ],
    "local": [
        ("extract", "抽出音軌", 10),
        ("transcribe", "本機辨識與分軌", 88),
        ("save", "寫入逐字稿", 2),
    ],
    "parallel": [
        ("split", "切分音檔", 6),
        ("transcribe", "分段平行辨識", 92),
        ("save", "合併並寫入逐字稿", 2),
    ],
}

EMIT_MIN_INTERVAL_S = 0.8


def estimate_azure_minutes(duration_s: float) -> tuple[int, int]:
    """Upload + Fast Transcription wall-clock; roughly 4–8 % of audio length plus fixed overhead."""
    minutes = max(0.0, duration_s) / 60
    low = max(1, int(round(minutes * 0.04 + 1)))
    high = max(low + 2, int(round(minutes * 0.08 + 2)))
    return low, high


def parse_line(line: str) -> dict | None:
    if not line.startswith(PROGRESS_PREFIX):
        return None
    try:
        data = json.loads(line[len(PROGRESS_PREFIX):])
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


class ProgressTracker:
    def __init__(
        self,
        log: LogFn,
        *,
        mode: str,
        plan: str | None = None,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._log = log
        self._clock = clock
        self._lock = threading.Lock()
        self._last_emit = 0.0
        self.mode = mode
        self.started_at = clock()
        self.duration_s = 0.0
        self.phases: list[dict] = []
        self.phase_index = -1
        self.phase_started_at: float | None = None
        self.phase_percent: float | None = None
        self.detail = ""
        self.eta_low_s: float | None = None
        self.eta_high_s: float | None = None
        self.parts: dict[int, dict] = {}
        self.part_total = 0
        self.done = False
        self.ok: bool | None = None
        if plan:
            self.use_plan(plan)

    # ----- planning -------------------------------------------------------------------------

    def use_plan(self, plan: str) -> None:
        with self._lock:
            self.phases = [{"key": k, "label": lbl, "weight": w} for k, lbl, w in MODE_PHASES[plan]]
            self.phase_index = -1
        self._emit(force=True)

    def skip_phase(self, key: str) -> None:
        """Drop a planned phase (e.g. extraction when ffmpeg is missing) and re-balance weights."""
        with self._lock:
            keep = [p for p in self.phases if p["key"] != key]
            if len(keep) == len(self.phases):
                return
            total = sum(p["weight"] for p in keep) or 1
            for p in keep:
                p["weight"] = round(p["weight"] * 100 / total)
            self.phases = keep
        self._emit(force=True)

    def set_duration(self, seconds: float) -> None:
        with self._lock:
            self.duration_s = max(0.0, float(seconds or 0))
        self._emit(force=True)

    def set_eta_minutes(self, low: float, high: float) -> None:
        with self._lock:
            self.eta_low_s = max(0.0, float(low)) * 60
            self.eta_high_s = max(self.eta_low_s, float(high) * 60)
        self._emit(force=True)

    # ----- phases ---------------------------------------------------------------------------

    def phase(self, key: str, detail: str = "") -> None:
        with self._lock:
            keys = [p["key"] for p in self.phases]
            if key not in keys:
                self.phases.append({"key": key, "label": key, "weight": 0})
                keys.append(key)
            self.phase_index = keys.index(key)
            self.phase_started_at = self._clock()
            self.phase_percent = None
            self.detail = detail
            self.parts = {}
            self.part_total = 0
        self._emit(force=True)

    def set_detail(self, text: str) -> None:
        with self._lock:
            self.detail = text
        self._emit(force=True)

    def set_percent(self, percent: float, detail: str | None = None) -> None:
        with self._lock:
            self.phase_percent = max(0.0, min(100.0, float(percent)))
            if detail is not None:
                self.detail = detail
        self._emit()

    def finish(self, ok: bool) -> None:
        with self._lock:
            self.done = True
            self.ok = ok
            if ok:
                self.phase_index = len(self.phases) - 1
                self.phase_percent = 100.0
                for part in self.parts.values():
                    part["done"] = True
        self._emit(force=True)

    # ----- parts (one WhisperX run per part; single-file runs use part 0) ----------------------

    def set_part_total(self, n: int) -> None:
        with self._lock:
            self.part_total = max(1, int(n))
        self._emit(force=True)

    def _part(self, idx: int) -> dict:
        part = self.parts.get(idx)
        if part is None:
            lo, hi = WHISPERX_RANGES["load"]
            part = {
                "idx": idx,
                "step": "load",
                "lo": lo,
                "hi": hi,
                "percent": None,
                "started_at": self._clock(),
                "done": False,
            }
            self.parts[idx] = part
            self.part_total = max(self.part_total, idx + 1)
        return part

    def part_started(self, idx: int) -> None:
        with self._lock:
            self._part(idx)
        self._emit(force=True)

    def part_done(self, idx: int) -> None:
        with self._lock:
            part = self._part(idx)
            part["done"] = True
            part["percent"] = 100.0
        self._emit(force=True)

    def feed_whisperx(self, idx: int, line: str) -> bool:
        """Parse one line of WhisperX output for part ``idx``. Returns True if it changed state."""
        changed = False
        with self._lock:
            part = self._part(idx)
            m = _WX_MARKER_RE.search(line)
            if m:
                step = {"transcription": "transcribe", "alignment": "align", "diarization": "diarize"}[m.group(1).lower()]
                self._set_part_step(part, step)
                changed = True
            else:
                m = _WX_PROGRESS_RE.search(line)
                if m:
                    part["percent"] = max(0.0, min(100.0, float(m.group(1))))
                    changed = True
                elif part["step"] == "diarize" and _WX_WRITE_RE.search(line):
                    self._set_part_step(part, "write")
                    changed = True
            if changed:
                self.detail = self._parts_detail()
        if changed:
            self._emit(force=_WX_MARKER_RE.search(line) is not None)
        return changed

    def _set_part_step(self, part: dict, step: str) -> None:
        lo, hi = WHISPERX_RANGES[step]
        part.update(step=step, lo=lo, hi=hi, percent=None, started_at=self._clock())

    def _parts_detail(self) -> str:
        active = [p for p in self.parts.values() if not p["done"]]
        if not active:
            return ""
        if self.part_total <= 1:
            return WHISPERX_STEP_LABELS.get(active[0]["step"], active[0]["step"])
        done = sum(1 for p in self.parts.values() if p["done"])
        steps = "、".join(f"段{p['idx'] + 1} {WHISPERX_STEP_LABELS.get(p['step'], p['step'])}" for p in sorted(active, key=lambda p: p["idx"]))
        return f"{done}/{self.part_total} 段完成｜{steps}"

    # ----- ffmpeg ---------------------------------------------------------------------------

    def feed_ffmpeg(self, line: str) -> bool:
        """Parse ``-progress pipe:1`` key=value lines. Returns True if the line is progress noise."""
        text = line.strip()
        if not _FFMPEG_KV_RE.match(text):
            return False
        m = _FFMPEG_OUT_TIME_RE.match(text)
        if m and self.duration_s > 0:
            secs = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
            with self._lock:
                self.phase_percent = max(0.0, min(99.0, secs / self.duration_s * 100))
            self._emit()
        return True

    # ----- log wrappers ----------------------------------------------------------------------

    def wrap_ffmpeg_log(self, log: LogFn) -> LogFn:
        def inner(msg: str) -> None:
            if self.feed_ffmpeg(msg):
                return
            log(msg)

        return inner

    def wrap_whisperx_log(self, log: LogFn, idx: int = 0) -> LogFn:
        self.part_started(idx)

        def inner(msg: str) -> None:
            self.feed_whisperx(idx, msg)
            log(msg)

        return inner

    # ----- serialisation ---------------------------------------------------------------------

    def to_dict(self) -> dict:
        with self._lock:
            return {
                "mode": self.mode,
                "started_at": self.started_at,
                "duration_s": self.duration_s,
                "phases": [dict(p) for p in self.phases],
                "phase_index": self.phase_index,
                "phase_started_at": self.phase_started_at,
                "phase_percent": self.phase_percent,
                "detail": self.detail,
                "eta_low_s": self.eta_low_s,
                "eta_high_s": self.eta_high_s,
                "parts": [dict(p) for _, p in sorted(self.parts.items())],
                "part_total": self.part_total,
                "done": self.done,
                "ok": self.ok,
            }

    def _emit(self, force: bool = False) -> None:
        now = self._clock()
        if not force and now - self._last_emit < EMIT_MIN_INTERVAL_S:
            return
        self._last_emit = now
        self._log(PROGRESS_PREFIX + json.dumps(self.to_dict(), ensure_ascii=False))


# ----- read-side derivation -------------------------------------------------------------------


def _range_fraction(lo: float, hi: float, percent: float | None, started_at: float | None, expected_s: float | None, now: float) -> float:
    span = max(0.0, hi - lo)
    if percent is not None:
        return lo + span * min(1.0, max(0.0, percent / 100))
    if started_at is None or not expected_s or expected_s <= 0:
        return lo
    frac = min(0.9, max(0.0, (now - started_at) / expected_s))
    return lo + span * frac


def _phase_percent(p: dict, now: float, expected_phase_s: float | None) -> float:
    if p.get("done") and p.get("ok"):
        return 100.0
    parts = p.get("parts") or []
    if parts:
        total = max(int(p.get("part_total") or 0), len(parts))
        pct_sum = 0.0
        for part in parts:
            if part.get("done"):
                pct_sum += 100.0
                continue
            span_frac = (part["hi"] - part["lo"]) / 100
            expected_range_s = expected_phase_s * span_frac if expected_phase_s else None
            pct_sum += _range_fraction(part["lo"], part["hi"], part.get("percent"), part.get("started_at"), expected_range_s, now)
        return pct_sum / max(1, total)
    if p.get("phase_percent") is not None:
        return float(p["phase_percent"])
    return _range_fraction(0, 100, None, p.get("phase_started_at"), expected_phase_s, now)


def enrich(progress: dict | None, now: float | None = None) -> dict | None:
    """Add elapsed / percent / remaining ETA to a raw tracker dict (safe on partial dicts)."""
    if not progress:
        return None
    now = time.time() if now is None else now
    out = dict(progress)
    started = float(progress.get("started_at") or now)
    elapsed = max(0.0, now - started)
    phases = progress.get("phases") or []
    idx = int(progress.get("phase_index", -1))
    low = progress.get("eta_low_s")
    high = progress.get("eta_high_s")
    center = (float(low) + float(high)) / 2 if low is not None and high is not None else None

    done_w = sum(float(ph.get("weight", 0)) for ph in phases[:idx]) if idx > 0 else 0.0
    cur_w = float(phases[idx].get("weight", 0)) if 0 <= idx < len(phases) else 0.0
    expected_phase_s = center * cur_w / 100 if center else None
    phase_pct = _phase_percent(progress, now, expected_phase_s) if idx >= 0 else 0.0
    percent = done_w + cur_w * phase_pct / 100
    if progress.get("done"):
        percent = 100.0 if progress.get("ok") else percent
    else:
        percent = min(97.0, percent)

    states = []
    for i, ph in enumerate(phases):
        if progress.get("done") and progress.get("ok"):
            state = "done"
        elif i < idx:
            state = "done"
        elif i == idx:
            state = "active"
        else:
            state = "pending"
        states.append({"key": ph.get("key"), "label": ph.get("label"), "state": state})

    remaining_low = remaining_high = None
    overdue = False
    if low is not None and high is not None:
        remaining_low = max(0.0, float(low) - elapsed)
        remaining_high = max(0.0, float(high) - elapsed)
        overdue = elapsed > float(high)

    out.update(
        {
            "elapsed_s": int(elapsed),
            "percent": int(round(percent)),
            "phase_percent_effective": int(round(phase_pct)),
            "phase_states": states,
            "phase_label": phases[idx]["label"] if 0 <= idx < len(phases) else "",
            "eta_remaining_low_s": int(remaining_low) if remaining_low is not None else None,
            "eta_remaining_high_s": int(remaining_high) if remaining_high is not None else None,
            "overdue": overdue,
        }
    )
    return out
