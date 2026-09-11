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
from proc_utils import no_window_kwargs, quiet_run

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
        quiet_run(
            ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
            capture_output=True,
        )
    else:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


def default_log(msg: str) -> None:
    from progress_tracker import PROGRESS_PREFIX

    if msg.startswith(PROGRESS_PREFIX):
        return
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


def update_env_values(updates: dict[str, str], env_file: Path | None = None) -> None:
    """Rewrite KEY=VALUE lines in .env (creating it from .env.example if needed)."""
    env_file = env_file or ROOT / ".env"
    if not env_file.exists():
        example = env_file.parent / ".env.example"
        if example.exists():
            shutil.copy(example, env_file)
    lines: list[str] = []
    seen: set[str] = set()
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            key_name = line.partition("=")[0].strip()
            if key_name in updates:
                lines.append(f"{key_name}={updates[key_name]}")
                seen.add(key_name)
            else:
                lines.append(line)
    for name, value in updates.items():
        if name not in seen:
            lines.append(f"{name}={value}")
    env_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
    try:
        os.chmod(env_file, 0o600)
    except OSError:
        pass


def save_hf_token(token: str) -> None:
    token = token.strip()
    if not token.startswith("hf_"):
        raise ValueError("Token 必須以 hf_ 開頭")
    update_env_values({"HF_TOKEN": token})


def has_valid_token() -> bool:
    token = load_env().get("HF_TOKEN", "")
    return bool(token) and token.startswith("hf_") and "在這裡" not in token


def azure_config() -> tuple[str, str]:
    env = load_env()
    return env.get("AZURE_SPEECH_KEY", "").strip(), env.get("AZURE_SPEECH_REGION", "").strip().lower()


def azure_endpoint() -> str:
    return load_env().get("AZURE_SPEECH_ENDPOINT", "").strip()


def has_azure_config() -> bool:
    key, region = azure_config()
    return bool(key) and bool(region) and "在這裡" not in key


def save_azure_config(key: str, region: str, endpoint: str = "") -> None:
    from azure_transcribe import RECOMMENDED_FAST_REGIONS, REGION_RE

    key = key.strip()
    region = region.strip().lower()
    endpoint = endpoint.strip()
    if not key:
        raise ValueError("請填入 Azure Speech 金鑰")
    if not region:
        raise ValueError(f"請填入 Azure 區域（建議 {' 或 '.join(RECOMMENDED_FAST_REGIONS)}）")
    if not REGION_RE.match(region):
        raise ValueError("Azure 區域只能是小寫英數，例如 southeastasia")
    if endpoint and not endpoint.startswith("https://"):
        raise ValueError("Azure 端點必須以 https:// 開頭")
    updates = {"AZURE_SPEECH_KEY": key, "AZURE_SPEECH_REGION": region}
    if endpoint:
        updates["AZURE_SPEECH_ENDPOINT"] = endpoint
    update_env_values(updates)


def azure_fast_supported() -> bool:
    from azure_transcribe import region_supports_fast

    _key, region = azure_config()
    return bool(azure_endpoint()) or region_supports_fast(region)


def team_config_file() -> Path:
    from team_config import team_config_path

    return team_config_path(ROOT)


def team_config_info() -> dict:
    from team_config import load_team_config

    path = team_config_file()
    values = load_team_config(path)
    return {
        "present": bool(values),
        "path": str(path),
        "team_name": values.get("CALL_COACH_TEAM_NAME", "") or load_env().get("CALL_COACH_TEAM_NAME", ""),
        "provides_azure": "AZURE_SPEECH_KEY" in values,
        "provides_hf_token": "HF_TOKEN" in values,
    }


def apply_team_config(log: LogFn = default_log) -> list[str]:
    """Fill blank/placeholder .env values from team-config.env. Returns keys written."""
    from team_config import load_team_config, merge_missing

    path = team_config_file()
    team = load_team_config(path)
    if not team:
        return []
    updates = merge_missing(team, load_env())
    if not updates:
        return []
    update_env_values(updates)
    log(f"[團隊設定] 已從 {path.name} 套用：{', '.join(sorted(updates))}")
    return sorted(updates)


def import_team_config_text(text: str) -> dict[str, str]:
    """Import a team config pasted/uploaded from the UI: overwrite .env and keep a copy."""
    from team_config import TeamConfigError, parse_env_text, render_team_config, validate_team_config

    values, ignored = parse_env_text(text)
    validate_team_config(values)
    if ignored:
        raise TeamConfigError(f"設定檔含不支援的欄位：{', '.join(ignored)}")
    update_env_values(values)
    path = team_config_file()
    try:
        path.write_text(render_team_config(values), encoding="utf-8")
        os.chmod(path, 0o600)
    except OSError:
        pass
    return values


