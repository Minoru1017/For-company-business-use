"""GPU setup helpers (no real CUDA required in CI)."""
from __future__ import annotations

import os
import unittest
from unittest import mock

import demo_core


class GpuSetupTests(unittest.TestCase):
    def test_prefer_gpu_setup_from_env(self) -> None:
        with mock.patch.object(demo_core, "load_env", return_value={"CALL_COACH_DEFAULT_MODE": "local_gpu"}):
            self.assertTrue(demo_core.prefer_gpu_setup())
        with mock.patch.object(demo_core, "load_env", return_value={"CALL_COACH_PREFER_GPU": "1"}):
            self.assertTrue(demo_core.prefer_gpu_setup())
        with mock.patch.object(demo_core, "load_env", return_value={}):
            self.assertFalse(demo_core.prefer_gpu_setup())

    def test_gpu_setup_hint_cpu_torch(self) -> None:
        hint = demo_core.gpu_setup_hint(
            {"installed": True, "version": "2.5.0+cpu", "cuda_build": None},
            {"available": False},
        )
        self.assertIn("CPU 版 PyTorch", hint or "")

    def test_gpu_transcribe_batch_env(self) -> None:
        with mock.patch.dict(os.environ, {"CALL_COACH_GPU_BATCH": "4"}):
            self.assertEqual(demo_core.gpu_transcribe_batch(), 4)

    def test_run_full_setup_passes_gpu_when_preferred(self) -> None:
        with (
            mock.patch.object(demo_core, "prefer_gpu_setup", return_value=True),
            mock.patch.object(demo_core, "ffmpeg_exe", return_value="ffmpeg"),
            mock.patch.object(demo_core, "run_setup", return_value=0) as run_setup,
        ):
            code = demo_core.run_full_setup(log=lambda _m: None)
        self.assertEqual(code, 0)
        run_setup.assert_called_once()
        self.assertTrue(run_setup.call_args.kwargs.get("gpu"))


if __name__ == "__main__":
    unittest.main()
