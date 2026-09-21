"""Tests for assistant update version parsing."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import assistant_update as au


class AssistantUpdateTests(unittest.TestCase):
    def test_compare_semver(self) -> None:
        self.assertEqual(au.compare_semver("11.9.6", "11.9.7"), -1)
        self.assertEqual(au.compare_semver("11.9.7", "11.9.7"), 0)
        self.assertEqual(au.compare_semver("11.10.0", "11.9.9"), 1)

    def test_read_installed_version_from_version_txt(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "VERSION.txt").write_text(
                "Call Coach Assistant Windows v11.9.7 (installer)\nBuilt: now\n",
                encoding="utf-8",
            )
            self.assertEqual(au.read_installed_version(root), "11.9.7")

    def test_allowed_setup_url(self) -> None:
        ok = "https://github.com/Minoru1017/For-company-business-use/releases/download/assistant-v11.9.7-build.37/CallCoachAssistant-Setup.exe"
        self.assertTrue(au.is_allowed_setup_download_url(ok))
        self.assertFalse(au.is_allowed_setup_download_url("https://evil.example/setup.exe"))

    def test_check_for_update_no_update(self) -> None:
        release = {
            "tag_name": "assistant-v11.9.7-build.37",
            "name": "Call Coach Assistant Windows v11.9.7 (build 37)",
            "html_url": "https://github.com/x/y/releases/tag/t",
            "assets": [{"name": "CallCoachAssistant-Setup.exe", "browser_download_url": "https://github.com/Minoru1017/For-company-business-use/releases/download/t/CallCoachAssistant-Setup.exe"}],
        }
        with (
            tempfile.TemporaryDirectory() as tmp,
            mock.patch.object(au, "ROOT", Path(tmp)),
            mock.patch.object(au, "skip_update_check", return_value=False),
            mock.patch.object(au, "_fetch_latest_release", return_value=release),
            mock.patch.object(au, "read_installed_version", return_value="11.9.7"),
        ):
            info = au.check_for_update(force_refresh=True)
        self.assertTrue(info["ok"])
        self.assertFalse(info["update_available"])
        self.assertEqual(info["latest"], "11.9.7")


if __name__ == "__main__":
    unittest.main()
