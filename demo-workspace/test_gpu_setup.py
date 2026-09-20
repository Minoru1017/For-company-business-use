"""GPU setup helpers (no real CUDA required in CI)."""
from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
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

    def test_blackwell_defaults_to_int8_compute(self) -> None:
        gpu = {"available": True, "name": "NVIDIA GeForce RTX 5070"}
        self.assertTrue(demo_core.is_blackwell_gpu(gpu))
        self.assertEqual(demo_core.gpu_whisper_compute_type(gpu), "int8")

    def test_whisperx_failure_hints_oom(self) -> None:
        hints = demo_core.whisperx_failure_hints(["CUDA out of memory at line 1"])
        self.assertTrue(any("顯存" in h for h in hints))

    def test_ensure_cuda_torch_builds_pip_command(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            py = Path(tmp) / "python.exe"
            py.write_text("", encoding="utf-8")
            with mock.patch.object(demo_core, "VENV_PY", py):
                with mock.patch.object(demo_core, "run_command", return_value=0) as run_cmd:
                    code = demo_core.ensure_cuda_torch(log=lambda _m: None, force=True)
        self.assertEqual(code, 0)
        args = run_cmd.call_args[0][0]
        self.assertIn("--force-reinstall", args)
        self.assertIn("torchvision", args)
        self.assertIn(demo_core.TORCH_CUDA_INDEX, args)

    def test_whisperx_failure_hints_torchvision_mismatch(self) -> None:
        hints = demo_core.whisperx_failure_hints(["RuntimeError: operator torchvision::nms does not exist"])
        self.assertTrue(any("torchvision" in h for h in hints))

    def test_whisperx_env_broken_detects_import_error(self) -> None:
        self.assertTrue(
            demo_core.whisperx_env_broken(["ModuleNotFoundError: Could not import module 'Wav2Vec2ForCTC'"])
        )

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
