#!/usr/bin/env python3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import demo_core


class FindMp4Test(unittest.TestCase):
    def test_case_insensitive_on_windows(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            inp = root / "input"
            inp.mkdir()
            (inp / "DEMO.mp4").write_bytes(b"x")
            with mock.patch.object(demo_core, "ROOT", root), mock.patch.object(demo_core.sys, "platform", "win32"):
                p = demo_core.find_mp4("demo.mp4")
                self.assertEqual(p.name, "DEMO.mp4")

    def test_prefers_demo_stem_case_insensitive(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            inp = root / "input"
            inp.mkdir()
            (inp / "other.mp4").write_bytes(b"x")
            (inp / "DEMO.mp4").write_bytes(b"y")
            with mock.patch.object(demo_core, "ROOT", root), mock.patch.object(demo_core.sys, "platform", "win32"):
                p = demo_core.find_mp4()
                self.assertEqual(p.name, "DEMO.mp4")


if __name__ == "__main__":
    unittest.main()
