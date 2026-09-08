#!/usr/bin/env python3
import unittest

from srt_utils import merge_srt_parts, parse_srt, seconds_to_timestamp, timestamp_to_seconds
from transcribe_parallel import chunk_count_for_duration, max_parallel_workers


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
        self.assertEqual(chunk_count_for_duration(45 * 60), 2)
        self.assertEqual(chunk_count_for_duration(75 * 60), 3)
        self.assertEqual(chunk_count_for_duration(110 * 60), 4)
        self.assertEqual(chunk_count_for_duration(150 * 60), 5)

    def test_parallel_cap(self):
        self.assertEqual(max_parallel_workers(5), 3)
        self.assertEqual(max_parallel_workers(2), 2)


if __name__ == "__main__":
    unittest.main()