def export_team_config_text(*, include_hf_token: bool = False, team_name: str = "") -> str:
    from team_config import ALLOWED_KEYS, TeamConfigError, is_placeholder, render_team_config

    env = load_env()
    values = {k: env[k] for k in ALLOWED_KEYS if k in env and not is_placeholder(env[k])}
    values.pop("CALL_COACH_TEAM_NAME", None)
    if not include_hf_token:
        values.pop("HF_TOKEN", None)
    if "AZURE_SPEECH_KEY" not in values and "HF_TOKEN" not in values:
        raise TeamConfigError("目前沒有可匯出的設定：請先填好 Azure 金鑰與區域")
    return render_team_config(values, team_name=team_name.strip() or env.get("CALL_COACH_TEAM_NAME", ""))


def default_transcribe_mode() -> str:
    """Mode the UI should preselect: team/admin choice, else Azure when configured, else local."""
    from transcribe_modes import MODE_AZURE, MODE_STANDARD, VALID_MODES

    configured = load_env().get("CALL_COACH_DEFAULT_MODE", "").strip().lower()
    if configured in VALID_MODES:
        if configured == MODE_AZURE and not has_azure_config():
            return MODE_STANDARD
        return configured
    if has_azure_config():
        return MODE_AZURE
    return MODE_STANDARD


def extract_wav_from_mp4(
    mp4: Path,
    wav: Path,
    ffmpeg: str,
    log: LogFn,
    env_vars: dict[str, str],
    hooks: JobHooks | None,
    progress=None,
) -> int:
    log("[1/2] 從 MP4 抽出音軌（長影片可能需 5～15 分鐘，請耐心等候）...")
    cmd = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error"]
    if progress is not None:
        # key=value progress on stdout; the tracker consumes those lines so the log stays readable
        cmd += ["-nostats", "-progress", "pipe:1"]
        progress.phase("extract", "ffmpeg 抽出 16 kHz 單聲道音軌")
        log = progress.wrap_ffmpeg_log(log)
    cmd += ["-i", str(mp4), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(wav)]
    return run_command(cmd, log=log, env=env_vars, hooks=hooks)


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


def smart_app_control_state() -> str:
    """Windows 11 Smart App Control: 'off' | 'on' | 'evaluation' | 'unknown'.

    SAC blocks unsigned executables (our PyInstaller exe, ffmpeg, whisperx) and can only be
    turned off, never re-enabled without reinstalling Windows.
    """
    if sys.platform != "win32":
        return "off"
    try:
        import winreg

        with winreg.OpenKey(
            winreg.HKEY_LOCAL_MACHINE,
            r"SYSTEM\CurrentControlSet\Control\CI\Policy",
        ) as key:
            value, _ = winreg.QueryValueEx(key, "VerifiedAndReputablePolicyState")
    except OSError:
        return "unknown"
    return {0: "off", 1: "on", 2: "evaluation"}.get(int(value), "unknown")


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
    faster_whisper_ok: bool
    token_ok: bool
    azure_ok: bool
    azure_region: str | None
    input_dir_ok: bool
    output_dir_ok: bool
    mp4_files: list[str] = field(default_factory=list)
    srt_files: list[str] = field(default_factory=list)
    ready_to_transcribe: bool = False
    azure_fast_ok: bool = False
    azure_endpoint: str = ""
    default_mode: str = "standard"
    team_config: dict = field(default_factory=dict)

    @property
    def local_ready(self) -> bool:
        return self.python_ok and self.venv_ok and self.whisperx_ok and self.token_ok

    @property
    def azure_ready(self) -> bool:
        return self.azure_ok and self.ffmpeg_ok

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
            "faster_whisper_ok": self.faster_whisper_ok,
            "token_ok": self.token_ok,
            "azure_ok": self.azure_ok,
            "azure_region": self.azure_region,
            "input_dir_ok": self.input_dir_ok,
            "output_dir_ok": self.output_dir_ok,
            "mp4_files": self.mp4_files,
            "srt_files": self.srt_files,
            "ready_to_transcribe": self.ready_to_transcribe,
            "local_ready": self.local_ready,
            "azure_ready": self.azure_ready,
            "azure_fast_ok": self.azure_fast_ok,
            "azure_endpoint": self.azure_endpoint,
            "default_mode": self.default_mode,
            "team_config": self.team_config,
            "root": str(ROOT),
            "input_folder": str(ROOT / "input"),
            "packaged": is_frozen(),
            "installer_setup": (ROOT / ".setup_complete").is_file(),
            "bundled_ffmpeg": BUNDLED_FFMPEG.is_file(),
            "can_uninstall": self.venv_ok,
            "api_capabilities": [
                "setup",
                "full-setup",
                "install-ffmpeg",
                "team-config",
                "azure-fast",
                "progress",
                "report-save",
            ],
            "call_coach_url": CALL_COACH_URL,
            "hf_links": HF_LINKS,
            "transcribe_modes": ["fast", "standard", "azure"],
            "smart_app_control": smart_app_control_state(),
        }


