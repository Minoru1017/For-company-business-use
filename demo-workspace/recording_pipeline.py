"""Watch company shared-drive WAV recordings → transcribe → prompt Call Coach analysis."""
from __future__ import annotations

import json
import time
from pathlib import Path

import demo_core

STATE_FILE = demo_core.ROOT / "output" / ".recording_pipeline_state.json"
PENDING_FILE = demo_core.ROOT / "output" / ".recording_pending.json"


def recordings_dir() -> Path | None:
    raw = demo_core.load_env().get("CALL_COACH_RECORDINGS_DIR", "").strip()
    if not raw:
        return None
    return Path(raw)


def min_duration_seconds() -> int:
    raw = demo_core.load_env().get("CALL_COACH_RECORDINGS_MIN_SECONDS", "300").strip()
    try:
        return max(60, int(raw))
    except ValueError:
        return 300


def poll_seconds() -> int:
    raw = demo_core.load_env().get("CALL_COACH_RECORDINGS_POLL_SECONDS", "90").strip()
    try:
        return max(30, int(raw))
    except ValueError:
        return 90


def pipeline_mode() -> str:
    from transcribe_modes import normalize_mode

    raw = demo_core.load_env().get("CALL_COACH_RECORDINGS_MODE", "").strip()
    if raw:
        return normalize_mode(raw)
    return demo_core.default_transcribe_mode()


def cloud_consent_for_pipeline() -> bool:
    flag = demo_core.load_env().get("CALL_COACH_RECORDINGS_CLOUD_CONSENT", "").strip().lower()
    return flag in ("1", "true", "yes", "on")


def watch_enabled() -> bool:
    flag = demo_core.load_env().get("CALL_COACH_RECORDINGS_WATCH", "").strip().lower()
    return flag in ("1", "true", "yes", "on") and recordings_dir() is not None


def _load_state() -> dict:
    if not STATE_FILE.is_file():
        return {"processed": {}}
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"processed": {}}


def _save_state(state: dict) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def file_fingerprint(path: Path) -> str:
    st = path.stat()
    return f"{st.st_size}:{int(st.st_mtime)}"


def is_likely_complete(path: Path, min_age_s: float = 15.0) -> bool:
    """Heuristic: file size stable and not modified recently (MicroSIP finished writing)."""
    try:
        st = path.stat()
    except OSError:
        return False
    if st.st_size <= 0:
        return False
    return (time.time() - st.st_mtime) >= min_age_s


def already_processed(path: Path, state: dict) -> bool:
    key = str(path.resolve()).lower()
    fp = file_fingerprint(path)
    return state.get("processed", {}).get(key) == fp


def mark_processed(path: Path, state: dict) -> None:
    key = str(path.resolve()).lower()
    state.setdefault("processed", {})[key] = file_fingerprint(path)
    if len(state["processed"]) > 500:
        for old in list(state["processed"].keys())[:100]:
            state["processed"].pop(old, None)
    _save_state(state)


def iter_wav_files(root: Path) -> list[Path]:
    if not root.is_dir():
        return []
    out: list[Path] = []
    try:
        for p in root.rglob("*.wav"):
            if p.is_file():
                out.append(p)
    except OSError:
        return []
    return sorted(out, key=lambda p: p.stat().st_mtime)


