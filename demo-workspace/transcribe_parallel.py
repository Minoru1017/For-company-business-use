"""Parallel DEMO transcription helpers (chunk plan, split, merge)."""
from __future__ import annotations

import math
import os
import shutil
import sys
import threading
from concurrent.futures import CancelledError, ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Callable

from proc_utils import quiet_run
from srt_utils import merge_srt_parts

LogFn = Callable[[str], None]

CANCEL_EXIT = 130


class _Cancelled(Exception):
    """Raised inside worker threads when the user cancelled the job."""

DEFAULT_MAX_PARALLEL = 3
HARD_MAX_PARALLEL = 5
MAX_CHUNKS = 8
# Longest single chunk we hand to one WhisperX process (alignment + diarization
# memory grows with chunk length).
MAX_CHUNK_MINUTES = 25
# Files at or below this length are transcribed in one go (no split).
MIN_SPLIT_MINUTES = 20

# Rough peak RSS per WhisperX process on CPU: faster-whisper int8 model +
# wav2vec2 zh alignment model (fp32) + pyannote diarization + torch runtime.
WORKER_GB_BY_MODEL = {
    "tiny": 2.5,
    "base": 2.5,
    "small": 3.0,
    "medium": 4.5,
    "large": 7.0,
    "large-v2": 7.0,
    "large-v3": 7.0,
    "turbo": 4.0,
}
DEFAULT_WORKER_GB = 4.5
# Leave room for Windows, the browser, and the assistant itself.
RESERVED_GB = 3.0


def total_memory_gb() -> float:
    """Physical RAM in GB (0.0 when unknown)."""
    override = os.environ.get("CALL_COACH_RAM_GB")
    if override:
        try:
            return max(0.0, float(override))
        except ValueError:
            pass
    try:
        if sys.platform == "win32":
            import ctypes

            class MemoryStatusEx(ctypes.Structure):
                _fields_ = [
                    ("dwLength", ctypes.c_ulong),
                    ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong),
                    ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong),
                    ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong),
                    ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
                ]

            stat = MemoryStatusEx()
            stat.dwLength = ctypes.sizeof(MemoryStatusEx)
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat)):  # type: ignore[attr-defined]
                return stat.ullTotalPhys / (1024**3)
            return 0.0
        if hasattr(os, "sysconf"):
            pages = os.sysconf("SC_PHYS_PAGES")
            page_size = os.sysconf("SC_PAGE_SIZE")
            return pages * page_size / (1024**3)
    except (OSError, ValueError, AttributeError):
        return 0.0
    return 0.0


def worker_memory_gb(model: str) -> float:
    return WORKER_GB_BY_MODEL.get(model.split(".")[0], DEFAULT_WORKER_GB)