def faster_whisper_installed() -> bool:
    """Filesystem check only — this runs on every /api/status poll, so it must not spawn a process."""
    if not VENV_PY.exists():
        return False
    site = ROOT / ".venv" / "Lib" / "site-packages"
    if not site.is_dir():
        candidates = list((ROOT / ".venv" / "lib").glob("python3*/site-packages")) if (ROOT / ".venv" / "lib").is_dir() else []
        if not candidates:
            return False
        site = candidates[0]
    return (site / "faster_whisper").is_dir()


def get_status() -> EnvStatus:
    python_ok, ver, python_warning = python_version_info()
    ffmpeg_ok = ffmpeg_exe() is not None
    winget_ok = shutil.which("winget") is not None
    venv_ok = VENV_PY.exists()
    whisperx_ok = WHISPERX.exists() or (ROOT / ".venv" / "Scripts" / "whisperx.cmd").exists()
    faster_whisper_ok = faster_whisper_installed()
    token_ok = has_valid_token()
    azure_key, azure_region = azure_config()
    azure_ok = has_azure_config()
    input_dir = ROOT / "input"
    output_dir = ROOT / "output"
    mp4s = [p.name for p in list_mp4_files()]
    srts = []
    if output_dir.exists():
        srts = [p.name for p in sorted(output_dir.glob("*.srt"), key=lambda p: p.stat().st_mtime, reverse=True)]

    local_ready = python_ok and venv_ok and whisperx_ok and token_ok
    azure_ready = azure_ok and ffmpeg_ok
    ready = (local_ready or azure_ready) and bool(mp4s)

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
        faster_whisper_ok=faster_whisper_ok,
        token_ok=token_ok,
        azure_ok=azure_ok,
        azure_region=azure_region or None,
        input_dir_ok=input_dir.exists(),
        output_dir_ok=output_dir.exists(),
        mp4_files=mp4s,
        srt_files=srts,
        ready_to_transcribe=ready,
        azure_fast_ok=azure_ok and azure_fast_supported(),
        azure_endpoint=azure_endpoint(),
        default_mode=default_transcribe_mode(),
        team_config=team_config_info(),
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
        **no_window_kwargs(),
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

    log("安裝 whisperx、faster-whisper、azure 語音 SDK（首次約 5～15 分鐘，請保持網路連線）...")
    code = run_command(
        [
            str(VENV_PY),
            "-m",
            "pip",
            "install",
            "whisperx",
            "huggingface_hub",
            "faster-whisper",
            "azure-cognitiveservices-speech",
        ],
        log=log,
    )
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


