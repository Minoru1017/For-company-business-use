"""Shared DEMO transcription logic for CLI scripts and demo_app."""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from app_paths import is_frozen, resolve_paths

ROOT, BUNDLE = resolve_paths()
STATIC = BUNDLE / "demo_app"
PORTABLE_PY = ROOT / "runtime" / "python" / "python.exe"
BUNDLED_FFMPEG = ROOT / "runtime" / "ffmpeg" / "ffmpeg.exe"
VENV_PY = ROOT / ".venv" / "Scripts" / "python.exe"
WHISPERX = ROOT / ".venv" / "Scripts" / "whisperx.exe"
REQUIRED_PY = (3, 10)
RECOMMENDED_PY_MAX = (3, 12)
MODEL = os.environ.get("CALL_COACH_MODEL", "medium")


def transcribe_threads() -> int:
    try:
        return int(os.environ.get("CALL_COACH_THREADS", str(max(4, min((os.cpu_count() or 8), 12)))))
    except ValueError:
        return max(4, min((os.cpu_count() or 8), 12))


def transcribe_batch() -> int:
    try:
        return max(1, min(int(os.environ.get("CALL_COACH_BATCH", "8")), 16))
    except ValueError:
        return 8
CALL_COACH_URL = "https://minoru1017.github.io/For-company-business-use/"

HF_LINKS = {
    "join": "https://huggingface.co/join",
    "tokens": "https://huggingface.co/settings/tokens",
    "models": [
        "https://huggingface.co/pyannote/speaker-diarization-community-1",
        "https://huggingface.co/pyannote/speaker-diarization-3.1",
        "https://huggingface.co/pyannote/segmentation-3.0",
    ],
}

LogFn = Callable[[str], None]

CANCEL_EXIT = 130


class JobHooks:
    """Optional hooks for cancellable subprocess jobs."""

    def register_proc(self, proc: subprocess.Popen | None) -> None:
        return None

    def is_cancelled(self) -> bool:
        return False


