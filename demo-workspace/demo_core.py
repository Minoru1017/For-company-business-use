"""Shared DEMO transcription logic for CLI scripts and demo_app."""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import time
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


def gpu_transcribe_batch() -> int:
    try:
        return max(1, min(int(os.environ.get("CALL_COACH_GPU_BATCH", "8")), 16))
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
    """Optional hooks for cancellable subprocess jobs.

    Several subprocesses may be alive at once (parallel chunk transcription), so
    the hooks track a set rather than a single "current" process.
    """

    def register_proc(self, proc: subprocess.Popen) -> None:
        return None

    def unregister_proc(self, proc: subprocess.Popen) -> None:
        return None

    def kill_all(self) -> None:
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


# ----- remote worker (your own GPU machine) ---------------------------------------------------

WORKER_URL_RE = re.compile(r"^https?://[A-Za-z0-9.\-_\[\]:]+(?::\d{2,5})?/?$")


def normalize_worker_url(url: str) -> str:
    """Validate ``http(s)://host[:port]`` and strip the trailing slash."""
    url = url.strip().rstrip("/")
    if not url:
        raise ValueError("請填入遠端主機網址（例：http://100.64.0.2:8766 或 https://worker.example.com）")
    if not WORKER_URL_RE.match(url + "/"):
        raise ValueError("遠端主機網址格式不正確：需為 http(s)://主機[:埠]，不含路徑")
    return url


def worker_config() -> tuple[str, str]:
    env = load_env()
    return env.get("CALL_COACH_WORKER_URL", "").strip().rstrip("/"), env.get("CALL_COACH_WORKER_TOKEN", "").strip()


def has_worker_config() -> bool:
    url, token = worker_config()
    return bool(url) and bool(token) and "在這裡" not in token and "在這裡" not in url


def save_worker_config(url: str, token: str) -> None:
    from security import WORKER_TOKEN_MIN_LEN

    url = normalize_worker_url(url)
    token = token.strip()
    if len(token) < WORKER_TOKEN_MIN_LEN:
        raise ValueError("Worker Token 過短：請貼上家用主機 Worker 視窗顯示的完整 Token")
    update_env_values({"CALL_COACH_WORKER_URL": url, "CALL_COACH_WORKER_TOKEN": token})


def ensure_worker_token(log: LogFn = default_log) -> str:
    """Token the Worker accepts; generated once and persisted in .env on the worker machine."""
    from security import WORKER_TOKEN_MIN_LEN, new_worker_token

    token = load_env().get("CALL_COACH_WORKER_TOKEN", "").strip()
    if token and len(token) >= WORKER_TOKEN_MIN_LEN and "在這裡" not in token:
        return token
    token = new_worker_token()
    update_env_values({"CALL_COACH_WORKER_TOKEN": token})
    log("已產生新的 Worker Token 並寫入 .env（公司電腦需填入同一組 Token）")
    return token


def detect_gpu() -> dict:
    """Ask the WhisperX venv whether torch can see a CUDA device (spawns python; cache the result)."""
    if not VENV_PY.exists():
        return {"available": False, "name": None, "reason": "尚未安裝 WhisperX 環境（.venv）"}
    code = (
        "import json,torch;"
        "ok=torch.cuda.is_available();"
        "print(json.dumps({'available':ok,'name':torch.cuda.get_device_name(0) if ok else None,"
        "'torch':torch.__version__,'cuda':torch.version.cuda}))"
    )
    try:
        proc = quiet_run(
            [str(VENV_PY), "-c", code],
            cwd=ROOT,
            env=shell_env(cache_env()),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=120,
        )
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"available": False, "name": None, "reason": f"無法執行 torch 偵測：{e}"}
    for line in reversed((proc.stdout or "").splitlines()):
        line = line.strip()
        if line.startswith("{"):
            try:
                data = json.loads(line)
            except ValueError:
                break
            if not data.get("available"):
                data["reason"] = (
                    f"torch {data.get('torch')} 未偵測到 CUDA（torch.version.cuda={data.get('cuda')}）。"
                    "RTX 50 系列需 CUDA 12.8 版 torch：請執行 start_worker.cmd 的「重新安裝 GPU 版」"
                )
            return data
    err = (proc.stderr or proc.stdout or "").strip().splitlines()
    return {"available": False, "name": None, "reason": err[-1] if err else "torch 偵測失敗"}


_GPU_CACHE: tuple[float, dict] | None = None
_GPU_CACHE_TTL_S = 90.0


def detect_gpu_cached() -> dict:
    """Cached ``detect_gpu`` so /api/status polling does not spawn torch every few seconds."""
    global _GPU_CACHE
    now = time.monotonic()
    if _GPU_CACHE is not None and now - _GPU_CACHE[0] < _GPU_CACHE_TTL_S:
        return dict(_GPU_CACHE[1])
    data = detect_gpu()
    _GPU_CACHE = (now, data)
    return dict(data)


def invalidate_gpu_cache() -> None:
    global _GPU_CACHE
    _GPU_CACHE = None


def venv_torch_info() -> dict:
    """Whether .venv torch is a CUDA build (may still fail if drivers are missing)."""
    if not VENV_PY.exists():
        return {"installed": False, "version": None, "cuda_build": None, "cuda_available": False}
    code = (
        "import json,torch;"
        "print(json.dumps({'installed':True,'version':torch.__version__,"
        "'cuda_build':torch.version.cuda,'cuda_available':torch.cuda.is_available()}))"
    )
    try:
        proc = quiet_run(
            [str(VENV_PY), "-c", code],
            cwd=ROOT,
            env=shell_env(cache_env()),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=120,
        )
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"installed": False, "version": None, "cuda_build": None, "cuda_available": False, "error": str(e)}
    for line in reversed((proc.stdout or "").splitlines()):
        line = line.strip()
        if line.startswith("{"):
            try:
                return json.loads(line)
            except ValueError:
                break
    return {"installed": False, "version": None, "cuda_build": None, "cuda_available": False}