def memory_safe_parallel(total_gb: float, model: str) -> int:
    """How many WhisperX processes fit in RAM without swapping/OOM."""
    if total_gb <= 0:
        return 2
    usable = total_gb - RESERVED_GB
    return max(1, int(usable // worker_memory_gb(model)))


def max_parallel_workers(chunk_count: int, model: str = "medium", total_gb: float | None = None) -> int:
    """Parallel WhisperX processes: min(user cap, RAM-based cap, chunk count)."""
    try:
        cap = int(os.environ.get("CALL_COACH_MAX_PARALLEL", str(DEFAULT_MAX_PARALLEL)))
    except ValueError:
        cap = DEFAULT_MAX_PARALLEL
    cap = max(1, min(cap, HARD_MAX_PARALLEL))
    if "CALL_COACH_MAX_PARALLEL" not in os.environ:
        ram = total_memory_gb() if total_gb is None else total_gb
        cap = min(cap, memory_safe_parallel(ram, model))
    return max(1, min(chunk_count, cap))


def chunk_count_for_duration(seconds: float, parallel: int | None = None) -> int:
    """Chunk plan balanced against the number of parallel workers.

    Chunks are grouped into "waves" of `parallel` processes; every wave gets
    equal-length chunks no longer than MAX_CHUNK_MINUTES, so no chunk runs alone
    at the end while other cores idle.
    """
    if seconds <= MIN_SPLIT_MINUTES * 60:
        return 1
    if parallel is None:
        parallel = max_parallel_workers(MAX_CHUNKS)
    if parallel <= 1:
        # Splitting only pays off when chunks run concurrently.
        return 1
    waves = max(1, math.ceil(seconds / (parallel * MAX_CHUNK_MINUTES * 60)))
    return min(waves * parallel, MAX_CHUNKS)


def estimate_transcribe_minutes(duration_sec: float, chunk_count: int, parallel: int) -> tuple[int, int]:
    """Rough wall-clock ETA for CPU WhisperX medium + diarization."""
    if duration_sec <= 0:
        return 30, 90
    chunk_min = duration_sec / max(chunk_count, 1) / 60
    waves = max(1, math.ceil(chunk_count / max(parallel, 1)))
    # Typical laptop CPU: ~1.5–2.5× realtime per chunk (incl. model load / diarize)
    center = chunk_min * 2.0 * waves + 5
    low = max(10, int(center * 0.8))
    high = max(low + 10, int(center * 1.35))
    return low, high


def ffprobe_path(ffmpeg: str | None) -> str | None:
    if ffmpeg:
        candidate = Path(ffmpeg).with_name("ffprobe.exe" if os.name == "nt" else "ffprobe")
        if candidate.is_file():
            return str(candidate)
    return shutil.which("ffprobe")


def probe_duration_seconds(audio: Path, ffmpeg: str | None, log: LogFn) -> float:
    ffprobe = ffprobe_path(ffmpeg)
    if not ffprobe:
        log("[提醒] 找不到 ffprobe，略過分段平行轉錄")
        return 0.0
    proc = quiet_run(
        [
            ffprobe,
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(audio),
        ],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        log(f"[提醒] 無法讀取音檔長度：{proc.stderr.strip()}")
        return 0.0
    try:
        return float(proc.stdout.strip())
    except ValueError:
        return 0.0


def threads_per_worker(parallel: int, default_threads: int) -> int:
    if parallel <= 1:
        return default_threads
    if parallel == 2:
        return max(4, default_threads // 2)
    return max(2, default_threads // parallel)


def _split_one_chunk(
    ffmpeg: str,
    source: Path,
    out: Path,
    start: float,
    chunk_dur: float,
) -> tuple[Path, float]:
    cmd = [
        ffmpeg,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        f"{start:.3f}",
        "-t",
        f"{chunk_dur:.3f}",
        "-i",
        str(source),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        str(out),
    ]
    proc = quiet_run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"切分音檔失敗：{proc.stderr.strip() or proc.returncode}")
    if not out.is_file() or out.stat().st_size < 1024:
        raise RuntimeError(f"切分音檔失敗：{out.name} 為空")
    return out, start


def split_audio_chunks(
    source: Path,
    chunk_count: int,
    work_dir: Path,
    ffmpeg: str,
    log: LogFn,
    parallel: int | None = None,
) -> list[tuple[Path, float]]:
    work_dir.mkdir(parents=True, exist_ok=True)
    duration = probe_duration_seconds(source, ffmpeg, log)
    if chunk_count <= 1 or duration <= 0:
        return [(source, 0.0)]

    chunk_dur = duration / chunk_count
    jobs: list[tuple[int, Path, float]] = []
    for i in range(chunk_count):
        start = i * chunk_dur
        out = work_dir / f"chunk_{i:03d}.wav"
        jobs.append((i, out, start))

    parts: list[tuple[Path, float] | None] = [None] * chunk_count
    workers = min(chunk_count, parallel or DEFAULT_MAX_PARALLEL)
    log(f"  從 {source.name} 切分 {chunk_count} 段（每段約 {int(chunk_dur // 60)} 分）…")

    def run_job(item: tuple[int, Path, float]) -> tuple[int, Path, float]:
        idx, out, start = item
        log(f"  切分片段 {idx + 1}/{chunk_count}（起點 {int(start // 60)} 分）…")
        path, offset = _split_one_chunk(ffmpeg, source, out, start, chunk_dur)
        return idx, path, offset

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(run_job, job) for job in jobs]
        for fut in as_completed(futures):
            idx, path, offset = fut.result()
            parts[idx] = (path, offset)

    return [p for p in parts if p is not None]


def _find_srt(out_sub: Path) -> Path | None:
    srts = sorted(p for p in out_sub.rglob("*.srt") if p.stat().st_size > 0)
    return srts[0] if srts else None


def _write_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def run_parallel_transcribe(
    *,
    audio: Path,
    chunk_count: int,
    ffmpeg: str,
    work_root: Path,
    output_dir: Path,
    final_srt: Path,
    whisperx_cmd: list[str],
    model: str,
    default_threads: int,
    batch: int,
    env_vars: dict[str, str],
    run_command: Callable[..., int],
    log: LogFn,
    hooks,
    cancel_check: Callable[[], bool],
    parallel: int | None = None,
) -> int:
    chunk_dir = work_root / ".chunks" / audio.stem
    if chunk_dir.exists():
        shutil.rmtree(chunk_dir, ignore_errors=True)

    if parallel is None:
        parallel = max_parallel_workers(chunk_count, model)
    parallel = max(1, min(parallel, chunk_count))
    eta_low, eta_high = estimate_transcribe_minutes(
        probe_duration_seconds(audio, ffmpeg, lambda _m: None),
        chunk_count,
        parallel,
    )
    ram = total_memory_gb()
    ram_note = f"、實體記憶體約 {ram:.0f} GB" if ram > 0 else ""
    log(
        f"[2/2] 分段平行轉錄：{chunk_count} 段、最多 {parallel} 段同時跑（{model}{ram_note}）"
        f" — 預估還需約 {eta_low}～{eta_high} 分鐘（CPU 本機轉錄，請接電源）…"
    )
    try:
        parts = split_audio_chunks(audio, chunk_count, chunk_dir, ffmpeg, log, parallel=parallel)
    except RuntimeError as e:
        log(f"[錯誤] {e}")
        return 1

    if cancel_check():
        return CANCEL_EXIT

    chunk_out = chunk_dir / "out"
    chunk_out.mkdir(parents=True, exist_ok=True)
    total = len(parts)
    done_lock = threading.Lock()
    done_count = 0

    def transcribe_one(idx: int, chunk_wav: Path, threads: int, batch_size: int) -> Path:
        out_sub = chunk_out / f"part_{idx:03d}"
        if out_sub.exists():
            shutil.rmtree(out_sub, ignore_errors=True)
        out_sub.mkdir(parents=True, exist_ok=True)
        code = run_command(
            whisperx_cmd
            + [
                str(chunk_wav),
                "--model",
                model,
                "--language",
                "zh",
                "--device",
                "cpu",
                "--compute_type",
                "int8",
                "--threads",
                str(threads),
                "--batch_size",
                str(batch_size),
                "--diarize",
                "--min_speakers",
                "2",
                "--max_speakers",
                "2",
                "--output_format",
                "srt",
                "--output_dir",
                str(out_sub),
            ],
            log=lambda m: log(f"  [段 {idx + 1}] {m}"),
            env=env_vars,
            hooks=hooks,
        )
        if code == CANCEL_EXIT or cancel_check():
            raise _Cancelled()
        if code != 0:
            raise RuntimeError(f"段 {idx + 1} 轉錄失敗（exit {code}）")
        srt = _find_srt(out_sub)
        if srt is None:
            raise RuntimeError(f"段 {idx + 1} 未產出 SRT（WhisperX 結束但沒有寫出檔案）")
        return srt

    results: dict[int, tuple[float, Path]] = {}
    failed: list[tuple[int, Path, float, str]] = []
    per_threads = threads_per_worker(parallel, default_threads)

    def run_wave(idx: int, chunk_wav: Path, offset: float) -> tuple[int, float, Path]:
        nonlocal done_count
        srt = transcribe_one(idx, chunk_wav, per_threads, batch)
        with done_lock:
            done_count += 1
            n = done_count
        log(f"  [段 {idx + 1}] 完成（{n}/{total} 段已完成）")
        return idx, offset, srt

    try:
        with ThreadPoolExecutor(max_workers=parallel) as pool:
            futures = {
                pool.submit(run_wave, i, p, o): (i, p, o) for i, (p, o) in enumerate(parts)
            }
            for fut in as_completed(futures):
                i, p, o = futures[fut]
                if fut.cancelled():
                    continue
                try:
                    idx, offset, srt = fut.result()
                    results[idx] = (offset, srt)
                except (_Cancelled, CancelledError):
                    pass
                except RuntimeError as e:
                    log(f"[提醒] {e}；其餘分段完成後會單獨重試這一段")
                    failed.append((i, p, o, str(e)))
                if cancel_check():
                    # Stop queued chunks and kill the ones already running so the
                    # pool exits promptly instead of waiting for WhisperX to finish.
                    for f in futures:
                        f.cancel()
                    if hooks is not None and hasattr(hooks, "kill_all"):
                        hooks.kill_all()
                    break
    except _Cancelled:
        return CANCEL_EXIT

    if cancel_check():
        return CANCEL_EXIT

    # Retry failed chunks one at a time with the whole CPU and a smaller batch:
    # most chunk failures on 16 GB laptops are memory pressure from running
    # several WhisperX processes at once.
    for i, p, o, reason in failed:
        if cancel_check():
            return CANCEL_EXIT
        log(f"  [段 {i + 1}] 重試（單獨執行、{default_threads} 執行緒、batch {max(1, batch // 2)}）…")
        try:
            srt = transcribe_one(i, p, default_threads, max(1, batch // 2))
        except _Cancelled:
            return CANCEL_EXIT
        except RuntimeError as e:
            log(f"[錯誤] {e}（第一次：{reason}）")
            log(f"[提醒] 分段輸出保留在 {chunk_out}，可傳給技術支援")
            return 1
        results[i] = (o, srt)
        log(f"  [段 {i + 1}] 重試成功")

    if len(results) != total:
        missing = [str(i + 1) for i in range(total) if i not in results]
        log(f"[錯誤] 缺少分段結果：段 {', '.join(missing)}")
        return 1

    merge_inputs = [
        (results[i][1].read_text(encoding="utf-8"), results[i][0]) for i in range(total)
    ]
    merged = merge_srt_parts(merge_inputs)
    if not merged.strip():
        log("[錯誤] 合併後的 SRT 為空")
        return 1
    _write_atomic(final_srt, merged)
    log(f"已合併 {total} 段 → {final_srt.name}")
    log("[提醒] 各段獨立辨識發言者；若接縫處業務／客戶標籤對調，請在 Call Coach 按「全部互換」")
    shutil.rmtree(chunk_dir, ignore_errors=True)
    try:
        chunk_dir.parent.rmdir()
    except OSError:
        pass
    return 0
