"""Remote sleep time windows + Windows scheduled wake (RTC) for the Hsinchu host agent."""
from __future__ import annotations

import json
import re
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
SCHEDULE_FILE = ROOT / "host_schedule.json"
EXAMPLE_FILE = ROOT / "host_schedule.example.json"
TASK_PREFIX = "CallCoachHostWake_"

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


@dataclass
class HostSchedule:
    enabled: bool = False
    remote_sleep_allowed: list[TimeWindow] = field(default_factory=list)
    wake_at: list[WakeRule] = field(default_factory=list)

    def remote_sleep_ok(self, when: datetime | None = None) -> bool:
        when = when or datetime.now()
        if not self.enabled:
            return True
        if not self.remote_sleep_allowed:
            return True
        return any(w.contains(when) for w in self.remote_sleep_allowed)

    def summary_lines(self) -> list[str]:
        if not self.enabled:
            return ["排程：未啟用（任何時間可遠端睡眠；無定時喚醒）"]
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
            lines.append("  定時喚醒：" + "；".join(parts))
        else:
            lines.append("  定時喚醒：（未設定）")
        now_ok = self.remote_sleep_ok()
        lines.append(f"  現在可否遠端睡眠：{'是' if now_ok else '否'}")
        return lines


def default_schedule_dict() -> dict:
    return {
        "enabled": False,
        "remote_sleep_allowed": [
            {"start": "22:00", "end": "06:00", "days": [0, 1, 2, 3, 4]},
        ],
        "wake_at": [{"time": "08:00", "days": [0, 1, 2, 3, 4]}],
    }


def load_schedule(path: Path | None = None) -> HostSchedule:
    path = path or SCHEDULE_FILE
    if not path.is_file():
        return HostSchedule(enabled=False)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
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
    return HostSchedule(enabled=enabled, remote_sleep_allowed=windows, wake_at=wakes)


def ensure_example_file() -> None:
    if EXAMPLE_FILE.is_file():
        return
    EXAMPLE_FILE.write_text(
        json.dumps(default_schedule_dict(), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def schedule_status_dict(schedule: HostSchedule | None = None) -> dict:
    schedule = schedule or load_schedule()
    return {
        "enabled": schedule.enabled,
        "remote_sleep_allowed_now": schedule.remote_sleep_ok(),
        "summary": schedule.summary_lines(),
    }


def _powershell(script: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(  # noqa: S603
        ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
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
    """Register or remove Windows scheduled wake tasks. Returns (ok, message)."""
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
        return True, "已清除 Call Coach 定時喚醒工作"

    errors: list[str] = []
    for i, rule in enumerate(schedule.wake_at):
        if _parse_hhmm(rule.time) is None:
            errors.append(f"wake_at[{i}] 時間格式錯誤：{rule.time!r}")
            continue
        name = _task_name(rule, i)
        hh, mm = rule.time.split(":", 1)
        dow = _powershell_days(rule.days)
        ps = f"""
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument '/c rem CallCoach scheduled wake'
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek {dow} -At {hh}:{mm}
$settings = New-ScheduledTaskSettingsSet -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName '{name}' -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
"""
        r = _powershell(ps)
        if r.returncode != 0:
            err = (r.stderr or r.stdout or "").strip()
            errors.append(f"{name}: {err[:200]}")

    _enable_rtc_wake()
    if errors:
        return False, "；".join(errors)
    return True, f"已註冊 {len(schedule.wake_at)} 個定時喚醒（睡眠狀態下由 Windows RTC 喚醒，非 WoL）"


def _enable_rtc_wake() -> None:
    subprocess.run(  # noqa: S603
        ["powercfg", "/SETACVALUEINDEX", "SCHEME_CURRENT", "SUB_SLEEP", "RTCWAKE", "1"],
        capture_output=True,
    )
    subprocess.run(  # noqa: S603
        ["powercfg", "/SETDCVALUEINDEX", "SCHEME_CURRENT", "SUB_SLEEP", "RTCWAKE", "1"],
        capture_output=True,
    )
    subprocess.run(["powercfg", "/SETACTIVE", "SCHEME_CURRENT"], capture_output=True)  # noqa: S603