def kill_proc(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    if sys.platform == "win32":
        subprocess.run(
            ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
            capture_output=True,
            check=False,
        )
    else:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


def default_log(msg: str) -> None:
    print(msg, flush=True)


def load_env(path: Path | None = None) -> dict[str, str]:
    path = path or ROOT / ".env"
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def save_hf_token(token: str) -> None:
    token = token.strip()
    if not token.startswith("hf_"):
        raise ValueError("Token 必須以 hf_ 開頭")
    env_file = ROOT / ".env"
    if not env_file.exists():
        shutil.copy(ROOT / ".env.example", env_file)
    lines: list[str] = []
    replaced = False
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("HF_TOKEN="):
                lines.append(f"HF_TOKEN={token}")
                replaced = True
            else:
                lines.append(line)
    if not replaced:
        lines.append(f"HF_TOKEN={token}")
    env_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
    try:
        os.chmod(env_file, 0o600)
    except OSError:
        pass


def has_valid_token() -> bool:
    token = load_env().get("HF_TOKEN", "")
    return bool(token) and token.startswith("hf_") and "在這裡" not in token


def whisperx_cmd() -> list[str]:
    if WHISPERX.exists():
        return [str(WHISPERX)]
    alt = ROOT / ".venv" / "Scripts" / "whisperx.cmd"
    if alt.exists():
        return ["cmd", "/c", str(alt)]
    return [str(VENV_PY), "-m", "whisperx"]


SAFE_MP4_RE = re.compile(r"^[A-Za-z0-9._ -]+\.mp4$", re.IGNORECASE)


def safe_mp4_name(name: str) -> str:
    base = Path(name).name
    if not base or not SAFE_MP4_RE.match(base):
        raise ValueError("檔名僅允許英數、空格、.-_，且須為 .mp4")
    return base


def format_cmd_for_log(cmd: list[str]) -> str:
    out: list[str] = []
    i = 0
    while i < len(cmd):
        if cmd[i] in ("--hf_token", "--hf-token") and i + 1 < len(cmd):
            out.extend([cmd[i], "***"])
            i += 2
        else:
            out.append(cmd[i])
            i += 1
    return "> " + " ".join(out)


def list_mp4_files() -> list[Path]:
    input_dir = ROOT / "input"
    if not input_dir.exists():
        return []
    return sorted(input_dir.glob("*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True)


def find_mp4(arg: str | None = None) -> Path:
    input_root = (ROOT / "input").resolve()
    if arg:
        name = safe_mp4_name(arg)
        p = input_root / name
        if p.is_file():
            return p
        raise FileNotFoundError(f"找不到: {name}")

    preferred = ROOT / "input" / "demo.mp4"
    if preferred.exists():
        return preferred

    mp4s = list_mp4_files()
    if mp4s:
        return mp4s[0]

    raise FileNotFoundError("input 資料夾沒有 MP4。請先選擇或放入錄影檔。")


def cache_env() -> dict[str, str]:
    env = os.environ.copy()
    env["HF_HOME"] = str(ROOT / "models")
    env["HUGGINGFACE_HUB_CACHE"] = str(ROOT / "models" / "hub")
    env["TORCH_HOME"] = str(ROOT / "models" / "torch")
    env["XDG_CACHE_HOME"] = str(ROOT / "models")
    token = load_env().get("HF_TOKEN", "").strip()
    if token:
        env["HF_TOKEN"] = token
    return env


def ffmpeg_exe() -> str | None:
    if BUNDLED_FFMPEG.is_file():
        return str(BUNDLED_FFMPEG)
    return shutil.which("ffmpeg")


def shell_env(extra: dict[str, str] | None = None) -> dict[str, str]:
    env = os.environ.copy()
    if extra:
        env.update(extra)
    ff = ffmpeg_exe()
    if ff:
        ff_dir = str(Path(ff).parent)
        env["PATH"] = ff_dir + os.pathsep + env.get("PATH", "")
    return env


def base_python_exe() -> Path:
    """Interpreter used to create .venv (must be a real python.exe when packaged)."""
    if PORTABLE_PY.is_file():
        return PORTABLE_PY
    return Path(sys.executable)


def ensure_workspace_files(log: LogFn = default_log) -> None:
    for name in ("models", "input", "output"):
        (ROOT / name).mkdir(exist_ok=True)
    env_example = ROOT / ".env.example"
    if not env_example.exists():
        bundled = BUNDLE / ".env.example"
        if bundled.is_file():
            shutil.copy(bundled, env_example)
            log("已複製 .env.example")


def python_version_info() -> tuple[bool, str, str | None]:
    ver = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    ok = sys.version_info >= REQUIRED_PY
    warning: str | None = None
    if sys.version_info[:2] > RECOMMENDED_PY_MAX:
        warning = (
            f"Python {ver} 過新，WhisperX 建議使用 3.10～3.12。"
            " 若安裝或轉錄失敗，請改用 Python 3.12。"
        )
    elif sys.version_info < REQUIRED_PY:
        warning = f"需要 Python {REQUIRED_PY[0]}.{REQUIRED_PY[1]}+（目前 {ver}）"
        ok = False
    return ok, ver, warning


@dataclass
class EnvStatus:
    python_ok: bool
    python_version: str
    python_warning: str | None
    portable_python_ok: bool
    ffmpeg_ok: bool
    winget_ok: bool
    venv_ok: bool
    whisperx_ok: bool
    token_ok: bool
    input_dir_ok: bool
    output_dir_ok: bool
    mp4_files: list[str] = field(default_factory=list)
    srt_files: list[str] = field(default_factory=list)
    ready_to_transcribe: bool = False

    def to_dict(self) -> dict:
        return {
            "python_ok": self.python_ok,
            "python_version": self.python_version,
            "python_warning": self.python_warning,
            "portable_python_ok": self.portable_python_ok,
            "ffmpeg_ok": self.ffmpeg_ok,
            "winget_ok": self.winget_ok,
            "venv_ok": self.venv_ok,
            "whisperx_ok": self.whisperx_ok,
            "token_ok": self.token_ok,
            "input_dir_ok": self.input_dir_ok,
            "output_dir_ok": self.output_dir_ok,
            "mp4_files": self.mp4_files,
            "srt_files": self.srt_files,
            "ready_to_transcribe": self.ready_to_transcribe,
            "root": str(ROOT),
            "input_folder": str(ROOT / "input"),
            "packaged": is_frozen(),
            "installer_setup": (ROOT / ".setup_complete").is_file(),
            "bundled_ffmpeg": BUNDLED_FFMPEG.is_file(),
            "can_uninstall": self.venv_ok,
            "api_capabilities": ["setup", "full-setup", "install-ffmpeg"],
            "call_coach_url": CALL_COACH_URL,
            "hf_links": HF_LINKS,
        }


def get_status() -> EnvStatus:
    python_ok, ver, python_warning = python_version_info()
    ffmpeg_ok = ffmpeg_exe() is not None
    winget_ok = shutil.which("winget") is not None
    venv_ok = VENV_PY.exists()
    whisperx_ok = WHISPERX.exists() or (ROOT / ".venv" / "Scripts" / "whisperx.cmd").exists()
    token_ok = has_valid_token()
    input_dir = ROOT / "input"
    output_dir = ROOT / "output"
    mp4s = [p.name for p in list_mp4_files()]
    srts = []
    if output_dir.exists():
        srts = [p.name for p in sorted(output_dir.glob("*.srt"), key=lambda p: p.stat().st_mtime, reverse=True)]

    ready = python_ok and venv_ok and whisperx_ok and token_ok and bool(mp4s)

    portable_ok = PORTABLE_PY.is_file()
    if portable_ok and python_warning and "過新" in python_warning:
        python_warning = (
            f"目前使用系統 Python {ver}；已偵測到可攜式 Python。"
            " 請用 start_call_coach.cmd 啟動（會優先使用 runtime\\python）。"
        )

    return EnvStatus(
        python_ok=python_ok,
        python_version=ver,
        python_warning=python_warning,
        portable_python_ok=portable_ok,
        ffmpeg_ok=ffmpeg_ok,
        winget_ok=winget_ok,
        venv_ok=venv_ok,
        whisperx_ok=whisperx_ok,
        token_ok=token_ok,
        input_dir_ok=input_dir.exists(),
        output_dir_ok=output_dir.exists(),
        mp4_files=mp4s,
        srt_files=srts,
        ready_to_transcribe=ready,
    )


def run_command(
    cmd: list[str],
    log: LogFn = default_log,
    env: dict[str, str] | None = None,
    hooks: JobHooks | None = None,
) -> int:
    log(format_cmd_for_log(cmd))
    if hooks and hooks.is_cancelled():
        log("[已取消] 轉錄已停止")
        return CANCEL_EXIT

    proc = subprocess.Popen(
        cmd,
        cwd=ROOT,
        env=shell_env(env),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )
    if hooks:
        hooks.register_proc(proc)
    try:
        assert proc.stdout is not None
        for line in proc.stdout:
            if hooks and hooks.is_cancelled():
                log("[已取消] 正在停止程序…")
                kill_proc(proc)
                return CANCEL_EXIT
            log(line.rstrip())
        code = proc.wait()
        if hooks and hooks.is_cancelled():
            return CANCEL_EXIT
        return code
    finally:
        if hooks:
            hooks.register_proc(None)


def create_venv(log: LogFn = default_log) -> int:
    """Create .venv using venv or virtualenv (embed Python lacks venv)."""
    py = base_python_exe()
    venv_path = ROOT / ".venv"
    if VENV_PY.exists():
        return 0

    log(f"建立虛擬環境 .venv（使用 {py.name}）...")
    code = run_command([str(py), "-m", "venv", str(venv_path)], log=log)
    if code == 0 and VENV_PY.exists():
        return 0

    log("[提醒] 內建 Python 不含 venv 模組，改用 virtualenv…")
    code = run_command([str(py), "-m", "pip", "install", "virtualenv"], log=log)
    if code != 0:
        log(f"[錯誤] 無法安裝 virtualenv（exit code {code}）")
        return code

    if venv_path.exists():
        shutil.rmtree(venv_path, ignore_errors=True)
    code = run_command([str(py), "-m", "virtualenv", str(venv_path)], log=log)
    if code != 0:
        log(f"[錯誤] 建立 .venv 失敗（exit code {code}）")
    return code


def run_setup(log: LogFn = default_log) -> int:
    log("=== 開始安裝轉錄工具 ===")
    if is_frozen() and not PORTABLE_PY.is_file():
        log("[錯誤] 找不到內建 Python（runtime\\python\\python.exe）")
        log("請重新下載完整 CallCoachAssistant-Windows.zip 並解壓。")
        return 1

    if not is_frozen() and sys.version_info < REQUIRED_PY:
        log(f"[錯誤] 需要 Python {REQUIRED_PY[0]}.{REQUIRED_PY[1]}+")
        return 1

    ensure_workspace_files(log)

    code = create_venv(log=log)
    if code != 0:
        return code

    code = run_command([str(VENV_PY), "-m", "pip", "install", "-U", "pip", "wheel"], log=log)
    if code != 0:
        log(f"[錯誤] pip 升級失敗（exit code {code}）")
        log("[提示] 詳細日誌已儲存至 logs/ 資料夾，請複製給技術支援")
        return code

    log("安裝 whisperx（首次約 5～15 分鐘，請保持網路連線）...")
    code = run_command([str(VENV_PY), "-m", "pip", "install", "whisperx", "huggingface_hub"], log=log)
    if code != 0:
        log(f"[錯誤] WhisperX 安裝失敗（exit code {code}）")
        log("[常見原因] 公司網路封鎖 PyPI、Python 版本過新（請用 3.10～3.12）、磁碟空間不足")
        log("[提示] 詳細日誌已儲存至 logs/ 資料夾，請按「複製日誌」傳給技術支援")
        return code

    env_file = ROOT / ".env"
    if not env_file.exists():
        example = ROOT / ".env.example"
        if example.exists():
            shutil.copy(example, env_file)
            log("已建立 .env — 請在下一步填入 HF_TOKEN")

    if not ffmpeg_exe():
        log("[提醒] 找不到 ffmpeg，請安裝: winget install Gyan.FFmpeg")

    log("=== 安裝完成 ===")
    return 0


def run_install_ffmpeg(log: LogFn = default_log) -> int:
    if ffmpeg_exe():
        if BUNDLED_FFMPEG.is_file():
            log("ffmpeg 已就緒（內建）")
        else:
            log("ffmpeg 已安裝")
        return 0

    winget = shutil.which("winget")
    if not winget:
        log("[錯誤] 找不到 winget，請手動安裝 ffmpeg：")
        log("  winget install Gyan.FFmpeg")
        log("或至 https://ffmpeg.org/download.html 下載")
        return 1

    log("=== 開始安裝 ffmpeg（透過 winget）===")
    code = run_command(
        [
            winget,
            "install",
            "-e",
            "--id",
            "Gyan.FFmpeg",
            "--accept-package-agreements",
            "--accept-source-agreements",
        ],
        log=log,
    )
    if code != 0:
        log(f"[錯誤] ffmpeg 安裝失敗（exit code {code}）")
        log("[常見原因] 公司電腦封鎖 winget 或需管理員權限")
        log("[提示] 詳細日誌已儲存至 logs/ 資料夾")
        return code

    if shutil.which("ffmpeg"):
        log("=== ffmpeg 安裝完成 ===")
        return 0

    log("[提醒] winget 已執行，但目前仍找不到 ffmpeg。")
    log("請關閉並重新開啟轉錄助手視窗，或重新開機後再試。")
    return 0


def run_full_setup(log: LogFn = default_log) -> int:
    log("=== 完整環境安裝（ffmpeg + 轉錄工具）===")
    if not ffmpeg_exe():
        code = run_install_ffmpeg(log=log)
        if code != 0:
            return code
    return run_setup(log=log)


def run_uninstall(remove_models: bool = False, log: LogFn = default_log) -> int:
    log("=== 解除安裝轉錄環境 ===")
    venv = ROOT / ".venv"
    if venv.exists():
        log("刪除 .venv（WhisperX 虛擬環境）...")
        shutil.rmtree(venv, ignore_errors=True)
    else:
        log(".venv 不存在，略過")

    if remove_models:
        models = ROOT / "models"
        if models.exists():
            log("刪除 models（AI 模型快取，約 3～6 GB）...")
            shutil.rmtree(models, ignore_errors=True)
        else:
            log("models 不存在，略過")
    else:
        log("保留 models 快取（下次安裝可省時）")

    log("已保留：input / output / .env")
    log("=== 解除安裝完成 ===")
    log("需要時可再次按「一鍵安裝」。")
    return 0


def run_transcribe(mp4_name: str | None = None, log: LogFn = default_log, hooks: JobHooks | None = None) -> int:
    log("=== 開始轉錄 DEMO ===")

    if hooks and hooks.is_cancelled():
        log("[已取消] 轉錄已停止")
        return CANCEL_EXIT

    if not VENV_PY.exists():
        log("[錯誤] 尚未安裝，請先按「一鍵安裝」")
        return 1

    if not has_valid_token():
        log("[錯誤] 請先設定 HF_TOKEN")
        return 1

    env_vars = shell_env(cache_env())
    (ROOT / "models").mkdir(exist_ok=True)
    (ROOT / "output").mkdir(exist_ok=True)
    (ROOT / "input").mkdir(exist_ok=True)

    try:
        if mp4_name:
            mp4 = find_mp4(f"input/{mp4_name}")
        else:
            mp4 = find_mp4()
    except FileNotFoundError as e:
        log(f"[錯誤] {e}")
        return 1

    log(f"錄影檔: {mp4.name}")
    wav = mp4.with_suffix(".wav")
    ffmpeg = ffmpeg_exe()

    from transcribe_parallel import (
        chunk_count_for_duration,
        estimate_transcribe_minutes,
        max_parallel_workers,
        probe_duration_seconds,
        run_parallel_transcribe,
    )

    duration = probe_duration_seconds(mp4, ffmpeg, log) if ffmpeg else 0.0
    chunk_count = chunk_count_for_duration(duration) if duration > 0 else 1
    use_parallel = chunk_count > 1 and bool(ffmpeg)
    code = 0

    if use_parallel:
        parallel = max_parallel_workers(chunk_count)
        eta_low, eta_high = estimate_transcribe_minutes(duration, chunk_count, parallel)
        log(
            f"[1/2] 長影片分段模式：略過整段音軌抽出，直接從 MP4 切 {chunk_count} 段"
            f"（預估總耗時約 {eta_low}～{eta_high} 分鐘）…"
        )
    elif ffmpeg:
        log("[1/2] 從 MP4 抽出音軌（長影片可能需 5～15 分鐘，請耐心等候）...")
        code = run_command(
            [
                ffmpeg,
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(mp4),
                "-vn",
                "-ac",
                "1",
                "-ar",
                "16000",
                "-c:a",
                "pcm_s16le",
                str(wav),
            ],
            log=log,
            env=env_vars,
            hooks=hooks,
        )
        if code == CANCEL_EXIT:
            return code
        if code != 0:
            log("[錯誤] 音軌抽取失敗")
            return code
        duration = probe_duration_seconds(wav, ffmpeg, log) if duration <= 0 else duration
    else:
        log("[提醒] 未安裝 ffmpeg，直接對 MP4 轉錄")

    if hooks and hooks.is_cancelled():
        log("[已取消] 轉錄已停止")
        return CANCEL_EXIT

    audio = mp4 if use_parallel else (wav if ffmpeg else mp4)
    threads = transcribe_threads()
    batch = transcribe_batch()

    if use_parallel:
        stem = Path(mp4.name).stem
        final_srt = ROOT / "output" / f"{stem}.srt"
        code = run_parallel_transcribe(
            audio=audio,
            chunk_count=chunk_count,
            ffmpeg=ffmpeg,
            work_root=ROOT / "output",
            output_dir=ROOT / "output",
            final_srt=final_srt,
            whisperx_cmd=whisperx_cmd(),
            model=MODEL,
            default_threads=threads,
            batch=batch,
            env_vars=env_vars,
            run_command=run_command,
            log=log,
            hooks=hooks,
            cancel_check=lambda: bool(hooks and hooks.is_cancelled()),
        )
        if code == CANCEL_EXIT:
            return code

    if not use_parallel or code != 0:
        if use_parallel and code != 0:
            log("[提醒] 分段平行轉錄失敗，改為單檔完整轉錄（較慢但較穩定）…")
            if ffmpeg and not wav.exists():
                log("[1/2] 從 MP4 抽出音軌…")
                code = run_command(
                    [
                        ffmpeg,
                        "-y",
                        "-hide_banner",
                        "-loglevel",
                        "error",
                        "-i",
                        str(mp4),
                        "-vn",
                        "-ac",
                        "1",
                        "-ar",
                        "16000",
                        "-c:a",
                        "pcm_s16le",
                        str(wav),
                    ],
                    log=log,
                    env=env_vars,
                    hooks=hooks,
                )
                if code == CANCEL_EXIT:
                    return code
                if code != 0:
                    log("[錯誤] 音軌抽取失敗")
                    return code
            audio = wav if ffmpeg else mp4
        elif duration > 0 and chunk_count == 1:
            eta_low, eta_high = estimate_transcribe_minutes(duration, 1, 1)
            log(
                f"[2/2] 音檔約 {int(duration // 60)} 分鐘，單段轉錄"
                f"（預估約 {eta_low}～{eta_high} 分鐘）…"
            )
        else:
            log("[2/2] 開始轉錄（2 小時 DEMO 約 1.5～3 小時，請接電源）…")
        code = run_command(
            whisperx_cmd()
            + [
                str(audio),
                "--model",
                MODEL,
                "--language",
                "zh",
                "--device",
                "cpu",
                "--compute_type",
                "int8",
                "--threads",
                str(threads),
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
                str(ROOT / "output"),
            ],
            log=log,
            env=env_vars,
            hooks=hooks,
        )
        if code == CANCEL_EXIT:
            log("[已取消] 轉錄已停止")
            return code
        if code != 0:
            log("[錯誤] 轉錄失敗")
            return code

    srts = list((ROOT / "output").glob("*.srt"))
    log("=== 轉錄完成 ===")
    for s in srts:
        log(f"逐字稿: {s.name}")
    log(f"請上傳至 Call Coach: {CALL_COACH_URL}")
    return 0


def open_folder(folder: str) -> None:
    path = ROOT / folder
    path.mkdir(exist_ok=True)
    if sys.platform == "win32":
        os.startfile(str(path))  # type: ignore[attr-defined]
    elif sys.platform == "darwin":
        subprocess.run(["open", str(path)], check=False)
    else:
        subprocess.run(["xdg-open", str(path)], check=False)


HF_URL_PREFIXES = (
    "https://huggingface.co/join",
    "https://huggingface.co/settings/tokens",
    "https://huggingface.co/pyannote/",
)


def open_url(url: str) -> None:
    url = url.strip()
    if not any(url.startswith(p) for p in HF_URL_PREFIXES):
        raise ValueError("僅允許開啟 Hugging Face 相關頁面")
    if sys.platform == "win32":
        os.startfile(url)  # type: ignore[attr-defined]
    else:
        import webbrowser

        webbrowser.open(url)


def list_srt_files() -> list[Path]:
    output_dir = ROOT / "output"
    if not output_dir.exists():
        return []
    return sorted(output_dir.glob("*.srt"), key=lambda p: p.stat().st_mtime, reverse=True)


def get_latest_srt() -> Path | None:
    files = list_srt_files()
    return files[0] if files else None


def read_srt(filename: str | None = None) -> tuple[str, str]:
    if filename:
        path = ROOT / "output" / Path(filename).name
    else:
        path = get_latest_srt()
    if not path or not path.exists():
        raise FileNotFoundError("找不到 SRT 逐字稿")
    return path.name, path.read_text(encoding="utf-8")
