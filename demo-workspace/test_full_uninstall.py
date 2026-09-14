#!/usr/bin/env python3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import demo_core


class FullUninstallTest(unittest.TestCase):
    def test_windows_uninstaller_exe_only_when_frozen(self):
        with mock.patch.object(demo_core, "is_frozen", return_value=False):
            self.assertIsNone(demo_core.windows_uninstaller_exe())
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with mock.patch.object(demo_core, "ROOT", root), mock.patch.object(demo_core, "is_frozen", return_value=True):
                self.assertIsNone(demo_core.windows_uninstaller_exe())
                (root / "unins000.exe").write_bytes(b"stub")
                self.assertEqual(demo_core.windows_uninstaller_exe(), root / "unins000.exe")

    def test_run_full_uninstall_cleans_worker_and_optional_logs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / ".venv").mkdir()
            (root / "worker").mkdir()
            (root / "logs").mkdir()
            (root / "logs" / "a.log").write_text("x", encoding="utf-8")
            logs: list[str] = []
            with (
                mock.patch.object(demo_core, "ROOT", root),
                mock.patch.object(demo_core, "is_frozen", return_value=False),
                mock.patch.object(demo_core, "run_uninstall", return_value=0) as uninstall,
            ):
                code = demo_core.run_full_uninstall(log=logs.append, remove_models=False, remove_logs=True, launch_setup_uninstaller=False)
            self.assertEqual(code, 0)
            uninstall.assert_called_once()
            self.assertFalse((root / "worker").exists())
            self.assertTrue((root / "logs").is_dir())
            self.assertEqual(list((root / "logs").iterdir()), [])


if __name__ == "__main__":
    unittest.main()
