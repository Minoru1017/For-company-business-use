"""Parallel DEMO transcription helpers (chunk plan, split, merge)."""
from __future__ import annotations

import os
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Callable

from srt_utils import merge_srt_parts

LogFn = Callable[[str], None]

CANCEL_EXIT = 130

# 16 GB RAM — cap concurrent WhisperX (medium/int8) to avoid OOM
DEFAULT_MAX_PARALLEL = 3


def chunk_count_for_duration(seconds: float) -> int:
    if seconds <= 0:
        return 1
    if seconds <= 30 * 60:
        return 1
    if seconds <= 60 * 60:
        return 2
    if seconds <= 90 * 60:
        return 3
    if seconds <= 120 * 60:
        return 4
    return 5


def max_parallel_workers(chunk_count: int) -> int:
    try:
        cap = int(os.environ.get("CALL_COACH_MAX_PARALLEL", str(DEFAULT_MAX_PARALLEL)))
    except ValueError:
        cap = DEFAULT_MAX_PARALLEL
    cap = max(1, min(cap, 5))
    return max(1, min(chunk_count, cap))


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
    proc = subprocess.run(
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
        check=False,
    )
    if proc.returncode != 0:
        log(f"[提醒] 無法讀取音檔長度：{proc.stderr.strip()}")
        return 0.0
    try:
        return float(proc.stdout.strip())
    except ValueError:
        return 0.0


def split_wav_chunks(
    wav: Path,
    chunk_count: int,
    work_dir: Path,
    ffmpeg: str,
    log: LogFn,
) -> list[tuple[Path, float]]:
    work_dir.mkdir(parents=True, exist_ok=True)
    duration = probe_duration_seconds(wav, ffmpeg, log)
    if chunk_count <= 1 or duration <= 0:
        return [(wav, 0.0)]

    chunk_dur = duration / chunk_count
    parts: list[tuple[Path, float]] = []
    for i in range(chunk_count):
        start = i * chunk_dur
        out = work_dir / f"chunk_{i:03d}.wav"
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
            str(wav),
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            str(out),
        ]
        log(f"  切分片段 {i + 1}/{chunk_count}（起點 {int(start // 60)} 分）…")
        proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if proc.returncode != 0:
            raise RuntimeError(f"切分音檔失敗：{proc.stderr.strip() or proc.returncode}")
        parts.append((out, start))
    return parts


def threads_per_worker(parallel: int, default_threads: int) -> int:
    if parallel <= 1:
        return default_threads
    return max(2, default_threads // parallel)


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
) -> int:
    chunk_dir = work_root / ".chunks" / audio.stem
    if chunk_dir.exists():
        shutil.rmtree(chunk_dir, ignore_errors=True)

    parallel = max_parallel_workers(chunk_count)
    log(
        f"[2/2] 分段平行轉錄：{chunk_count} 段、最多 {parallel} 段同時跑"
        f"（16GB 記憶體建議上限 {DEFAULT_MAX_PARALLEL}）…"
    )
    try:
        parts = split_wav_chunks(audio, chunk_count, chunk_dir, ffmpeg, log)
    except RuntimeError as e:
        log(f"[錯誤] {e}")
        return 1

    per_threads = threads_per_worker(parallel, default_threads)
    chunk_out = chunk_dir / "out"
    chunk_out.mkdir(parents=True, exist_ok=True)

    def transcribe_one(item: tuple[int, Path, float]) -> tuple[int, float, Path]:
        idx, chunk_wav, offset = item
        out_sub = chunk_out / f"part_{idx:03d}"
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
                str(per_threads),
                "--batch_size",
                str(batch),
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
        if code != 0:
            raise RuntimeError(f"段 {idx + 1} 轉錄失敗（exit {code})")
        srts = sorted(out_sub.glob("*.srt"))
        if not srts:
            raise RuntimeError(f"段 {idx + 1} 未產出 SRT")
        return idx, offset, srts[0]

    indexed = list(enumerate(parts))
    results: list[tuple[int, float, Path]] = []
    try:
        with ThreadPoolExecutor(max_workers=parallel) as pool:
            futures = {pool.submit(transcribe_one, (i, p, o)): i for i, (p, o) in indexed}
            for fut in as_completed(futures):
                if cancel_check():
                    for f in futures:
                        f.cancel()
                    return CANCEL_EXIT
                results.append(fut.result())
    except RuntimeError as e:
        log(f"[錯誤] {e}")
        return 1

    results.sort(key=lambda x: x[0])
    merge_inputs = [(r[2].read_text(encoding="utf-8"), r[1]) for r in results]
    final_srt.parent.mkdir(parents=True, exist_ok=True)
    final_srt.write_text(merge_srt_parts(merge_inputs), encoding="utf-8")
    log(f"已合併 {len(results)} 段 → {final_srt.name}")
    log("[提醒] 各段獨立辨識發言者；若接縫處業務／客戶標籤對調，請在 Call Coach 按「全部互換」")
    return 0
