#!/usr/bin/env python3
import unittest

from azure_transcribe import segments_to_srt, ticks_to_seconds
from transcribe_modes import (
    MODE_AZURE,
    MODE_FAST,
    MODE_STANDARD,
    model_for_mode,
    normalize_mode,
    validate_transcribe_request,
)


class TranscribeModesTest(unittest.TestCase):
    def test_normalize_mode(self):
        self.assertEqual(normalize_mode("fast"), MODE_FAST)
        self.assertEqual(normalize_mode("unknown"), MODE_STANDARD)

    def test_model_for_mode(self):
        self.assertEqual(model_for_mode(MODE_FAST), "small")
        self.assertEqual(model_for_mode(MODE_STANDARD), "medium")

    def test_validate_azure_consent(self):
        self.assertIsNotNone(validate_transcribe_request(MODE_AZURE, False, True))
        self.assertIsNone(validate_transcribe_request(MODE_AZURE, True, True))
        self.assertIsNotNone(validate_transcribe_request(MODE_AZURE, True, False))


class AzureSrtTest(unittest.TestCase):
    def test_segments_to_srt(self):
        srt = segments_to_srt(
            [
                {
                    "speaker": "Guest-1",
                    "text": "你好",
                    "offset": 10_000_000,
                    "duration": 20_000_000,
                },
                {
                    "speaker": "Guest-2",
                    "text": "您好",
                    "offset": 40_000_000,
                    "duration": 15_000_000,
                },
            ]
        )
        self.assertIn("[SPEAKER_00] 你好", srt)
        self.assertIn("[SPEAKER_01] 您好", srt)
        self.assertIn("00:00:01,000 --> 00:00:03,000", srt)

    def test_ticks_to_seconds(self):
        self.assertEqual(ticks_to_seconds(10_000_000), 1.0)


if __name__ == "__main__":
    unittest.main()
