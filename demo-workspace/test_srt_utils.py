#!/usr/bin/env python3
import unittest

from srt_utils import merge_srt_parts, parse_srt, seconds_to_timestamp, timestamp_to_seconds


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


if __name__ == "__main__":
    unittest.main()