def save_pending(*, wav: Path, srt_name: str, duration_s: float, phone_hint: str = "") -> None:
    data = {
        "wav": str(wav),
        "wav_name": wav.name,
        "srt": srt_name,
        "duration_s": duration_s,
        "phone_hint": phone_hint,
        "created_at": time.time(),
    }
    PENDING_FILE.parent.mkdir(parents=True, exist_ok=True)
    PENDING_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def load_pending() -> dict | None:
    if not PENDING_FILE.is_file():
        return None
    try:
        data = json.loads(PENDING_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not data.get("srt"):
        return None
    return data


def clear_pending() -> None:
    PENDING_FILE.unlink(missing_ok=True)


def phone_hint_from_name(name: str) -> str:
    import re

    m = re.search(r"(\d{8,11})", name)
    return m.group(1) if m else ""


def pipeline_status() -> dict:
    root = recordings_dir()
    pending = load_pending()
    return {
        "watch_enabled": watch_enabled(),
        "recordings_dir": str(root) if root else None,
        "dir_ok": bool(root and root.is_dir()),
        "min_seconds": min_duration_seconds(),
        "poll_seconds": poll_seconds(),
        "mode": pipeline_mode(),
        "cloud_consent": cloud_consent_for_pipeline(),
        "pending": pending,
    }


def pick_next_wav(log=demo_core.default_log) -> Path | None:
    root = recordings_dir()
    if not root or not root.is_dir():
        return None
    state = _load_state()
    ffmpeg = demo_core.ffmpeg_exe()
    min_s = min_duration_seconds()
    for path in iter_wav_files(root):
        if already_processed(path, state):
            continue
        if not is_likely_complete(path):
            continue
        dur = 0.0
        if ffmpeg:
            from transcribe_parallel import probe_duration_seconds

            dur = probe_duration_seconds(path, ffmpeg, lambda _m: None)
        if dur > 0 and dur < min_s:
            log(
                f"[通話錄音] 略過 {path.name}（{int(dur // 60)} 分 {int(dur % 60)} 秒 < {min_s // 60} 分鐘）"
            )
            mark_processed(path, state)
            continue
        if dur <= 0:
            log(f"[通話錄音] 無法讀取長度，略過：{path.name}")
            mark_processed(path, state)
            continue
        return path
    return None


def scan_and_log_summary(log=demo_core.default_log) -> int:
    root = recordings_dir()
    if not root:
        log("[通話錄音] 未設定 CALL_COACH_RECORDINGS_DIR")
        return 0
    files = iter_wav_files(root)
    log(f"[通話錄音] 監看 {root}（{len(files)} 個 WAV，門檻 ≥{min_duration_seconds() // 60} 分鐘）")
    return len(files)


def process_recording_pipeline(log=demo_core.default_log, hooks: demo_core.JobHooks | None = None) -> int:
    """One watcher tick: transcribe the next eligible WAV and queue UI prompt."""
    if load_pending():
        log("[通話錄音] 已有待分析逐字稿，略過新檔直至你在 Call Coach 按「稍後」或完成分析")
        return 0

    wav = pick_next_wav(log)
    if not wav:
        return 0

    mode = pipeline_mode()
    from transcribe_modes import OFFSITE_MODES

    consent = cloud_consent_for_pipeline()
    if mode in OFFSITE_MODES and not consent:
        log(
            "[通話錄音] 模式需上傳音訊，請在 .env 設定 CALL_COACH_RECORDINGS_CLOUD_CONSENT=1"
            "（或改用 local_gpu / standard 本機模式）"
        )
        return 0

    ffmpeg = demo_core.ffmpeg_exe()
    duration = 0.0
    if ffmpeg:
        from transcribe_parallel import probe_duration_seconds

        duration = probe_duration_seconds(wav, ffmpeg, log)

    log(f"[通話錄音] 開始轉錄 {wav.name}（{mode}）")
    code = demo_core.run_transcribe_wav(
        wav,
        log,
        hooks=hooks,
        mode=mode,
        cloud_consent=consent,
    )
    state = _load_state()
    if code != 0:
        log("[通話錄音] 轉錄失敗，稍後會再重試同一檔案")
        return code

    srt_name = f"{wav.stem}.srt"
    srt_path = demo_core.ROOT / "output" / srt_name
    if not srt_path.is_file():
        log(f"[通話錄音] 找不到輸出 {srt_name}，仍標記已處理以免重複")
    else:
        save_pending(
            wav=wav,
            srt_name=srt_name,
            duration_s=duration,
            phone_hint=phone_hint_from_name(wav.name),
        )
        log("[通話錄音] 逐字稿已就緒 — 請在 Call Coach 確認是否分析")
    mark_processed(wav, state)
    return 0
