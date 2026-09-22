"""Tests for host power schedule windows, wake resolution and backward compatibility."""
from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path

import host_power_schedule as hps
from host_power_schedule import HostSchedule, TimeWindow, WakeRule, load_schedule


class TestTimeWindow(unittest.TestCase):
    def test_same_day_window(self) -> None:
        w = TimeWindow(start="09:00", end="17:00", days=[0])
        self.assertTrue(w.contains(datetime(2026, 9, 21, 10, 0)))  # Mon
        self.assertFalse(w.contains(datetime(2026, 9, 21, 8, 0)))
        self.assertFalse(w.contains(datetime(2026, 9, 22, 10, 0)))  # Tue

    def test_overnight_window(self) -> None:
        w = TimeWindow(start="22:00", end="06:00", days=[0])
        self.assertTrue(w.contains(datetime(2026, 9, 21, 23, 0)))  # Mon night
        self.assertTrue(w.contains(datetime(2026, 9, 22, 5, 30)))  # Tue early → Mon rule
        self.assertFalse(w.contains(datetime(2026, 9, 22, 12, 0)))


class TestWakeRule(unittest.TestCase):
    def test_next_occurrence_same_day_and_skip_weekend(self) -> None:
        r = WakeRule(time="08:00", days=[0, 1, 2, 3, 4])
        fri_morning = datetime(2026, 9, 25, 7, 0)  # Fri
        self.assertEqual(r.next_occurrence(fri_morning), datetime(2026, 9, 25, 8, 0))
        fri_noon = datetime(2026, 9, 25, 12, 0)
        self.assertEqual(r.next_occurrence(fri_noon), datetime(2026, 9, 28, 8, 0))  # Mon


class TestHostSchedule(unittest.TestCase):
    def test_disabled_allows_sleep(self) -> None:
        s = HostSchedule(enabled=False, remote_sleep_allowed=[TimeWindow("22:00", "06:00", [0])])
        self.assertTrue(s.remote_sleep_ok(datetime(2026, 9, 22, 12, 0)))

    def test_load_json_old_format_without_stay_awake(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "host_schedule.json"
            p.write_text(
                json.dumps(
                    {
                        "enabled": True,
                        "remote_sleep_allowed": [{"start": "22:00", "end": "06:00", "days": [0]}],
                        "wake_at": [{"time": "08:00", "days": [0, 1]}],
                    }
                ),
                encoding="utf-8",
            )
            s = load_schedule(p)
            self.assertTrue(s.enabled)
            self.assertEqual(len(s.wake_at), 1)
            self.assertEqual(s.stay_awake_minutes, hps.DEFAULT_STAY_AWAKE_MIN)

    def test_stay_awake_clamped(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "host_schedule.json"
            p.write_text(json.dumps({"enabled": True, "stay_awake_minutes": 99999}), encoding="utf-8")
            self.assertEqual(load_schedule(p).stay_awake_minutes, hps.MAX_STAY_AWAKE_MIN)
            p.write_text(json.dumps({"enabled": True, "stay_awake_minutes": "abc"}), encoding="utf-8")
            self.assertEqual(load_schedule(p).stay_awake_minutes, hps.DEFAULT_STAY_AWAKE_MIN)


class TestResolveWake(unittest.TestCase):
    def setUp(self) -> None:
        self.now = datetime(2026, 9, 22, 21, 30)

    def test_after_minutes(self) -> None:
        self.assertEqual(
            hps.resolve_wake_datetime(wake_after_min=90, now=self.now),
            self.now + timedelta(minutes=90),
        )

    def test_wake_at_tomorrow_when_past(self) -> None:
        self.assertEqual(
            hps.resolve_wake_datetime(wake_at="08:00", now=self.now),
            datetime(2026, 9, 23, 8, 0),
        )

    def test_wake_at_today_when_future(self) -> None:
        self.assertEqual(
            hps.resolve_wake_datetime(wake_at="23:00", now=self.now),
            datetime(2026, 9, 22, 23, 0),
        )

    def test_invalid(self) -> None:
        with self.assertRaises(ValueError):
            hps.resolve_wake_datetime(wake_at="25:00", now=self.now)
        with self.assertRaises(ValueError):
            hps.resolve_wake_datetime(wake_after_min=0, now=self.now)
        with self.assertRaises(ValueError):
            hps.resolve_wake_datetime(now=self.now)


class TestWakeAction(unittest.TestCase):
    def test_action_contains_keep_awake_flag(self) -> None:
        exe, args = hps.wake_action_command(45, "weekly")
        self.assertTrue(exe)
        self.assertIn("--keep-awake 45", args)
        self.assertIn("--wake-reason weekly", args)

    def test_ps_quote_escapes(self) -> None:
        self.assertEqual(hps._ps_quote("C:\\a'b"), "'C:\\a''b'")


if __name__ == "__main__":
    unittest.main()