def run_transcribe(
    mp4_name: str | None = None,
    log: LogFn = default_log,
    hooks: JobHooks | None = None,
    mode: str = "standard",
    cloud_consent: bool = False,
) -> int:
    from azure_transcribe import run_azure_transcribe
    from progress_tracker import ProgressTracker, estimate_azure_minutes
    from transcribe_modes import MODE_AZURE, MODE_LABELS, model_for_mode, normalize_mode, validate_transcribe_request
    from transcribe_parallel import (
        chunk_count_for_duration,
        estimate_transcribe_minutes,
        max_parallel_workers,
        probe_duration_seconds,
        run_parallel_transcribe,
    )

    mode = normalize_mode(mode)
    log("=== 開始轉錄 DEMO ===")
    log(f"模式：{MODE_LABELS[mode]}")
    progress = ProgressTracker(log, mode=mode)

    def fail(code: int) -> int:
        progress.finish(ok=False)
        return code

    if hooks and hooks.is_cancelled():
        log("[已取消] 轉錄已停止")
        return fail(CANCEL_EXIT)

    err = validate_transcribe_request(mode, cloud_consent, has_azure_config())
    if err:
        log(f"[錯誤] {err}")
        return fail(1)

    if mode != MODE_AZURE:
        if not VENV_PY.exists():
            log("[錯誤] 本機轉錄環境尚未安裝，請先按「一鍵安裝」；或改用 Azure 雲端轉錄（免安裝）")
            return fail(1)
        if not has_valid_token():
            log("[錯誤] 本機轉錄請先設定 HF_TOKEN；或改用 Azure 雲端轉錄（不需 HF Token）")
            return fail(1)

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
        return fail(1)

    log(f"錄影檔: {mp4.name}")
    wav = mp4.with_suffix(".wav")
    ffmpeg = ffmpeg_exe()
    whisper_model = model_for_mode(mode)
    threads = transcribe_threads()
    batch = transcribe_batch()
    stem = Path(mp4.name).stem
    final_srt = ROOT / "output" / f"{stem}.srt"

    # ffprobe hints about parallel mode are irrelevant for Azure, keep that path quiet
    probe_log: LogFn = log if mode != MODE_AZURE else (lambda _m: None)
    duration = probe_duration_seconds(mp4, ffmpeg, probe_log) if ffmpeg else 0.0
    if duration > 0:
        progress.set_duration(duration)
        log(f"音訊長度：約 {int(duration // 60)} 分 {int(duration % 60)} 秒")

    if mode == MODE_AZURE:
        if not ffmpeg:
            log("[錯誤] Azure 轉錄需要 ffmpeg 抽出音軌")
            return fail(1)
        progress.use_plan("azure")
        eta_low, eta_high = estimate_azure_minutes(duration)
        progress.set_eta_minutes(eta_low, eta_high)
        log(f"預估總耗時約 {eta_low}～{eta_high} 分鐘（含上傳）")
        code = extract_wav_from_mp4(mp4, wav, ffmpeg, log, env_vars, hooks, progress=progress)
        if code == CANCEL_EXIT:
            return fail(code)
        if code != 0:
            log("[錯誤] 音軌抽取失敗")
            return fail(code)
        azure_key, azure_region = azure_config()
        progress.phase("azure", "上傳音訊並等待 Azure 回傳（單一請求，無法中途顯示百分比）")
        try:
            code = run_azure_transcribe(
                wav,
                final_srt,
                speech_key=azure_key,
                speech_region=azure_region,
                endpoint=azure_endpoint() or None,
                log=log,
                cancel_check=lambda: bool(hooks and hooks.is_cancelled()),
            )
        finally:
            try:
                wav.unlink()
            except OSError:
                pass
        if code == 0:
            progress.phase("save", final_srt.name)
            log("=== 轉錄完成 ===")
            log(f"逐字稿: {final_srt.name}")
            log(f"請上傳至 Call Coach: {CALL_COACH_URL}")
            progress.finish(ok=True)
            return 0
        return fail(code)

    chunk_count = chunk_count_for_duration(duration) if duration > 0 else 1
    use_parallel = chunk_count > 1 and bool(ffmpeg)
    code = 0

    if use_parallel:
        parallel = max_parallel_workers(chunk_count)
        eta_low, eta_high = estimate_transcribe_minutes(duration, chunk_count, parallel)
        progress.use_plan("parallel")
        progress.set_eta_minutes(eta_low, eta_high)
        log(
            f"[1/2] Faster-Whisper 分段模式（{whisper_model}）：直接從 MP4 切 {chunk_count} 段"
            f"（預估總耗時約 {eta_low}～{eta_high} 分鐘）…"
        )
    elif ffmpeg:
        progress.use_plan("local")
        eta_low, eta_high = estimate_transcribe_minutes(duration, 1, 1)
        progress.set_eta_minutes(eta_low, eta_high)
        code = extract_wav_from_mp4(mp4, wav, ffmpeg, log, env_vars, hooks, progress=progress)
        if code == CANCEL_EXIT:
            return fail(code)
        if code != 0:
            log("[錯誤] 音軌抽取失敗")
            return fail(code)
        duration = probe_duration_seconds(wav, ffmpeg, log) if duration <= 0 else duration
    else:
        progress.use_plan("local")
        progress.skip_phase("extract")
        eta_low, eta_high = estimate_transcribe_minutes(duration, 1, 1)
        progress.set_eta_minutes(eta_low, eta_high)
        log("[提醒] 未安裝 ffmpeg，直接對 MP4 轉錄")

    if hooks and hooks.is_cancelled():
        log("[已取消] 轉錄已停止")
        return fail(CANCEL_EXIT)

    audio = mp4 if use_parallel else (wav if ffmpeg else mp4)

    if use_parallel:
        code = run_parallel_transcribe(
            audio=audio,
            chunk_count=chunk_count,
            ffmpeg=ffmpeg,
            work_root=ROOT / "output",
            output_dir=ROOT / "output",
            final_srt=final_srt,
            whisperx_cmd=whisperx_cmd(),
            model=whisper_model,
            default_threads=threads,
            batch=batch,
            env_vars=env_vars,
            run_command=run_command,
            log=log,
            hooks=hooks,
            cancel_check=lambda: bool(hooks and hooks.is_cancelled()),
            progress=progress,
        )
        if code == CANCEL_EXIT:
            return fail(code)

    if not use_parallel or code != 0:
        if use_parallel and code != 0:
            log("[提醒] 分段平行轉錄失敗，改為單檔完整轉錄（較慢但較穩定）…")
            progress.use_plan("local")
            eta_low, eta_high = estimate_transcribe_minutes(duration, 1, 1)
            progress.set_eta_minutes(eta_low, eta_high)
            if ffmpeg and not wav.exists():
                code = extract_wav_from_mp4(mp4, wav, ffmpeg, log, env_vars, hooks, progress=progress)
                if code == CANCEL_EXIT:
                    return fail(code)
                if code != 0:
                    log("[錯誤] 音軌抽取失敗")
                    return fail(code)
            audio = wav if ffmpeg else mp4
        elif duration > 0 and chunk_count == 1:
            eta_low, eta_high = estimate_transcribe_minutes(duration, 1, 1)
            log(
                f"[2/2] Faster-Whisper {whisper_model}，音檔約 {int(duration // 60)} 分鐘"
                f"（預估約 {eta_low}～{eta_high} 分鐘）…"
            )
        else:
            log(f"[2/2] Faster-Whisper {whisper_model} 轉錄（2 小時 DEMO 約 1.5～3 小時，請接電源）…")
        progress.phase("transcribe", "載入模型")
        progress.set_part_total(1)
        code = run_command(
            whisperx_cmd()
            + whisperx_args(
                audio,
                model=whisper_model,
                threads=threads,
                batch=batch,
                output_dir=ROOT / "output",
            ),
            log=progress.wrap_whisperx_log(log, 0),
            env=env_vars,
            hooks=hooks,
        )
        if code == CANCEL_EXIT:
            log("[已取消] 轉錄已停止")
            return fail(code)
        if code != 0:
            log("[錯誤] 轉錄失敗")
            return fail(code)
        progress.part_done(0)

    progress.phase("save", final_srt.name)
    srts = list((ROOT / "output").glob("*.srt"))
    log("=== 轉錄完成 ===")
    for s in srts:
        log(f"逐字稿: {s.name}")
    log(f"請上傳至 Call Coach: {CALL_COACH_URL}")
    progress.finish(ok=True)
    return 0


