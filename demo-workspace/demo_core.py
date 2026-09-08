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

ROOT = Path(__file__).resolve().parent
VENV_PY = ROOT / ".venv" / "Scripts" / "python.exe"
WHISPERX = ROOT / ".venv" / "Scripts" / "whisperx.exe"
REQUIRED_PY = (3, 10)
MODEL = "medium"
THREADS = 8
BATCH = 4
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


@dataclass
class EnvStatus:
    python_ok: bool
    python_version: str
    ffmpeg_ok: bool
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
            "ffmpeg_ok": self.ffmpeg_ok,
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
            "can_uninstall": self.venv_ok,
            "call_coach_url": CALL_COACH_URL,
            "hf_links": HF_LINKS,
        }


def get_status() -> EnvStatus:
    ver = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    python_ok = sys.version_info >= REQUIRED_PY
    ffmpeg_ok = shutil.which("ffmpeg") is not None
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

    return EnvStatus(
        python_ok=python_ok,
        python_version=ver,
        ffmpeg_ok=ffmpeg_ok,
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
        env=env or os.environ.copy(),
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


def run_setup(log: LogFn = default_log) -> int:
    log("=== 開始安裝轉錄工具 ===")
    if sys.version_info < REQUIRED_PY:
        log(f"[錯誤] 需要 Python {REQUIRED_PY[0]}.{REQUIRED_PY[1]}+")
        return 1

    for name in ("models", "input", "output"):
        (ROOT / name).mkdir(exist_ok=True)
        log(f"資料夾 OK: {name}/")

    if not VENV_PY.exists():
        log("建立虛擬環境 .venv ...")
        code = run_command([sys.executable, "-m", "venv", str(ROOT / ".venv")], log=log)
        if code != 0:
            return code

    code = run_command([str(VENV_PY), "-m", "pip", "install", "-U", "pip", "wheel"], log=log)
    if code != 0:
        return code

    log("安裝 whisperx（首次約 5～15 分鐘，請保持網路連線）...")
    code = run_command([str(VENV_PY), "-m", "pip", "install", "whisperx", "huggingface_hub"], log=log)
    if code != 0:
        return code

    env_file = ROOT / ".env"
    if not env_file.exists():
        shutil.copy(ROOT / ".env.example", env_file)
        log("已建立 .env — 請在下一步填入 HF_TOKEN")

    if not shutil.which("ffmpeg"):
        log("[提醒] 找不到 ffmpeg，請安裝: winget install Gyan.FFmpeg")

    log("=== 安裝完成 ===")
    return 0


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

    env_vars = cache_env()
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
    audio = mp4

    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
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
        audio = wav
    else:
        log("[提醒] 未安裝 ffmpeg，直接對 MP4 轉錄")

    if hooks and hooks.is_cancelled():
        log("[已取消] 轉錄已停止")
        return CANCEL_EXIT

    log("[2/2] 開始轉錄（2 小時 DEMO 約 1.5～3 小時，請接電源）...")
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
            str(THREADS),
            "--batch_size",
            str(BATCH),
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
