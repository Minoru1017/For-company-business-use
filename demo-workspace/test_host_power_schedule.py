"""Tests for host power schedule windows."""
from __future__ import annotations

import unittest
from datetime import datetime

from host_power_schedule import HostSchedule, TimeWindow, load_schedule
from pathlib import Path
import json
import tempfile


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


class TestHostSchedule(unittest.TestCase):
    def test_disabled_allows_sleep(self) -> None:
        s = HostSchedule(enabled=False, remote_sleep_allowed=[TimeWindow("22:00", "06:00", [0])])
        self.assertTrue(s.remote_sleep_ok(datetime(2026, 9, 22, 12, 0)))

    def test_load_json(self) -> None:
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


if __name__ == "__main__":
    unittest.main()
