#!/usr/bin/env python3
import io
import json
import sys
import tempfile
import threading
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

from azure_transcribe import (
    CANCEL_EXIT,
    encode_multipart,
    fast_transcription_url,
    phrases_to_srt,
    region_supports_fast,
    run_azure_transcribe,
    segments_to_srt,
    ticks_to_seconds,
)
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


class AzureFastRestTest(unittest.TestCase):
    def test_region_support_and_url(self):
        self.assertTrue(region_supports_fast("SouthEastAsia"))
        self.assertFalse(region_supports_fast("eastasia"))
        self.assertEqual(
            fast_transcription_url("japaneast"),
            "https://japaneast.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2024-11-15",
        )
        self.assertTrue(fast_transcription_url("x", "https://my.private.endpoint/").startswith("https://my.private.endpoint/speechtotext"))
        with self.assertRaises(ValueError):
            fast_transcription_url("x", "http://plain")

    def test_multipart_encoding(self):
        body, ctype = encode_multipart({"definition": "{}"}, "audio", "a.wav", b"RIFF")
        boundary = ctype.split("boundary=")[1]
        self.assertIn(f"--{boundary}".encode(), body)
        self.assertIn(b'name="definition"', body)
        self.assertIn(b'filename="a.wav"', body)
        self.assertTrue(body.endswith(f"\r\n--{boundary}--\r\n".encode()))

    def test_phrases_to_srt(self):
        srt = phrases_to_srt(
            [
                {"offsetMilliseconds": 5000, "durationMilliseconds": 1200, "speaker": 2, "text": "您好"},
                {"offsetMilliseconds": 1000, "durationMilliseconds": 2000, "speaker": 1, "text": "你好"},
                {"offsetMilliseconds": 9000, "durationMilliseconds": 100, "speaker": 1, "text": "  "},
            ]
        )
        self.assertTrue(srt.startswith("1\n00:00:01,000 --> 00:00:03,000\n[SPEAKER_00] 你好"))
        self.assertIn("2\n00:00:05,000 --> 00:00:06,200\n[SPEAKER_01] 您好", srt)
        self.assertNotIn("3\n", srt)

    def _run(self, audio_dir: Path, urlopen, **kwargs):
        wav = audio_dir / "demo.wav"
        wav.write_bytes(b"RIFF" * 100)
        out = audio_dir / "demo.srt"
        logs: list[str] = []
        with mock.patch("azure_transcribe.urllib.request.urlopen", urlopen):
            code = run_azure_transcribe(
                wav,
                out,
                speech_key="k",
                speech_region=kwargs.pop("region", "southeastasia"),
                log=logs.append,
                cancel_check=kwargs.pop("cancel_check", lambda: False),
                **kwargs,
            )
        return code, out, logs

    def test_success_writes_srt(self):
        payload = json.dumps(
            {
                "durationMilliseconds": 61000,
                "phrases": [{"offsetMilliseconds": 0, "durationMilliseconds": 900, "speaker": 1, "text": "測試"}],
            }
        ).encode()
        with tempfile.TemporaryDirectory() as d:
            code, out, logs = self._run(Path(d), lambda req, timeout: _FakeResponse(200, payload))
            self.assertEqual(code, 0)
            self.assertIn("[SPEAKER_00] 測試", out.read_text(encoding="utf-8"))
            self.assertTrue(any("完成" in line for line in logs))

    def test_auth_error(self):
        def urlopen(req, timeout):
            raise urllib.error.HTTPError(req.full_url, 401, "Unauthorized", {}, io.BytesIO(b'{"error":{"code":"401"}}'))

        with tempfile.TemporaryDirectory() as d:
            code, out, logs = self._run(Path(d), urlopen)
            self.assertEqual(code, 1)
            self.assertFalse(out.exists())
            self.assertTrue(any("金鑰無效" in line for line in logs))

    def test_unsupported_region_without_sdk(self):
        def urlopen(req, timeout):
            raise urllib.error.HTTPError(req.full_url, 404, "Not Found", {}, io.BytesIO(b"{}"))

        with tempfile.TemporaryDirectory() as d, mock.patch.dict(sys.modules, {"azure": None, "azure.cognitiveservices.speech": None}):
            code, _out, logs = self._run(Path(d), urlopen, region="eastasia")
            self.assertEqual(code, 1)
            self.assertTrue(any("未列在" in line for line in logs))
            self.assertTrue(any("southeastasia" in line for line in logs))

    def test_invalid_region_string(self):
        with tempfile.TemporaryDirectory() as d:
            code, _out, logs = self._run(Path(d), lambda req, timeout: _FakeResponse(200, b"{}"), region="east asia")
            self.assertEqual(code, 1)
            self.assertTrue(any("格式不正確" in line for line in logs))

    def test_cancel_while_waiting(self):
        gate = threading.Event()

        def urlopen(req, timeout):
            gate.wait(5)
            return _FakeResponse(200, b'{"phrases": []}')

        with tempfile.TemporaryDirectory() as d:
            code, out, _logs = self._run(Path(d), urlopen, cancel_check=lambda: True)
            gate.set()
            self.assertEqual(code, CANCEL_EXIT)
            self.assertFalse(out.exists())


class _FakeResponse(io.BytesIO):
    def __init__(self, status: int, body: bytes):
        super().__init__(body)
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
        return False


if __name__ == "__main__":
    unittest.main()
