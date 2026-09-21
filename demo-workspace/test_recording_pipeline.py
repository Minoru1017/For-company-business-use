"""Unit tests for shared-drive recording watcher helpers."""
from __future__ import annotations

import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

import demo_core
import recording_pipeline as rp


class RecordingPipelineTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self.root = Path(self._tmpdir.name)
        self.env_patch = mock.patch.object(demo_core, "ROOT", self.root)
        self.env_patch.start()
        rp.STATE_FILE = self.root / "output" / ".recording_pipeline_state.json"
        rp.PENDING_FILE = self.root / "output" / ".recording_pending.json"

    def tearDown(self) -> None:
        self.env_patch.stop()
        self._tmpdir.cleanup()

    def test_watch_requires_dir_and_flag(self) -> None:
        share = self.root / "share"
        share.mkdir()
        with mock.patch.object(
            demo_core,
            "load_env",
            return_value={"CALL_COACH_RECORDINGS_DIR": str(share), "CALL_COACH_RECORDINGS_WATCH": "0"},
        ):
            self.assertFalse(rp.watch_enabled())
        with mock.patch.object(
            demo_core,
            "load_env",
            return_value={"CALL_COACH_RECORDINGS_DIR": str(share), "CALL_COACH_RECORDINGS_WATCH": "1"},
        ):
            self.assertTrue(rp.watch_enabled())

    def test_mark_processed_and_pending(self) -> None:
        wav = self.root / "a.wav"
        wav.write_bytes(b"x" * 100)
        state = {"processed": {}}
        rp.mark_processed(wav, state)
        self.assertTrue(rp.already_processed(wav, state))
        rp.save_pending(wav=wav, srt_name="a.srt", duration_s=400.0, phone_hint="0912345678")
        pending = rp.load_pending()
        assert pending is not None
        self.assertEqual(pending["srt"], "a.srt")
        self.assertEqual(pending["phone_hint"], "0912345678")
        rp.clear_pending()
        self.assertIsNone(rp.load_pending())

    def test_is_likely_complete(self) -> None:
        wav = self.root / "fresh.wav"
        wav.write_bytes(b"abc")
        self.assertFalse(rp.is_likely_complete(wav, min_age_s=10.0))
        old = time.time() - 20
        os.utime(wav, (old, old))
        self.assertTrue(rp.is_likely_complete(wav, min_age_s=10.0))

    def test_phone_hint_from_name(self) -> None:
        self.assertEqual(rp.phone_hint_from_name("call_0912345678_2026.wav"), "0912345678")


if __name__ == "__main__":
    unittest.main()
