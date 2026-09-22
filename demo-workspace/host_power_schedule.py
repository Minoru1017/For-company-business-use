"""Remote sleep time windows + Windows scheduled wake (RTC) for the Hsinchu host agent.

host_schedule.json (all keys optional, older files keep working):

    enabled               bool   master switch (False → any time may sleep, no timed wake)
    remote_sleep_allowed  list   [{start:"22:00", end:"06:00", days:[0..6]}]  0=Mon
    wake_at               list   [{time:"08:00", days:[0..6]}]  weekly RTC wake
    stay_awake_minutes    int    keep PC awake after a scheduled wake (default 30)

A scheduled wake runs ``CallCoachAssistant.exe --keep-awake N`` so Windows does not doze
off again before Tailscale / DeskIn are reachable. One-off wakes (``schedule_one_time_wake``)
use the same action and remove themselves after firing.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from app_paths import is_frozen, resolve_paths

ROOT, _BUNDLE = resolve_paths()
SCHEDULE_FILE = ROOT / "host_schedule.json"
EXAMPLE_FILE = ROOT / "host_schedule.example.json"
LOGS_DIR = ROOT / "logs"
LAST_WAKE_FILE = LOGS_DIR / "last_wake.json"
PENDING_WAKE_FILE = LOGS_DIR / "pending_wake.json"

TASK_PREFIX = "CallCoachHostWake_"
ONCE_TASK_PREFIX = "CallCoachHostWakeOnce_"

DEFAULT_STAY_AWAKE_MIN = 30
MAX_STAY_AWAKE_MIN = 600
TEST_WAKE_DELAY_MIN = 2

_TIME_RE = re.compile(r"^(\d{1,2}):(\d{2})$")


def _parse_hhmm(text: str) -> int | None:
    m = _TIME_RE.match((text or "").strip())
    if not m:
        return None
    h, mi = int(m.group(1)), int(m.group(2))
    if h > 23 or mi > 59:
        return None
    return h * 60 + mi


def _normalize_days(raw: Any) -> list[int]:
    if not isinstance(raw, list):
        return []
    out: list[int] = []
    for d in raw:
        try:
            n = int(d)
        except (TypeError, ValueError):
            continue
        if 0 <= n <= 6 and n not in out:
            out.append(n)
    return sorted(out)


def _clamp_minutes(raw: Any, default: int = DEFAULT_STAY_AWAKE_MIN) -> int:
    try:
        n = int(raw)
    except (TypeError, ValueError):
        return default
    return max(1, min(n, MAX_STAY_AWAKE_MIN))


@dataclass
class TimeWindow:
    start: str
    end: str
    days: list[int] = field(default_factory=list)

    def contains(self, when: datetime) -> bool:
        days = self.days if self.days else list(range(7))
        start_m = _parse_hhmm(self.start)
        end_m = _parse_hhmm(self.end)
        if start_m is None or end_m is None:
            return False
        now_m = when.hour * 60 + when.minute
        wd = when.weekday()

        if start_m <= end_m:
            if wd not in days:
                return False
            return start_m <= now_m <= end_m

        # Overnight: e.g. 22:00–06:00 — evening on `days`, early morning after midnight uses previous weekday
        if now_m >= start_m:
            return wd in days
        if now_m <= end_m:
            prev = (wd - 1) % 7
            return prev in days
        return False


@dataclass
class WakeRule:
    time: str
    days: list[int] = field(default_factory=list)

    def next_occurrence(self, now: datetime) -> datetime | None:
        minutes = _parse_hhmm(self.time)
        if minutes is None:
            return None
        days = self.days or list(range(7))
        for offset in range(0, 8):
            day = (now + timedelta(days=offset)).replace(
                hour=minutes // 60, minute=minutes % 60, second=0, microsecond=0
            )
            if day.weekday() in days and day > now:
                return day
        return None


@dataclass
class HostSchedule:
    enabled: bool = False
    remote_sleep_allowed: list[TimeWindow] = field(default_factory=list)
    wake_at: list[WakeRule] = field(default_factory=list)
    stay_awake_minutes: int = DEFAULT_STAY_AWAKE_MIN

    def remote_sleep_ok(self, when: datetime | None = None) -> bool:
        when = when or datetime.now()
        if not self.enabled:
            return True
        if not self.remote_sleep_allowed:
            return True
        return any(w.contains(when) for w in self.remote_sleep_allowed)

    def next_weekly_wake(self, now: datetime | None = None) -> datetime | None:
        if not self.enabled:
            return None
        now = now or datetime.now()
        candidates = [r.next_occurrence(now) for r in self.wake_at]
        real = [c for c in candidates if c is not None]
        return min(real) if real else None

    def summary_lines(self) -> list[str]:
        if not self.enabled:
            lines = ["排程：未啟用（任何時間可遠端睡眠；無每週定時喚醒）"]
        else:
            lines = ["排程：已啟用（本機 Windows 時區）"]
            if self.remote_sleep_allowed:
                parts = []
                for w in self.remote_sleep_allowed:
                    ds = ",".join(str(d) for d in (w.days or list(range(7))))
                    parts.append(f"{w.start}-{w.end} 週{ds}")
                lines.append("  允許遠端睡眠：" + "；".join(parts))
            else:
                lines.append("  允許遠端睡眠：任何時間")
            if self.wake_at:
                parts = []
                for r in self.wake_at:
                    ds = ",".join(str(d) for d in (r.days or list(range(7))))
                    parts.append(f"{r.time} 週{ds}")
                lines.append("  每週定時喚醒：" + "；".join(parts))
            else:
                lines.append("  每週定時喚醒：（未設定）")
            lines.append(f"  醒後保持清醒：{self.stay_awake_minutes} 分鐘")
            lines.append(f"  現在可否遠端睡眠：{'是' if self.remote_sleep_ok() else '否'}")
        pending = load_pending_wake()
        if pending:
            lines.append(f"  一次性喚醒：{pending['at']}（{pending.get('reason', '')}）")
        nxt = next_wake_time(self)
        if nxt:
            lines.append(f"  下次喚醒：{nxt.strftime('%m/%d %H:%M')}")
        return lines


def default_schedule_dict() -> dict:
    return {
        "enabled": False,
        "remote_sleep_allowed": [
            {"start": "22:00", "end": "06:00", "days": [0, 1, 2, 3, 4]},
        ],
        "wake_at": [{"time": "08:00", "days": [0, 1, 2, 3, 4]}],
        "stay_awake_minutes": DEFAULT_STAY_AWAKE_MIN,
    }


def load_schedule(path: Path | None = None) -> HostSchedule:
    path = path or SCHEDULE_FILE
    if not path.is_file():
        return HostSchedule(enabled=False)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return HostSchedule(enabled=False)
    if not isinstance(data, dict):
        return HostSchedule(enabled=False)

    enabled = bool(data.get("enabled"))
    windows: list[TimeWindow] = []
    for item in data.get("remote_sleep_allowed") or []:
        if not isinstance(item, dict):
            continue
        windows.append(
            TimeWindow(
                start=str(item.get("start", "")),
                end=str(item.get("end", "")),
                days=_normalize_days(item.get("days")),
            )
        )
    wakes: list[WakeRule] = []
    for item in data.get("wake_at") or []:
        if not isinstance(item, dict):
            continue
        wakes.append(
            WakeRule(
                time=str(item.get("time", "")),
                days=_normalize_days(item.get("days")),
            )
        )
    return HostSchedule(
        enabled=enabled,
        remote_sleep_allowed=windows,
        wake_at=wakes,
        stay_awake_minutes=_clamp_minutes(data.get("stay_awake_minutes", DEFAULT_STAY_AWAKE_MIN)),
    )


def ensure_example_file() -> None:
    if EXAMPLE_FILE.is_file():
        return
    EXAMPLE_FILE.write_text(
        json.dumps(default_schedule_dict(), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


# ---------------------------------------------------------------- state files


def _write_json(path: Path, data: dict) -> None:
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _read_json(path: Path) -> dict | None:
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def load_pending_wake() -> dict | None:
    """Pending one-off wake {at:'YYYY-MM-DD HH:MM', reason, task}. Dropped once in the past."""
    data = _read_json(PENDING_WAKE_FILE)
    if not data:
        return None
    try:
        at = datetime.strptime(str(data.get("at", "")), "%Y-%m-%d %H:%M")
    except ValueError:
        return None
    if at < datetime.now() - timedelta(minutes=5):
        return None
    return data


def load_last_wake() -> dict | None:
    return _read_json(LAST_WAKE_FILE)


def record_wake(reason: str, minutes: int) -> dict:
    data = {
        "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "epoch": time.time(),
        "reason": reason,
        "stay_awake_minutes": minutes,
    }
    _write_json(LAST_WAKE_FILE, data)
    return data


def next_wake_time(schedule: HostSchedule | None = None, now: datetime | None = None) -> datetime | None:
    schedule = schedule or load_schedule()
    now = now or datetime.now()
    candidates: list[datetime] = []
    weekly = schedule.next_weekly_wake(now)
    if weekly:
        candidates.append(weekly)
    pending = load_pending_wake()
    if pending:
        try:
            candidates.append(datetime.strptime(pending["at"], "%Y-%m-%d %H:%M"))
        except (KeyError, ValueError):
            pass
    return min(candidates) if candidates else None


def schedule_status_dict(schedule: HostSchedule | None = None) -> dict:
    schedule = schedule or load_schedule()
    nxt = next_wake_time(schedule)
    last = load_last_wake()
    return {
        "enabled": schedule.enabled,
        "remote_sleep_allowed_now": schedule.remote_sleep_ok(),
        "stay_awake_minutes": schedule.stay_awake_minutes,
        "next_wake": nxt.strftime("%Y-%m-%d %H:%M") if nxt else None,
        "pending_wake": load_pending_wake(),
        "last_wake": last,
        "summary": schedule.summary_lines(),
    }


def resolve_wake_datetime(
    *,
    wake_after_min: Any = None,
    wake_at: Any = None,
    now: datetime | None = None,
) -> datetime:
    """Turn a request ('wake_after_min': 480 or 'wake_at': '08:00') into an absolute time.

    Raises ValueError with a user-facing message.
    """
    now = now or datetime.now()
    if wake_after_min not in (None, "", 0, "0"):
        try:
            mins = int(wake_after_min)
        except (TypeError, ValueError) as e:
            raise ValueError("wake_after_min 須為分鐘數") from e
        if mins < 1 or mins > 7 * 24 * 60:
            raise ValueError("wake_after_min 須在 1～10080 分鐘（7 天）之間")
        return (now + timedelta(minutes=mins)).replace(second=0, microsecond=0)
    if wake_at:
        minutes = _parse_hhmm(str(wake_at))
        if minutes is None:
            raise ValueError("wake_at 格式須為 HH:MM（例 08:00）")
        target = now.replace(hour=minutes // 60, minute=minutes % 60, second=0, microsecond=0)
        if target <= now + timedelta(minutes=1):
            target += timedelta(days=1)
        return target
    raise ValueError("請提供 wake_after_min 或 wake_at")


# ---------------------------------------------------------------- Windows tasks


def _ps_quote(text: str) -> str:
    return "'" + str(text).replace("'", "''") + "'"


def _powershell(script: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(  # noqa: S603
        ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def wake_action_command(minutes: int, reason: str) -> tuple[str, str]:
    """(Execute, Argument) for a scheduled wake: this app in --keep-awake mode."""
    args = f"--keep-awake {int(minutes)} --wake-reason {reason}"
    if is_frozen():
        return sys.executable, args
    portable = ROOT / "runtime" / "python" / "python.exe"
    python = str(portable) if portable.is_file() else sys.executable
    return python, f'"{ROOT / "demo_app.py"}" {args}'


def _ps_action(minutes: int, reason: str) -> str:
    exe, args = wake_action_command(minutes, reason)
    return (
        f"$action = New-ScheduledTaskAction -Execute {_ps_quote(exe)} "
        f"-Argument {_ps_quote(args)} -WorkingDirectory {_ps_quote(str(ROOT))}"
    )


_PS_SETTINGS = (
    "$settings = New-ScheduledTaskSettingsSet -WakeToRun -AllowStartIfOnBatteries "
    "-DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 12)"
)


def _task_name(rule: WakeRule, index: int) -> str:
    t = (rule.time or "00:00").replace(":", "")
    days = rule.days or list(range(7))
    return f"{TASK_PREFIX}{index}_{t}_{''.join(str(d) for d in days)}"


_PS_DOW = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")


def _powershell_days(days: list[int]) -> str:
    if not days:
        days = list(range(7))
    names = [_PS_DOW[d] for d in sorted(set(days)) if 0 <= d <= 6]
    return ",".join(names) if names else "Monday"


def sync_wake_tasks(schedule: HostSchedule | None = None) -> tuple[bool, str]:
    """Register or remove weekly Windows wake tasks. Returns (ok, message)."""
    if sys.platform != "win32":
        return False, "非 Windows，略過定時喚醒"
    schedule = schedule or load_schedule()

    remove_ps = (
        f"Get-ScheduledTask -TaskName '{TASK_PREFIX}*' -ErrorAction SilentlyContinue | "
        "Unregister-ScheduledTask -Confirm:$false -ErrorAction SilentlyContinue"
    )
    _powershell(remove_ps)

    if not schedule.enabled or not schedule.wake_at:
        _enable_rtc_wake()
        return True, "已清除每週定時喚醒工作"

    errors: list[str] = []
    for i, rule in enumerate(schedule.wake_at):
        if _parse_hhmm(rule.time) is None:
            errors.append(f"wake_at[{i}] 時間格式錯誤：{rule.time!r}")
            continue
        name = _task_name(rule, i)
        hh, mm = rule.time.split(":", 1)
        dow = _powershell_days(rule.days)
        ps = f"""
{_ps_action(schedule.stay_awake_minutes, "weekly")}
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek {dow} -At {hh}:{mm}
{_PS_SETTINGS}
Register-ScheduledTask -TaskName {_ps_quote(name)} -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
"""
        r = _powershell(ps)
        if r.returncode != 0:
            err = (r.stderr or r.stdout or "").strip()
            errors.append(f"{name}: {err[:200]}")

    _enable_rtc_wake()
    if errors:
        return False, "；".join(errors)
    return (
        True,
        f"已註冊 {len(schedule.wake_at)} 個每週喚醒（RTC；醒後保持 {schedule.stay_awake_minutes} 分鐘）",
    )


def schedule_one_time_wake(
    when: datetime,
    *,
    reason: str = "oneoff",
    stay_awake_minutes: int | None = None,
) -> tuple[bool, str]:
    """Register a single WakeToRun task at ``when``; replaces any earlier one-off wake."""
    if sys.platform != "win32":
        return False, "非 Windows，無法預約喚醒"
    reason = re.sub(r"[^A-Za-z0-9_-]", "", reason) or "oneoff"
    minutes = _clamp_minutes(
        stay_awake_minutes if stay_awake_minutes is not None else load_schedule().stay_awake_minutes
    )
    cancel_one_time_wake(quiet=True)
    name = f"{ONCE_TASK_PREFIX}{reason}"
    at = when.strftime("%Y-%m-%dT%H:%M:%S")
    ps = f"""
{_ps_action(minutes, reason)}
$trigger = New-ScheduledTaskTrigger -Once -At ([datetime]{_ps_quote(at)})
{_PS_SETTINGS}
Register-ScheduledTask -TaskName {_ps_quote(name)} -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
"""
    r = _powershell(ps)
    _enable_rtc_wake()
    if r.returncode != 0:
        err = (r.stderr or r.stdout or "").strip()
        return False, f"預約喚醒失敗：{err[:300]}"
    _write_json(
        PENDING_WAKE_FILE,
        {"at": when.strftime("%Y-%m-%d %H:%M"), "reason": reason, "task": name, "stay_awake_minutes": minutes},
    )
    return True, f"已預約 {when.strftime('%m/%d %H:%M')} 喚醒（醒後保持 {minutes} 分鐘）"


def cancel_one_time_wake(*, quiet: bool = False) -> tuple[bool, str]:
    if sys.platform == "win32":
        _powershell(
            f"Get-ScheduledTask -TaskName '{ONCE_TASK_PREFIX}*' -ErrorAction SilentlyContinue | "
            "Unregister-ScheduledTask -Confirm:$false -ErrorAction SilentlyContinue"
        )
    had = PENDING_WAKE_FILE.is_file()
    PENDING_WAKE_FILE.unlink(missing_ok=True)
    if quiet:
        return True, ""
    return True, "已取消一次性喚醒" if had else "沒有待執行的一次性喚醒"


def _enable_rtc_wake() -> None:
    for flag in ("/SETACVALUEINDEX", "/SETDCVALUEINDEX"):
        subprocess.run(  # noqa: S603
            ["powercfg", flag, "SCHEME_CURRENT", "SUB_SLEEP", "RTCWAKE", "1"],
            capture_output=True,
        )
    subprocess.run(["powercfg", "/SETACTIVE", "SCHEME_CURRENT"], capture_output=True)  # noqa: S603


# ---------------------------------------------------------------- --keep-awake mode

ES_CONTINUOUS = 0x80000000
ES_SYSTEM_REQUIRED = 0x00000001


def run_keep_awake(minutes: int, reason: str = "scheduled") -> int:
    """Entry for the scheduled task: log the wake, hold the system awake, then release."""
    minutes = _clamp_minutes(minutes)
    record_wake(reason, minutes)
    if reason and reason != "weekly":
        # One-off tasks fired; drop the marker so status no longer shows it as pending.
        PENDING_WAKE_FILE.unlink(missing_ok=True)
        if sys.platform == "win32":
            _powershell(
                f"Get-ScheduledTask -TaskName {_ps_quote(ONCE_TASK_PREFIX + reason)} -ErrorAction SilentlyContinue | "
                "Unregister-ScheduledTask -Confirm:$false -ErrorAction SilentlyContinue"
            )
    print(f"[keep-awake] {reason}: 保持清醒 {minutes} 分鐘")
    if sys.platform != "win32":
        time.sleep(min(minutes, 1))
        return 0
    import ctypes

    kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
    kernel32.SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)
    try:
        deadline = time.time() + minutes * 60
        while time.time() < deadline:
            time.sleep(30)
            kernel32.SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)
    finally:
        kernel32.SetThreadExecutionState(ES_CONTINUOUS)
    return 0
