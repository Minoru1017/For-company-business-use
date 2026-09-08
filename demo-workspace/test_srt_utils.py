#!/usr/bin/env python3
import unittest

from srt_utils import merge_srt_parts, parse_srt, seconds_to_timestamp, timestamp_to_seconds
from transcribe_parallel import (
    chunk_count_for_duration,
    estimate_transcribe_minutes,
    max_parallel_workers,
)


class SrtUtilsTest(unittest.TestCase):
    def test_timestamp_roundtrip(self):
        self.assertEqual(timestamp_to_seconds(0, 1, 2, 500), 62.5)
        self.assertEqual(seconds_to_timestamp(62.5), "00:01:02,500")

    def test_merge_offsets(self):
        a = "1\n00:00:01,000 --> 00:00:02,000\n[SPEAKER_00] hi\n"
        b = "1\n00:00:01,000 --> 00:00:02,000\n[SPEAKER_01] yo\n"
        merged = merge_srt_parts([(a, 0.0), (b, 10.0)])
        cues = parse_srt(merged)
        self.assertEqual(len(cues), 2)
        self.assertAlmostEqual(cues[1].start, 11.0)


class ChunkPlanTest(unittest.TestCase):
    def test_chunk_count(self):
        self.assertEqual(chunk_count_for_duration(10 * 60), 1)
        self.assertEqual(chunk_count_for_duration(25 * 60), 2)
        self.assertEqual(chunk_count_for_duration(45 * 60), 3)
        self.assertEqual(chunk_count_for_duration(75 * 60), 4)
        self.assertEqual(chunk_count_for_duration(110 * 60), 5)
        self.assertEqual(chunk_count_for_duration(150 * 60), 5)

    def test_estimate_eta(self):
        low, high = estimate_transcribe_minutes(48 * 60, 3, 3)
        self.assertGreaterEqual(low, 10)
        self.assertGreater(high, low)

    def test_parallel_cap(self):
        self.assertEqual(max_parallel_workers(5), 3)
        self.assertEqual(max_parallel_workers(2), 2)

    def test_run_parallel_transcribe_defines_workers(self):
        from unittest.mock import MagicMock, patch
        from pathlib import Path
        import tempfile

        from transcribe_parallel import run_parallel_transcribe

        with tempfile.TemporaryDirectory() as tmp:
            wav = Path(tmp) / "demo.wav"
            wav.write_bytes(b"\x00" * 64)
            part_a = Path(tmp) / "chunk_000.wav"
            part_b = Path(tmp) / "chunk_001.wav"
            part_a.write_bytes(b"\x00" * 64)
            part_b.write_bytes(b"\x00" * 64)
            work = Path(tmp) / "work"
            out = Path(tmp) / "out"
            final = out / "demo.srt"
            logs: list[str] = []

            def fake_run_command(*_a, **_k):
                out_sub = _k.get("log")
                chunk_out = Path(_a[0][-1]) if _a else None
                return 0

            def fake_run_command2(cmd, log=None, **_k):
                out_dir = Path(cmd[-1])
                out_dir.mkdir(parents=True, exist_ok=True)
                (out_dir / "part.srt").write_text(
                    "1\n00:00:01,000 --> 00:00:02,000\n[SPEAKER_00] hi\n",
                    encoding="utf-8",
                )
                return 0

            with patch(
                "transcribe_parallel.split_audio_chunks",
                return_value=[(part_a, 0.0), (part_b, 1440.0)],
            ):
                code = run_parallel_transcribe(
                    audio=wav,
                    chunk_count=2,
                    ffmpeg="ffmpeg",
                    work_root=work,
                    output_dir=out,
                    final_srt=final,
                    whisperx_cmd=["whisperx"],
                    model="medium",
                    default_threads=8,
                    batch=8,
                    env_vars={},
                    run_command=fake_run_command2,
                    log=logs.append,
                    hooks=MagicMock(),
                    cancel_check=lambda: False,
                )
            self.assertEqual(code, 0)
            self.assertTrue(any("最多 2 段同時跑" in line for line in logs))
            self.assertTrue(final.is_file())


if __name__ == "__main__":
    unittest.main()
