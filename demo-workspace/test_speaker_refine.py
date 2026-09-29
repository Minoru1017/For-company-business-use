#!/usr/bin/env python3
import json
import tempfile
import unittest
from pathlib import Path

from speaker_refine import (
    attach_spacing,
    EXTRA_SUFFIXES,
    Word,
    cues_to_srt,
    cut_by_speaker,
    join_words,
    refine_speaker_srt,
)
from srt_utils import parse_srt


def _chars(text: str, start: float, speaker: str | None, step: float = 0.2, *, skip_punct=True) -> list[dict]:
    """WhisperX zh output: one entry per character; punctuation has no timing/speaker."""
    words = []
    t = start
    for ch in text:
        if skip_punct and ch in "，。？！、":
            words.append({"word": ch})
            continue
        w = {"word": ch, "start": round(t, 3), "end": round(t + step, 3), "score": 0.9}
        if speaker:
            w["speaker"] = speaker
        words.append(w)
        t += step
    return words


def _segment(parts: list[tuple[str, str]], start: float, speaker_majority: str) -> dict:
    """One Whisper segment whose words alternate speakers as given by parts."""
    words = []
    t = start
    for text, spk in parts:
        ws = _chars(text, t, spk)
        words.extend(ws)
        t += 0.2 * sum(1 for c in text if c not in "，。？！、")
    return {
        "start": start,
        "end": round(t, 3),
        "text": "".join(p[0] for p in parts),
        "speaker": speaker_majority,
        "words": words,
    }


class CutBySpeakerTest(unittest.TestCase):
    def test_splits_segment_at_speaker_change(self):
        seg = _segment(
            [
                ("OK那我這邊先跟你說明一下，", "SPEAKER_00"),
                ("好啊你說。", "SPEAKER_01"),
                ("我們八點半這樣方便嗎？", "SPEAKER_00"),
            ],
            start=10.0,
            speaker_majority="SPEAKER_00",
        )
        cues = cut_by_speaker({"segments": [seg]})
        self.assertEqual([c.speaker for c in cues], ["SPEAKER_00", "SPEAKER_01", "SPEAKER_00"])
        self.assertEqual(cues[0].text, "OK那我這邊先跟你說明一下，")
        self.assertEqual(cues[1].text, "好啊你說。")
        self.assertEqual(cues[2].text, "我們八點半這樣方便嗎？")
        self.assertAlmostEqual(cues[0].start, 10.0)
        self.assertLessEqual(cues[0].end, cues[1].start)
        self.assertLessEqual(cues[1].end, cues[2].start)

    def test_absorbs_single_character_jitter(self):
        seg = _segment(
            [("我想說那個時間", "SPEAKER_00"), ("會", "SPEAKER_01"), ("不會太晚了一點", "SPEAKER_00")],
            start=0.0,
            speaker_majority="SPEAKER_00",
        )
        cues = cut_by_speaker({"segments": [seg]})
        self.assertEqual(len(cues), 1)
        self.assertEqual(cues[0].text, "我想說那個時間會不會太晚了一點")
        self.assertEqual(cues[0].speaker, "SPEAKER_00")

    def test_keeps_real_short_interjection_when_long_enough(self):
        # "好的好的" (4 chars, 0.8 s) from the customer is a genuine turn, keep it.
        seg = _segment(
            [("那我把連結傳給你", "SPEAKER_00"), ("好的好的", "SPEAKER_01"), ("那就這樣", "SPEAKER_00")],
            start=0.0,
            speaker_majority="SPEAKER_00",
        )
        cues = cut_by_speaker({"segments": [seg]})
        self.assertEqual([c.speaker for c in cues], ["SPEAKER_00", "SPEAKER_01", "SPEAKER_00"])

    def test_punctuation_without_timing_stays_with_previous_speaker(self):
        seg = _segment([("你好。", "SPEAKER_00"), ("你好，請說。", "SPEAKER_01")], start=0.0, speaker_majority="SPEAKER_01")
        cues = cut_by_speaker({"segments": [seg]})
        self.assertEqual(len(cues), 2)
        self.assertEqual(cues[0].text, "你好。")
        self.assertEqual(cues[1].text, "你好，請說。")

    def test_segment_without_words_falls_back_to_segment(self):
        result = {
            "segments": [
                {"start": 1.0, "end": 2.0, "text": "喂", "speaker": "SPEAKER_01"},
                _segment([("是的我這邊是", "SPEAKER_00")], start=2.0, speaker_majority="SPEAKER_00"),
            ]
        }
        cues = cut_by_speaker(result)
        self.assertEqual(len(cues), 2)
        self.assertEqual((cues[0].speaker, cues[0].text), ("SPEAKER_01", "喂"))

    def test_returns_none_without_any_word_speaker(self):
        seg = _segment([("沒有分軌的內容", None)], start=0.0, speaker_majority=None)
        seg["speaker"] = None
        self.assertIsNone(cut_by_speaker({"segments": [seg]}))
        self.assertIsNone(cut_by_speaker({}))
        self.assertIsNone(cut_by_speaker({"segments": []}))

    def test_spacing_recovered_from_segment_text(self):
        # zh word list is per character with whitespace dropped; segment text keeps it.
        chars = list("我用GoogleMeet開")
        words = [Word(c, i * 0.1, i * 0.1 + 0.1, "SPEAKER_00") for i, c in enumerate(chars)]
        attach_spacing(words, "我用 Google Meet 開")
        self.assertEqual(join_words(words), "我用 Google Meet 開")
        # "OK" is two single-character words with no space in the source text
        words = [Word(c, i * 0.1, i * 0.1 + 0.1, "SPEAKER_00") for i, c in enumerate("OK那我")]
        attach_spacing(words, "OK那我")
        self.assertEqual(join_words(words), "OK那我")

    def test_spacing_gives_up_on_mismatch_without_breaking(self):
        words = [Word(c, i * 0.1, i * 0.1 + 0.1, "SPEAKER_00") for i, c in enumerate("甲乙丙")]
        attach_spacing(words, "完全不同的文字")
        self.assertEqual(join_words(words), "甲乙丙")

    def test_segment_text_spacing_survives_speaker_split(self):
        seg = _segment([("我用Google Meet傳連結", "SPEAKER_00"), ("好OK", "SPEAKER_01")], start=0.0, speaker_majority="SPEAKER_00")
        seg["words"] = [w for w in seg["words"] if w["word"] != " "]
        seg["text"] = "我用 Google Meet 傳連結好 OK"
        cues = cut_by_speaker({"segments": [seg]})
        self.assertEqual([c.text for c in cues], ["我用 Google Meet 傳連結", "好 OK"])

    def test_srt_uses_whisperx_prefix(self):
        seg = _segment([("測試一下", "SPEAKER_00")], start=0.0, speaker_majority="SPEAKER_00")
        srt = cues_to_srt(cut_by_speaker({"segments": [seg]}))
        self.assertIn("[SPEAKER_00]: 測試一下", srt)
        cues = parse_srt(srt)
        self.assertEqual(len(cues), 1)


class RefineFileTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def _write_outputs(self, result: dict, stem: str = "call") -> Path:
        (self.dir / f"{stem}.json").write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
        srt = self.dir / f"{stem}.srt"
        srt.write_text("1\n00:00:10,000 --> 00:00:20,000\n[SPEAKER_00]: 原始整段\n", encoding="utf-8")
        for suf in EXTRA_SUFFIXES:
            if suf != ".json":
                (self.dir / f"{stem}{suf}").write_text("x", encoding="utf-8")
        return srt

    def test_rewrites_srt_and_cleans_extra_formats(self):
        seg = _segment([("業務講話", "SPEAKER_00"), ("客戶回答了什麼", "SPEAKER_01")], start=10.0, speaker_majority="SPEAKER_00")
        srt = self._write_outputs({"segments": [seg]})
        logs = []
        self.assertTrue(refine_speaker_srt(self.dir, "call", logs.append))
        cues = parse_srt(srt.read_text(encoding="utf-8"))
        self.assertEqual(len(cues), 2)
        self.assertTrue(cues[0].text.startswith("[SPEAKER_00]: 業務講話"))
        self.assertTrue(cues[1].text.startswith("[SPEAKER_01]: 客戶回答了什麼"))
        for suf in EXTRA_SUFFIXES:
            self.assertFalse((self.dir / f"call{suf}").exists(), suf)
        self.assertTrue(any("1 段 → 2 句" in m for m in logs))

    def test_keeps_original_srt_on_bad_json(self):
        srt = self._write_outputs({})
        (self.dir / "call.json").write_text("{not json", encoding="utf-8")
        self.assertFalse(refine_speaker_srt(self.dir, "call"))
        self.assertIn("原始整段", srt.read_text(encoding="utf-8"))
        self.assertFalse((self.dir / "call.json").exists())

    def test_keeps_original_when_no_diarization(self):
        seg = _segment([("沒有說話者", None)], start=10.0, speaker_majority=None)
        seg["speaker"] = None
        srt = self._write_outputs({"segments": [seg]})
        self.assertFalse(refine_speaker_srt(self.dir, "call"))
        self.assertIn("原始整段", srt.read_text(encoding="utf-8"))

    def test_missing_json_is_noop(self):
        (self.dir / "call.srt").write_text("1\n00:00:00,000 --> 00:00:01,000\nx\n", encoding="utf-8")
        self.assertFalse(refine_speaker_srt(self.dir, "call"))


if __name__ == "__main__":
    unittest.main()