def prefer_gpu_setup() -> bool:
    """True when installs should pin CUDA torch (Hsinchu desk / explicit env)."""
    from transcribe_modes import MODE_LOCAL_GPU

    env = load_env()
    mode = env.get("CALL_COACH_DEFAULT_MODE", "").strip().lower()
    if mode == MODE_LOCAL_GPU:
        return True
    flag = env.get("CALL_COACH_PREFER_GPU", "").strip().lower()
    return flag in ("1", "true", "yes", "on")


def gpu_setup_hint(torch_info: dict | None, gpu_info: dict | None) -> str | None:
    """User-facing hint when GPU mode is blocked after a CPU-only pip install."""
    torch_info = torch_info or {}
    gpu_info = gpu_info or {}
    if not torch_info.get("installed"):
        return None
    if torch_info.get("cuda_build"):
        if not gpu_info.get("available"):
            return gpu_info.get("reason") or "CUDA 版 torch 已安裝但目前無法使用 GPU（請更新 NVIDIA 驅動後重開機）"
        return None
    ver = torch_info.get("version") or "?"
    return (
        f"目前 .venv 為 CPU 版 PyTorch（{ver}），無法做本機 GPU 轉錄。"
        "請按「安裝 GPU 版 WhisperX」或在新竹執行 start_hsinchu_gpu.cmd reinstall；"
        "勿用「完整環境安裝」（會裝回 CPU 版）。"
    )


def gpu_environment_diagnose() -> dict:
    """Detailed GPU / WhisperX checks for troubleshooting (clears GPU cache first)."""
    invalidate_gpu_cache()
    torch_info = venv_torch_info()
    gpu_info = detect_gpu()
    whisperx_import_ok = False
    whisperx_error: str | None = None
    if VENV_PY.exists():
        code = (
            "import whisperx,json;"
            "print(json.dumps({'ok':True,'whisperx':getattr(whisperx,'__version__',None)}))"
        )
        try:
            proc = quiet_run(
                [str(VENV_PY), "-c", code],
                cwd=ROOT,
                env=shell_env(cache_env()),
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=180,
            )
            if proc.returncode == 0:
                for line in reversed((proc.stdout or "").splitlines()):
                    if line.strip().startswith("{"):
                        whisperx_import_ok = True
                        break
            else:
                tail = (proc.stdout or proc.stderr or "").strip().splitlines()
                whisperx_error = tail[-1] if tail else f"exit {proc.returncode}"
        except (OSError, subprocess.TimeoutExpired) as e:
            whisperx_error = str(e)

    hint = gpu_setup_hint(torch_info, gpu_info)
    torch_stack = verify_torch_stack() if VENV_PY.exists() else {"ok": False, "error": "no venv"}
    if not torch_stack.get("ok") and not hint:
        hint = (
            f"torch / torchvision 不相容：{torch_stack.get('error')}。"
            "請按「僅修復 CUDA 版 PyTorch」（會一併重裝 torchvision）。"
        )
    return {
        "venv_ok": VENV_PY.exists(),
        "whisperx_cli_ok": WHISPERX.exists() or (ROOT / ".venv" / "Scripts" / "whisperx.cmd").exists(),
        "whisperx_import_ok": whisperx_import_ok,
        "whisperx_import_error": whisperx_error,
        "torch_stack_ok": bool(torch_stack.get("ok")),
        "torch_stack": torch_stack,
        "torch": torch_info,
        "gpu": gpu_info,
        "hf_token_ok": has_valid_token(),
        "ffmpeg_ok": ffmpeg_exe() is not None,
        "hint": hint,
        "assistant_not_worker": (
            "本機 GPU 轉錄需執行 start_call_coach.cmd 或 start_hsinchu_gpu.cmd 開啟「本機助手」，"
            "不是 start_worker.cmd（Worker 僅供公司電腦遠端上傳）。"
        ),
    }


def gpu_whisper_model() -> str:
    env = load_env()
    for key in ("CALL_COACH_GPU_MODEL", "CALL_COACH_WORKER_MODEL"):
        value = env.get(key, "").strip()
        if value:
            return value
    return "large-v3"


_BLACKWELL_GPU_MARKERS = ("5070", "5080", "5090", "5060", "5050", "RTX 50")


def _gpu_name_upper(gpu_info: dict | None) -> str:
    return str((gpu_info or {}).get("name") or "").upper()


def is_blackwell_gpu(gpu_info: dict | None = None) -> bool:
    name = _gpu_name_upper(gpu_info)
    return any(m in name for m in _BLACKWELL_GPU_MARKERS)


def gpu_whisper_compute_type(gpu_info: dict | None = None) -> str:
    """CTranslate2 compute type for WhisperX on CUDA (RTX 50 often needs int8/float32)."""
    override = load_env().get("CALL_COACH_GPU_COMPUTE", "").strip()
    if override:
        return override
    if is_blackwell_gpu(gpu_info):
        return "int8"
    return "float16"


