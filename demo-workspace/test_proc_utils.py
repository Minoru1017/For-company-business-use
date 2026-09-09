#!/usr/bin/env python3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import proc_utils


class NoWindowTest(unittest.TestCase):
    def test_non_windows_has_no_extra_kwargs(self):
        if sys.platform == "win32":
            self.skipTest("posix-only assertion")
        self.assertEqual(proc_utils.no_window_kwargs(), {})

    def test_quiet_run_passes_through(self):
        proc = proc_utils.quiet_run([sys.executable, "-c", "print('hi')"], capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0)
        self.assertEqual(proc.stdout.strip(), "hi")


class FasterWhisperCheckTest(unittest.TestCase):
    def test_uses_filesystem_not_subprocess(self):
        import demo_core

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            venv_py = root / ".venv" / "Scripts" / "python.exe"
            venv_py.parent.mkdir(parents=True)
            venv_py.write_bytes(b"")
            with patch.object(demo_core, "ROOT", root), patch.object(demo_core, "VENV_PY", venv_py), patch(
                "demo_core.subprocess.run"
            ) as run, patch("demo_core.quiet_run") as qrun:
                self.assertFalse(demo_core.faster_whisper_installed())
                (root / ".venv" / "Lib" / "site-packages" / "faster_whisper").mkdir(parents=True)
                self.assertTrue(demo_core.faster_whisper_installed())
                run.assert_not_called()
                qrun.assert_not_called()


if __name__ == "__main__":
    unittest.main()