def whisperx_args(audio: Path, *, model: str, threads: int, batch: int, output_dir: Path) -> list[str]:
    """CLI arguments shared by single-file and per-chunk WhisperX runs."""
    return [
        str(audio),
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
        str(batch),
        "--diarize",
        "--min_speakers",
        "2",
        "--max_speakers",
        "2",
        "--output_format",
        "srt",
        # emits "Progress: xx%" during transcription/alignment so the UI can show real percent
        "--print_progress",
        "True",
        "--output_dir",
        str(output_dir),
    ]


REPORT_EXTS = (".md", ".txt", ".srt")
REPORT_MAX_BYTES = 2 * 1024 * 1024
_REPORT_BAD_CHARS_RE = re.compile(r'[\\/:*?"<>|\x00-\x1f]+')


def safe_report_name(name: str) -> str:
    """Normalise a user-supplied report filename into a safe basename inside output/."""
    base = Path(str(name or "")).name.strip()
    base = _REPORT_BAD_CHARS_RE.sub("_", base).strip(" .")
    if not base:
        raise ValueError("檔名不可為空")
    stem, ext = Path(base).stem, Path(base).suffix.lower()
    if ext not in REPORT_EXTS:
        raise ValueError("僅允許 .md / .txt / .srt")
    stem = stem.strip(" .")
    if not stem or stem.startswith("."):
        raise ValueError("檔名不可為空")
    if len(stem) > 120:
        stem = stem[:120]
    return f"{stem}{ext}"


def save_report(name: str, content: str) -> Path:
    """Write an exported report / labelled SRT next to the transcripts in output/."""
    if not isinstance(content, str) or not content.strip():
        raise ValueError("內容不可為空")
    if len(content.encode("utf-8")) > REPORT_MAX_BYTES:
        raise ValueError("內容過大（上限 2 MB）")
    filename = safe_report_name(name)
    out_dir = ROOT / "output"
    out_dir.mkdir(exist_ok=True)
    path = out_dir / filename
    path.write_text(content, encoding="utf-8")
    return path


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