def gpu_transcribe_attempts(gpu_info: dict | None, base_batch: int) -> list[tuple[str, int]]:
    """Ordered (compute_type, batch_size) retries after a failed GPU WhisperX run."""
    gpu_info = gpu_info or {}
    base_batch = max(1, min(base_batch, 16))
    override = load_env().get("CALL_COACH_GPU_COMPUTE", "").strip()
    if override:
        primary = override
    elif is_blackwell_gpu(gpu_info):
        primary = "int8"
    else:
        primary = "float16"
    plans: list[tuple[str, int]] = [(primary, base_batch)]
    for ct, bs in (("float32", max(2, base_batch // 2)), ("int8", max(2, min(4, base_batch)))):
        if (ct, bs) not in plans:
            plans.append((ct, bs))
    return plans


def whisperx_env_broken(log_lines: list[str]) -> bool:
    """Import / dependency errors that batch or compute_type retries cannot fix."""
    text = "\n".join(log_lines[-60:])
    return bool(
        re.search(
            r"torchvision::nms|operator torchvision|Wav2Vec2ForCTC|Could not import module|ModuleNotFoundError",
            text,
            re.IGNORECASE,
        )
    )


def whisperx_failure_hints(log_lines: list[str]) -> list[str]:
    """Turn recent WhisperX stderr/stdout into short user-facing hints."""
    text = "\n".join(log_lines[-80:])
    hints: list[str] = []
    checks = [
        (r"out of memory|CUDA out of memory|allocat", "GPU 顯存不足：請關閉其他佔用 GPU 的程式，或在 .env 設定 CALL_COACH_GPU_BATCH=4 後重試"),
        (r"cudnn|CUDNN", "CUDA/cuDNN 錯誤：請更新 NVIDIA 驅動（RTX 50 建議 570+）並重開機，再執行 GPU 版安裝"),
        (r"gated|401|403|authorized|HF_TOKEN|huggingface", "Hugging Face 分軌模型未授權：請確認 .env 的 HF_TOKEN 有效，並在 Hugging Face 同意 pyannote 模型授權"),
        (r"compute_type|float16|float32", "若為 RTX 50 系列：在 .env 設定 CALL_COACH_GPU_COMPUTE=int8 或 float32 後重試"),
        (r"No such file|ffmpeg|torchcodec", "缺少相依元件或 ffmpeg：請確認完整 GPU 環境安裝成功，並重新執行 start_hsinchu_gpu.cmd reinstall"),
        (
            r"torchvision::nms|operator torchvision|Wav2Vec2ForCTC|Could not import module",
            "torch 與 torchvision 版本不相容（常見於只重裝 torch）：請按「僅修復 CUDA 版 PyTorch」"
            f"或手動執行 pip install --force-reinstall torch torchvision torchaudio --index-url {TORCH_CUDA_INDEX}",
        ),
    ]
    for pattern, msg in checks:
        if re.search(pattern, text, re.IGNORECASE) and msg not in hints:
            hints.append(msg)
    return hints


def run_whisperx_transcribe(
    *,
    audio: Path,
    whisper_model: str,
    threads: int,
    output_dir: Path,
    device: str,
    compute_type: str,
    batch: int,
    env_vars: dict[str, str],
    log: LogFn,
    hooks: JobHooks | None,
    progress,
    gpu_retry: bool = False,
    gpu_info: dict | None = None,
) -> int:
    """Run WhisperX once or with GPU compute/batch retries when ``gpu_retry`` is True."""
    plans = [(compute_type, batch)]
    if gpu_retry and device == "cuda":
        plans = gpu_transcribe_attempts(gpu_info, batch)

    recent: list[str] = []

    def wx_log(msg: str) -> None:
        recent.append(msg)
        if len(recent) > 100:
            del recent[: len(recent) - 100]
        progress.wrap_whisperx_log(log, 0)(msg)

    last_code = 1
    for attempt, (ct, bs) in enumerate(plans):
        if attempt > 0:
            log(f"[提醒] GPU 轉錄失敗（exit {last_code}），改用 compute_type={ct}、batch_size={bs} 重試…")
        last_code = run_command(
            whisperx_cmd()
            + whisperx_args(
                audio,
                model=whisper_model,
                threads=threads,
                batch=bs,
                output_dir=output_dir,
                device=device,
                compute_type=ct,
            ),
            log=wx_log,
            env=env_vars,
            hooks=hooks,
        )
        if last_code == CANCEL_EXIT:
            return last_code
        if last_code == 0:
            return 0
        if whisperx_env_broken(recent):
            break
    for hint in whisperx_failure_hints(recent):
        log(f"[提示] {hint}")
    return last_code


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
        "provides_worker": "CALL_COACH_WORKER_URL" in values,
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
    if not any(k in values for k in ("AZURE_SPEECH_KEY", "HF_TOKEN", "CALL_COACH_WORKER_URL")):
        raise TeamConfigError("目前沒有可匯出的設定：請先填好 Azure 金鑰與區域，或遠端主機網址與 Token")
    return render_team_config(values, team_name=team_name.strip() or env.get("CALL_COACH_TEAM_NAME", ""))


def default_transcribe_mode() -> str:
    """Mode the UI should preselect: team/admin choice, else remote worker / Azure when configured, else local."""
    from transcribe_modes import MODE_AZURE, MODE_LOCAL_GPU, MODE_REMOTE, MODE_STANDARD, VALID_MODES

    configured = load_env().get("CALL_COACH_DEFAULT_MODE", "").strip().lower()
    if configured in VALID_MODES:
        if configured == MODE_AZURE and not has_azure_config():
            return MODE_STANDARD
        if configured == MODE_REMOTE and not has_worker_config():
            return MODE_STANDARD
        if configured == MODE_LOCAL_GPU and not detect_gpu_cached().get("available"):
            return MODE_STANDARD
        return configured
    if detect_gpu_cached().get("available") and VENV_PY.exists() and has_valid_token():
        return MODE_LOCAL_GPU
    # A worker the user set up themselves is faster than Azure and keeps audio in-house.
    if has_worker_config():
        return MODE_REMOTE
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
    """Prefer ``python -X utf8 -m whisperx`` so Transcript: lines do not crash on cp950 Windows consoles."""
    if VENV_PY.is_file():
        return [str(VENV_PY), "-X", "utf8", "-m", "whisperx"]
    if WHISPERX.exists():
        return [str(WHISPERX)]
    alt = ROOT / ".venv" / "Scripts" / "whisperx.cmd"
    if alt.exists():
        return ["cmd", "/c", str(alt)]
    return [str(VENV_PY), "-X", "utf8", "-m", "whisperx"]


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


def _match_mp4_in_input(input_root: Path, name: str) -> Path | None:
    """Resolve a basename under input/; on Windows also match DEMO.mp4 vs demo.mp4."""
    direct = input_root / name
    if direct.is_file():
        return direct
    if sys.platform == "win32":
        want = name.lower()
        for p in input_root.glob("*.mp4"):
            if p.name.lower() == want:
                return p
    return None


def resolve_input_mp4(name: str) -> Path:
    """Resolve a user-facing MP4 basename under input/ (case-insensitive on Windows)."""
    input_root = (ROOT / "input").resolve()
    input_root.mkdir(parents=True, exist_ok=True)
    safe = safe_mp4_name(name)
    found = _match_mp4_in_input(input_root, safe)
    if found is not None:
        return found
    raise FileNotFoundError(f"找不到: {safe}（請確認檔案在 input 資料夾）")


def find_mp4(arg: str | None = None) -> Path:
    input_root = (ROOT / "input").resolve()
    input_root.mkdir(parents=True, exist_ok=True)
    if arg:
        return resolve_input_mp4(arg)

    for preferred_name in ("demo.mp4", "DEMO.mp4"):
        found = _match_mp4_in_input(input_root, preferred_name)
        if found is not None:
            return found

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
        env["HUGGING_FACE_HUB_TOKEN"] = token
    return env


def ffmpeg_exe() -> str | None:
    if BUNDLED_FFMPEG.is_file():
        return str(BUNDLED_FFMPEG)
    return shutil.which("ffmpeg")


def shell_env(extra: dict[str, str] | None = None) -> dict[str, str]:
    env = os.environ.copy()
    if extra:
        env.update(extra)
    # Child Python (whisperx / pip) writes to a pipe; on zh-TW Windows that
    # defaults to cp950 and print() of a simplified character or emoji raises
    # UnicodeEncodeError, killing WhisperX mid-run. run_command decodes UTF-8.
    env.setdefault("PYTHONUTF8", "1")
    env.setdefault("PYTHONIOENCODING", "utf-8")
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
    worker_ok: bool = False
    worker_url: str = ""
    gpu_available: bool = False
    gpu_name: str | None = None
    gpu_reason: str | None = None
    cuda_torch_build: bool = False

    @property
    def local_ready(self) -> bool:
        return self.python_ok and self.venv_ok and self.whisperx_ok and self.token_ok

    @property
    def azure_ready(self) -> bool:
        return self.azure_ok and self.ffmpeg_ok

    @property
    def worker_ready(self) -> bool:
        return self.worker_ok and self.ffmpeg_ok

    @property
    def local_gpu_ready(self) -> bool:
        return self.local_ready and self.ffmpeg_ok and self.gpu_available

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
            "worker_ok": self.worker_ok,
            "worker_url": self.worker_url,
            "worker_ready": self.worker_ready,
            "gpu_available": self.gpu_available,
            "gpu_name": self.gpu_name,
            "gpu_reason": self.gpu_reason,
            "cuda_torch_build": getattr(self, "cuda_torch_build", False),
            "local_gpu_ready": self.local_gpu_ready,
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
                "setup-gpu",
                "full-setup",
                "full-setup-gpu",
                "install-ffmpeg",
                "team-config",
                "azure-fast",
                "progress",
                "report-save",
                "remote-worker",
                "gpu-diagnose",
                "media-playback",
                "repair-gpu-torch",
                "recording-pipeline",
            ],
            "call_coach_url": CALL_COACH_URL,
            "hf_links": HF_LINKS,
            "transcribe_modes": ["fast", "standard", "local_gpu", "azure", "remote"],
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

    worker_url, _worker_token = worker_config()
    worker_ok = has_worker_config()
    gpu_info = detect_gpu_cached() if venv_ok else {"available": False, "reason": None}
    gpu_available = bool(gpu_info.get("available"))
    gpu_name = gpu_info.get("name") if gpu_available else None
    gpu_reason = gpu_info.get("reason") if not gpu_available else None
    cuda_torch_build = bool(gpu_info.get("cuda")) if venv_ok else False
    if venv_ok and not gpu_available:
        ti = {
            "installed": True,
            "version": gpu_info.get("torch"),
            "cuda_build": cuda_torch_build,
        }
        if not cuda_torch_build and not gpu_info.get("torch"):
            ti = venv_torch_info()
            cuda_torch_build = bool(ti.get("cuda_build"))
        hint = gpu_setup_hint(ti, gpu_info)
        if hint:
            gpu_reason = hint

    local_ready = python_ok and venv_ok and whisperx_ok and token_ok
    azure_ready = azure_ok and ffmpeg_ok
    worker_ready = worker_ok and ffmpeg_ok
    local_gpu_ready = local_ready and ffmpeg_ok and gpu_available
    ready = (local_ready or azure_ready or worker_ready or local_gpu_ready) and bool(mp4s)

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
        worker_ok=worker_ok,
        worker_url=worker_url if worker_ok else "",
        gpu_available=gpu_available,
        gpu_name=gpu_name,
        gpu_reason=gpu_reason,
        cuda_torch_build=cuda_torch_build if venv_ok else False,
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
        if code != 0:
            log(f"[提醒] 程序結束碼 {code}{describe_exit_code(code)}")
        return code
    finally:
        if hooks:
            hooks.unregister_proc(proc)


def describe_exit_code(code: int) -> str:
    """Human hint for common Windows crash codes (WhisperX dying mid-run)."""
    unsigned = code & 0xFFFFFFFF
    hints = {
        0xC0000005: "記憶體存取錯誤（通常是記憶體不足或 torch/ctranslate2 崩潰）",
        0xC000012D: "記憶體不足（系統 commit 額度用盡）",
        0xC0000409: "堆疊緩衝區溢位／執行期錯誤",
        0xC00000FD: "堆疊溢位",
        0xC0000135: "缺少 DLL",
        0xC000013A: "被使用者中斷（Ctrl+C）",
    }
    if unsigned in hints:
        return f"：{hints[unsigned]}"
    if code < 0 and sys.platform != "win32":
        return f"：被訊號 {-code} 終止（可能是 OOM killer）"
    if code == 137:
        return "：被系統強制結束（記憶體不足）"
    return ""


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


TORCH_CUDA_INDEX = "https://download.pytorch.org/whl/cu128"
# WhisperX 3.8.x pins torch~=2.8; unpinned cu128 index currently resolves to 2.11 and breaks imports.
TORCH_CUDA_PINS = ("torch==2.8.0", "torchvision==0.23.0", "torchaudio==2.8.0")

VERIFY_TORCH_STACK_CODE = """
import json
try:
    import torch
    import torchvision
    from torchvision.transforms import InterpolationMode
    from transformers import Wav2Vec2ForCTC
    print(json.dumps({"ok": True, "torch": torch.__version__, "torchvision": torchvision.__version__}))
except Exception as e:
    print(json.dumps({"ok": False, "error": str(e)}))
"""


def verify_torch_stack() -> dict:
    """WhisperX alignment pulls transformers → torchvision; versions must match torch."""
    if not VENV_PY.exists():
        return {"ok": False, "error": "尚未建立 .venv"}
    code = VERIFY_TORCH_STACK_CODE
    try:
        proc = quiet_run(
            [str(VENV_PY), "-c", code],
            cwd=ROOT,
            env=shell_env(cache_env()),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=180,
        )
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"ok": False, "error": str(e)}
    for line in reversed((proc.stdout or "").splitlines()):
        line = line.strip()
        if line.startswith("{"):
            try:
                return json.loads(line)
            except ValueError:
                break
    tail = (proc.stderr or proc.stdout or "").strip().splitlines()
    return {"ok": False, "error": tail[-1] if tail else f"exit {proc.returncode}"}


def ensure_cuda_torch(log: LogFn = default_log, *, force: bool = False) -> int:
    """Install or re-pin CUDA 12.8 torch/vision/audio into .venv (RTX 50 / WhisperX GPU)."""
    if not VENV_PY.exists():
        log("[錯誤] 尚未建立 .venv")
        return 1
    cmd = [str(VENV_PY), "-m", "pip", "install"]
    if force:
        cmd.append("--force-reinstall")
    cmd.extend([*TORCH_CUDA_PINS, "--index-url", TORCH_CUDA_INDEX])
    label = "強制安裝" if force else "安裝"
    log(f"{label} CUDA 12.8 版 PyTorch 2.8 + torchvision 0.23（與 WhisperX 相容，約 2.5 GB）…")
    code = run_command(cmd, log=log)
    if code != 0:
        log(f"[錯誤] CUDA 版 PyTorch 安裝失敗（exit code {code}）")
    return code


def run_repair_gpu_torch(log: LogFn = default_log) -> int:
    """Re-pin CUDA torch after a CPU-only pip install (keeps WhisperX packages)."""
    log("=== 修復 CUDA 版 PyTorch（保留已安裝的 WhisperX）===")
    code = ensure_cuda_torch(log, force=True)
    if code != 0:
        return code
    invalidate_gpu_cache()
    ti = venv_torch_info()
    if not ti.get("cuda_build"):
        ver = ti.get("version") or "?"
        log(f"[錯誤] .venv 仍是 CPU 版 PyTorch（{ver}）")
        log(
            "[提示] 請在助手目錄手動執行："
            ".venv\\Scripts\\python -m pip install --force-reinstall "
            "torch torchvision torchaudio "
            f"--index-url {TORCH_CUDA_INDEX}"
        )
        return 1
    stack = verify_torch_stack()
    if not stack.get("ok"):
        log(f"[錯誤] torch / torchvision / transformers 不相容：{stack.get('error')}")
        log("[提示] 請按「僅修復 CUDA 版 PyTorch」或重新執行 GPU 版安裝（會一併重裝 torchvision）")
        return 1
    gpu_info = detect_gpu()
    if gpu_info.get("available"):
        log(f"GPU 就緒：{gpu_info.get('name')}（torch {gpu_info.get('torch')}, CUDA {gpu_info.get('cuda')}）")
    else:
        log(f"[提醒] CUDA 版 torch 已安裝，但 PyTorch 尚無法使用 GPU：{gpu_info.get('reason')}")
    log("=== PyTorch 修復完成 ===")
    return 0


def prepare_gpu_for_transcribe(log: LogFn = default_log) -> int:
    """Preflight before GPU WhisperX — catches torch/torchvision mismatch before long wav jobs."""
    stack = verify_torch_stack()
    if stack.get("ok"):
        return 0
    err = stack.get("error") or "未知錯誤"
    log(f"[錯誤] GPU 轉錄環境檢查未通過：{err}")
    skip = load_env().get("CALL_COACH_SKIP_AUTO_TORCH_REPAIR", "").strip().lower()
    if skip in ("1", "true", "yes", "on"):
        log("[提示] 已設定 CALL_COACH_SKIP_AUTO_TORCH_REPAIR — 請按「僅修復 CUDA 版 PyTorch」")
        return 1
    log("[修復] 正在自動重裝 CUDA 版 torch + torchvision + torchaudio（約 5～10 分鐘，請勿關閉助手）…")
    code = ensure_cuda_torch(log, force=True)
    if code != 0:
        return code
    invalidate_gpu_cache()
    stack = verify_torch_stack()
    if not stack.get("ok"):
        log(f"[錯誤] 自動修復後仍無法載入 WhisperX 相依套件：{stack.get('error')}")
        log("[提示] 請執行「僅修復 CUDA 版 PyTorch」或 start_hsinchu_gpu.cmd reinstall")
        return 1
    log(
        f"[修復] 環境檢查通過（torch {stack.get('torch')}, torchvision {stack.get('torchvision')}）"
    )
    return 0


def run_setup(log: LogFn = default_log, *, gpu: bool = False) -> int:
    """Install the WhisperX venv. ``gpu=True`` pins CUDA 12.8 torch first (RTX 50 series needs it)."""
    log("=== 開始安裝轉錄工具 ===" + ("（GPU 版，CUDA 12.8）" if gpu else ""))
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

    if gpu:
        code = ensure_cuda_torch(log, force=True)
        if code != 0:
            log("[常見原因] 網路中斷、磁碟空間不足（需約 6 GB）")
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

    if gpu:
        # whisperx dependencies often pull torch 2.x+cpu; force CUDA wheel back.
        log("確認 CUDA 版 PyTorch 未被 WhisperX 依賴覆蓋成 CPU 版…")
        code = ensure_cuda_torch(log, force=True)
        if code != 0:
            return code
        invalidate_gpu_cache()
        ti = venv_torch_info()
        if not ti.get("cuda_build"):
            log("[錯誤] 安裝結束後 .venv 仍是 CPU 版 PyTorch，無法做本機 GPU 轉錄")
            ver = ti.get("version") or "?"
            log(f"[錯誤] 目前版本：{ver}")
            log("[提示] 請按「僅修復 CUDA 版 PyTorch」或執行 start_hsinchu_gpu.cmd reinstall")
            return 1
        stack = verify_torch_stack()
        if not stack.get("ok"):
            log(f"[錯誤] WhisperX 相依的 torchvision 與 torch 不相容：{stack.get('error')}")
            log("[提示] 請再執行一次「僅修復 CUDA 版 PyTorch」（會強制重裝 torchvision）")
            return 1
        if stack.get("torchvision"):
            log(f"torchvision {stack.get('torchvision')} 與 torch 版本檢查通過")
        gpu_info = detect_gpu()
        if gpu_info.get("available"):
            log(f"GPU 就緒：{gpu_info.get('name')}（torch {gpu_info.get('torch')}, CUDA {gpu_info.get('cuda')}）")
        else:
            log(f"[提醒] CUDA 版 torch 已安裝，但尚未偵測到可用 GPU：{gpu_info.get('reason')}")
            log("[提醒] 請確認 NVIDIA 驅動為 570 以上（GeForce Experience / NVIDIA App 更新），重開機後再試")

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


def run_full_setup(log: LogFn = default_log, *, gpu: bool | None = None) -> int:
    if gpu is None:
        gpu = prefer_gpu_setup()
    label = "（GPU 版 CUDA 12.8）" if gpu else ""
    log(f"=== 完整環境安裝（ffmpeg + 轉錄工具）{label} ===")
    if gpu:
        log("[提示] 新竹本機 GPU 模式：將安裝 CUDA 版 PyTorch，請勿在安裝完成後再按「完整環境安裝（CPU）」覆蓋。")
    if not ffmpeg_exe():
        code = run_install_ffmpeg(log=log)
        if code != 0:
            return code
    return run_setup(log=log, gpu=gpu)


def run_setup_gpu(log: LogFn = default_log) -> int:
    return run_setup(log=log, gpu=True)


def run_full_setup_gpu(log: LogFn = default_log) -> int:
    return run_full_setup(log=log, gpu=True)


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


def windows_uninstaller_exe() -> Path | None:
    """Inno Setup uninstaller next to CallCoachAssistant.exe (unins000.exe / unins001.exe)."""
    if not is_frozen():
        return None
    for name in ("unins000.exe", "unins001.exe"):
        path = ROOT / name
        if path.is_file():
            return path
    return None


def run_full_uninstall(
    log: LogFn = default_log,
    *,
    remove_models: bool = True,
    remove_logs: bool = True,
    launch_setup_uninstaller: bool = True,
) -> int:
    """Remove transcription env + worker cache, then start the Windows uninstaller when installed via Setup.exe."""
    log("=== 完整解除安裝 ===")
    code = run_uninstall(remove_models=remove_models, log=log)
    worker_dir = ROOT / "worker"
    if worker_dir.exists():
        log("刪除 worker 暫存（遠端轉錄工作資料）...")
        shutil.rmtree(worker_dir, ignore_errors=True)
    if remove_logs:
        logs = ROOT / "logs"
        if logs.is_dir():
            log("刪除 logs 日誌...")
            shutil.rmtree(logs, ignore_errors=True)
            logs.mkdir(exist_ok=True)
    unins = windows_uninstaller_exe()
    if launch_setup_uninstaller and unins:
        log(f"啟動 Windows 解除安裝程式（{unins.name}）…")
        log("請在精靈中完成移除；關閉本視窗後程式會一併卸載。")
        try:
            subprocess.Popen([str(unins)], cwd=str(ROOT), **no_window_kwargs())
        except OSError as e:
            log(f"[錯誤] 無法啟動解除安裝程式：{e}")
            return 1
    elif launch_setup_uninstaller:
        log("[提醒] 找不到安裝精靈的解除安裝程式（可攜版請直接刪除整個資料夾）。")
    log("=== 完整解除安裝（轉錄環境部分）完成 ===")
    return code


def run_transcribe(
    mp4_name: str | None = None,
    log: LogFn = default_log,
    hooks: JobHooks | None = None,
    mode: str = "standard",
    cloud_consent: bool = False,
) -> int:
    from azure_transcribe import run_azure_transcribe
    from progress_tracker import ProgressTracker, estimate_azure_minutes, estimate_remote_minutes
    from remote_transcribe import run_remote_transcribe
    from transcribe_modes import (
        MODE_AZURE,
        MODE_LABELS,
        MODE_LOCAL_GPU,
        MODE_REMOTE,
        OFFSITE_MODES,
        is_local_gpu_mode,
        model_for_mode,
        normalize_mode,
        validate_transcribe_request,
    )
    from transcribe_parallel import (
        MAX_CHUNKS,
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

    err = validate_transcribe_request(mode, cloud_consent, has_azure_config(), has_worker_config())
    if err:
        log(f"[錯誤] {err}")
        return fail(1)

    if mode not in OFFSITE_MODES:
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
            mp4 = find_mp4(mp4_name)
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
    wx_device, wx_compute, wx_batch = "cpu", "int8", batch
    if is_local_gpu_mode(mode):
        gpu_info = detect_gpu_cached()
        if not gpu_info.get("available"):
            log(f"[錯誤] 本機 GPU 模式需要可用的 NVIDIA GPU：{gpu_info.get('reason')}")
            return fail(1)
        whisper_model = gpu_whisper_model()
        wx_compute = gpu_whisper_compute_type(gpu_info)
        wx_device, wx_batch = "cuda", gpu_transcribe_batch()
        log(
            f"本機 GPU：{gpu_info.get('name')}｜WhisperX {whisper_model}"
            f"（cuda / {wx_compute} / batch {wx_batch}，音訊不離開本機、不需遠端 Worker）"
        )
        code = prepare_gpu_for_transcribe(log)
        if code != 0:
            return fail(code)
    stem = Path(mp4.name).stem
    final_srt = ROOT / "output" / f"{stem}.srt"

    # ffprobe hints about parallel mode are irrelevant for offsite modes, keep that path quiet
    probe_log: LogFn = log if mode not in OFFSITE_MODES else (lambda _m: None)
    duration = probe_duration_seconds(mp4, ffmpeg, probe_log) if ffmpeg else 0.0
    if duration > 0:
        progress.set_duration(duration)
        log(f"音訊長度：約 {int(duration // 60)} 分 {int(duration % 60)} 秒")

    if mode == MODE_REMOTE:
        if not ffmpeg:
            log("[錯誤] 遠端主機轉錄需要 ffmpeg 抽出音軌")
            return fail(1)
        progress.use_plan("remote")
        code = extract_wav_from_mp4(mp4, wav, ffmpeg, log, env_vars, hooks, progress=progress)
        if code == CANCEL_EXIT:
            return fail(code)
        if code != 0:
            log("[錯誤] 音軌抽取失敗")
            return fail(code)
        worker_url, worker_token = worker_config()
        try:
            code = run_remote_transcribe(
                wav,
                final_srt,
                worker_url=worker_url,
                token=worker_token,
                duration_s=duration,
                log=log,
                cancel_check=lambda: bool(hooks and hooks.is_cancelled()),
                progress=progress,
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

    parallel = max_parallel_workers(MAX_CHUNKS, whisper_model) if duration > 0 else 1
    chunk_count = chunk_count_for_duration(duration, parallel) if duration > 0 else 1
    use_parallel = chunk_count > 1 and bool(ffmpeg) and not is_local_gpu_mode(mode)
    code = 0

    if use_parallel:
        parallel = min(parallel, chunk_count)
        eta_low, eta_high = estimate_transcribe_minutes(duration, chunk_count, parallel)
        progress.use_plan("parallel")
        progress.set_eta_minutes(eta_low, eta_high)
        log(
            f"[1/2] Faster-Whisper 分段模式（{whisper_model}）：直接從 MP4 切 {chunk_count} 段"
            f"（預估總耗時約 {eta_low}～{eta_high} 分鐘）…"
        )
    elif ffmpeg:
        progress.use_plan("local")
        if is_local_gpu_mode(mode):
            eta_low, eta_high = estimate_remote_minutes(duration, gpu=True)
        else:
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
            batch=wx_batch,
            env_vars=env_vars,
            run_command=run_command,
            log=log,
            hooks=hooks,
            cancel_check=lambda: bool(hooks and hooks.is_cancelled()),
            parallel=parallel,
            progress=progress,
            device=wx_device,
            compute_type=wx_compute,
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
            if is_local_gpu_mode(mode):
                eta_low, eta_high = estimate_remote_minutes(duration, gpu=True)
                log(
                    f"[2/2] WhisperX {whisper_model}（GPU），音檔約 {int(duration // 60)} 分鐘"
                    f"（預估約 {eta_low}～{eta_high} 分鐘）…"
                )
            else:
                eta_low, eta_high = estimate_transcribe_minutes(duration, 1, 1)
                log(
                    f"[2/2] Faster-Whisper {whisper_model}，音檔約 {int(duration // 60)} 分鐘"
                    f"（預估約 {eta_low}～{eta_high} 分鐘）…"
                )
        else:
            log(f"[2/2] Faster-Whisper {whisper_model} 轉錄（2 小時 DEMO 約 1.5～3 小時，請接電源）…")
        progress.phase("transcribe", "載入模型")
        progress.set_part_total(1)
        code = run_whisperx_transcribe(
            audio=audio,
            whisper_model=whisper_model,
            threads=threads,
            output_dir=ROOT / "output",
            device=wx_device,
            compute_type=wx_compute,
            batch=wx_batch,
            env_vars=env_vars,
            log=log,
            hooks=hooks,
            progress=progress,
            gpu_retry=is_local_gpu_mode(mode),
            gpu_info=gpu_info if is_local_gpu_mode(mode) else None,
        )
        if code == CANCEL_EXIT:
            log("[已取消] 轉錄已停止")
            return fail(code)
        if code != 0:
            log(f"[錯誤] 轉錄失敗（WhisperX 結束碼 {code}{describe_exit_code(code)}）")
            if is_local_gpu_mode(mode):
                stack = verify_torch_stack()
                if not stack.get("ok"):
                    log("[提示] torch / torchvision 不相容 — 請按「僅修復 CUDA 版 PyTorch」（11.9.3+ 助手會在轉錄前自動修復）")
                ti = venv_torch_info()
                if not ti.get("cuda_build"):
                    log("[提示] 若剛按過「完整環境安裝」，可能已覆蓋成 CPU 版 PyTorch — 請執行「安裝 GPU 版」或 start_hsinchu_gpu.cmd reinstall")
                elif code in (137, -9) or (code & 0xFFFFFFFF) in (0xC0000005, 0xC000012D):
                    log("[提示] GPU 記憶體可能不足 — 可在 .env 設定 CALL_COACH_GPU_BATCH=4 後重試，或關閉其他佔用顯存的程式")
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


def run_transcribe_wav(
    wav_path: Path | str,
    log: LogFn = default_log,
    hooks: JobHooks | None = None,
    mode: str = "standard",
    cloud_consent: bool = False,
) -> int:
    """Transcribe a WAV on disk (e.g. MicroSIP / NAS share) without an MP4 in input/."""
    from azure_transcribe import run_azure_transcribe
    from progress_tracker import ProgressTracker, estimate_azure_minutes, estimate_remote_minutes
    from remote_transcribe import run_remote_transcribe
    from transcribe_modes import (
        MODE_AZURE,
        MODE_LABELS,
        MODE_REMOTE,
        OFFSITE_MODES,
        is_local_gpu_mode,
        model_for_mode,
        normalize_mode,
        validate_transcribe_request,
    )
    from transcribe_parallel import probe_duration_seconds

    wav = Path(wav_path).resolve()
    if not wav.is_file():
        log(f"[錯誤] 找不到 WAV：{wav}")
        return 1

    mode = normalize_mode(mode)
    log("=== 通話錄音轉錄 ===")
    log(f"模式：{MODE_LABELS[mode]}")
    log(f"音訊檔: {wav.name}")
    progress = ProgressTracker(log, mode=mode)

    def fail(code: int) -> int:
        progress.finish(ok=False)
        return code

    if hooks and hooks.is_cancelled():
        log("[已取消] 轉錄已停止")
        return fail(CANCEL_EXIT)

    err = validate_transcribe_request(mode, cloud_consent, has_azure_config(), has_worker_config())
    if err:
        log(f"[錯誤] {err}")
        return fail(1)

    if mode not in OFFSITE_MODES:
        if not VENV_PY.exists():
            log("[錯誤] 本機轉錄環境尚未安裝，請先按「一鍵安裝」；或改用 Azure 雲端轉錄（免安裝）")
            return fail(1)
        if not has_valid_token():
            log("[錯誤] 本機轉錄請先設定 HF_TOKEN；或改用 Azure 雲端轉錄（不需 HF Token）")
            return fail(1)

    env_vars = shell_env(cache_env())
    (ROOT / "models").mkdir(exist_ok=True)
    (ROOT / "output").mkdir(exist_ok=True)

    ffmpeg = ffmpeg_exe()
    whisper_model = model_for_mode(mode)
    threads = transcribe_threads()
    batch = transcribe_batch()
    wx_device, wx_compute, wx_batch = "cpu", "int8", batch
    gpu_info: dict | None = None
    if is_local_gpu_mode(mode):
        gpu_info = detect_gpu_cached()
        if not gpu_info.get("available"):
            log(f"[錯誤] 本機 GPU 模式需要可用的 NVIDIA GPU：{gpu_info.get('reason')}")
            return fail(1)
        whisper_model = gpu_whisper_model()
        wx_compute = gpu_whisper_compute_type(gpu_info)
        wx_device, wx_batch = "cuda", gpu_transcribe_batch()
        log(
            f"本機 GPU：{gpu_info.get('name')}｜WhisperX {whisper_model}"
            f"（cuda / {wx_compute} / batch {wx_batch}）"
        )
        code = prepare_gpu_for_transcribe(log)
        if code != 0:
            return fail(code)

    stem = wav.stem
    final_srt = ROOT / "output" / f"{stem}.srt"
    duration = probe_duration_seconds(wav, ffmpeg, log) if ffmpeg else 0.0
    if duration > 0:
        progress.set_duration(duration)
        log(f"音訊長度：約 {int(duration // 60)} 分 {int(duration % 60)} 秒")

    if mode == MODE_REMOTE:
        if not ffmpeg:
            log("[錯誤] 遠端主機轉錄需要 ffmpeg 讀取音訊長度")
            return fail(1)
        progress.use_plan("remote")
        worker_url, worker_token = worker_config()
        code = run_remote_transcribe(
            wav,
            final_srt,
            worker_url=worker_url,
            token=worker_token,
            duration_s=duration,
            log=log,
            cancel_check=lambda: bool(hooks and hooks.is_cancelled()),
            progress=progress,
        )
        if code == 0:
            progress.phase("save", final_srt.name)
            log("=== 通話錄音轉錄完成 ===")
            log(f"逐字稿: {final_srt.name}")
            progress.finish(ok=True)
            return 0
        return fail(code)

    if mode == MODE_AZURE:
        progress.use_plan("azure")
        eta_low, eta_high = estimate_azure_minutes(duration)
        progress.set_eta_minutes(eta_low, eta_high)
        log(f"預估總耗時約 {eta_low}～{eta_high} 分鐘（含上傳）")
        azure_key, azure_region = azure_config()
        progress.phase("azure", "上傳音訊並等待 Azure 回傳")
        code = run_azure_transcribe(
            wav,
            final_srt,
            speech_key=azure_key,
            speech_region=azure_region,
            endpoint=azure_endpoint() or None,
            log=log,
            cancel_check=lambda: bool(hooks and hooks.is_cancelled()),
        )
        if code == 0:
            progress.phase("save", final_srt.name)
            log("=== 通話錄音轉錄完成 ===")
            log(f"逐字稿: {final_srt.name}")
            progress.finish(ok=True)
            return 0
        return fail(code)

    progress.use_plan("local")
    if is_local_gpu_mode(mode):
        eta_low, eta_high = estimate_remote_minutes(duration, gpu=True)
        log(
            f"WhisperX {whisper_model}（GPU），音檔約 {int(duration // 60)} 分鐘"
            f"（預估約 {eta_low}～{eta_high} 分鐘）…"
        )
    else:
        from transcribe_parallel import estimate_transcribe_minutes

        eta_low, eta_high = estimate_transcribe_minutes(duration, 1, 1)
        log(
            f"Faster-Whisper {whisper_model}，音檔約 {int(duration // 60)} 分鐘"
            f"（預估約 {eta_low}～{eta_high} 分鐘）…"
        )
    progress.set_eta_minutes(eta_low, eta_high)

    if hooks and hooks.is_cancelled():
        log("[已取消] 轉錄已停止")
        return fail(CANCEL_EXIT)

    progress.phase("transcribe", "載入模型")
    progress.set_part_total(1)
    code = run_whisperx_transcribe(
        audio=wav,
        whisper_model=whisper_model,
        threads=threads,
        output_dir=ROOT / "output",
        device=wx_device,
        compute_type=wx_compute,
        batch=wx_batch,
        env_vars=env_vars,
        log=log,
        hooks=hooks,
        progress=progress,
        gpu_retry=is_local_gpu_mode(mode),
        gpu_info=gpu_info if is_local_gpu_mode(mode) else None,
    )
    if code == CANCEL_EXIT:
        log("[已取消] 轉錄已停止")
        return fail(code)
    if code != 0:
        log(f"[錯誤] 轉錄失敗（WhisperX 結束碼 {code}{describe_exit_code(code)}）")
        return fail(code)
    progress.part_done(0)
    progress.phase("save", final_srt.name)
    log("=== 通話錄音轉錄完成 ===")
    log(f"逐字稿: {final_srt.name}")
    progress.finish(ok=True)
    return 0


def whisperx_hf_cli_args() -> list[str]:
    token = load_env().get("HF_TOKEN", "").strip()
    if token.startswith("hf_"):
        return ["--hf_token", token]
    return []


def whisperx_args(
    audio: Path,
    *,
    model: str,
    threads: int,
    batch: int,
    output_dir: Path,
    device: str = "cpu",
    compute_type: str = "int8",
) -> list[str]:
    """CLI arguments shared by single-file, per-chunk and remote-worker WhisperX runs."""
    return [
        str(audio),
        "--model",
        model,
        "--language",
        "zh",
        "--device",
        device,
        "--compute_type",
        compute_type,
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
    ] + whisperx_hf_cli_args()


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
