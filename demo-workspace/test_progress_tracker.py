#!/usr/bin/env python3
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import progress_tracker as pt
from progress_tracker import PROGRESS_PREFIX, ProgressTracker, enrich, estimate_azure_minutes, parse_line


class FakeClock:
    def __init__(self, t: float = 1000.0) -> None:
        self.t = t

    def __call__(self) -> float:
        return self.t

    def tick(self, seconds: float) -> None:
        self.t += seconds


def make(mode: str = "standard", plan: str | None = None):
    lines: list[str] = []
    clock = FakeClock()
    tracker = ProgressTracker(lines.append, mode=mode, plan=plan, clock=clock)
    return tracker, lines, clock


def last_progress(lines: list[str]) -> dict:
    for line in reversed(lines):
        data = parse_line(line)
        if data is not None:
            return data
    raise AssertionError("no progress line emitted")


class ParseLineTest(unittest.TestCase):
    def test_parse_line_roundtrip(self):
        self.assertIsNone(parse_line("plain log"))
        self.assertIsNone(parse_line(PROGRESS_PREFIX + "not json"))
        self.assertEqual(parse_line(PROGRESS_PREFIX + '{"a": 1}'), {"a": 1})

    def test_estimate_azure_minutes(self):
        low, high = estimate_azure_minutes(48 * 60)
        self.assertGreaterEqual(low, 2)
        self.assertGreater(high, low)
        self.assertEqual(estimate_azure_minutes(0)[0], 1)


class TrackerEmitTest(unittest.TestCase):
    def test_plan_and_phase_emit_only_prefixed_lines(self):
        tracker, lines, _ = make(plan="local")
        tracker.phase("extract", "ffmpeg")
        self.assertTrue(lines)
        self.assertTrue(all(line.startswith(PROGRESS_PREFIX) for line in lines))
        data = last_progress(lines)
        self.assertEqual([p["key"] for p in data["phases"]], ["extract", "transcribe", "save"])
        self.assertEqual(data["phase_index"], 0)
        self.assertEqual(data["detail"], "ffmpeg")

    def test_skip_phase_rebalances_weights(self):
        tracker, lines, _ = make(plan="local")
        tracker.skip_phase("extract")
        data = last_progress(lines)
        self.assertEqual([p["key"] for p in data["phases"]], ["transcribe", "save"])
        self.assertEqual(sum(p["weight"] for p in data["phases"]), 100)

    def test_ffmpeg_lines_consumed_and_percent_parsed(self):
        tracker, lines, clock = make(plan="azure")
        tracker.set_duration(600)
        tracker.phase("extract")
        forwarded: list[str] = []
        wrapped = tracker.wrap_ffmpeg_log(forwarded.append)
        wrapped("ffmpeg -y -i x.mp4 ...")
        wrapped("frame=0")
        clock.tick(1)
        wrapped("out_time=00:05:00.000000")
        wrapped("progress=continue")
        wrapped("[錯誤] something")
        self.assertEqual(forwarded, ["ffmpeg -y -i x.mp4 ...", "[錯誤] something"])
        self.assertAlmostEqual(last_progress(lines)["phase_percent"], 50.0)

    def test_whisperx_markers_and_progress(self):
        tracker, lines, clock = make(plan="local")
        tracker.phase("transcribe")
        forwarded: list[str] = []
        wrapped = tracker.wrap_whisperx_log(forwarded.append, 0)
        wrapped("Lightning automatically upgraded your loaded checkpoint")
        clock.tick(5)
        wrapped(">>Performing transcription...")
        clock.tick(5)
        wrapped("Progress: 50.00%...")
        data = last_progress(lines)
        part = data["parts"][0]
        self.assertEqual(part["step"], "transcribe")
        self.assertEqual(part["percent"], 50.0)
        self.assertEqual(len(forwarded), 3)
        clock.tick(5)
        wrapped(">>Performing alignment...")
        clock.tick(5)
        wrapped(">>Performing diarization...")
        self.assertEqual(last_progress(lines)["parts"][0]["step"], "diarize")
        self.assertIsNone(last_progress(lines)["parts"][0]["percent"])
        tracker.part_done(0)
        self.assertTrue(last_progress(lines)["parts"][0]["done"])

    def test_throttle_but_force_on_phase(self):
        tracker, lines, clock = make(plan="local")
        tracker.phase("transcribe")
        n = len(lines)
        tracker.set_percent(10)
        tracker.set_percent(11)
        self.assertEqual(len(lines), n)  # within the throttle window of the forced phase emit
        clock.tick(2)
        tracker.set_percent(13)
        self.assertEqual(len(lines), n + 1)
        self.assertEqual(last_progress(lines)["phase_percent"], 13.0)
        tracker.phase("save")  # phase changes are never throttled
        self.assertEqual(len(lines), n + 2)

    def test_finish_marks_done(self):
        tracker, lines, _ = make(plan="azure")
        tracker.phase("azure")
        tracker.finish(ok=True)
        data = last_progress(lines)
        self.assertTrue(data["done"])
        self.assertTrue(data["ok"])
        self.assertEqual(data["phase_index"], len(data["phases"]) - 1)


class EnrichTest(unittest.TestCase):
    def test_enrich_none(self):
        self.assertIsNone(enrich(None))
        self.assertIsNone(enrich({}))

    def test_time_based_phase_percent_capped(self):
        tracker, lines, clock = make(plan="azure")
        tracker.set_eta_minutes(2, 4)  # centre 180 s; azure phase weight 80 → 144 s expected
        tracker.phase("extract")
        tracker.phase("azure")
        start = clock()
        data = last_progress(lines)
        early = enrich(data, now=start + 10)
        late = enrich(data, now=start + 10_000)
        self.assertEqual(early["phase_states"][0]["state"], "done")
        self.assertEqual(early["phase_states"][1]["state"], "active")
        self.assertEqual(early["phase_states"][2]["state"], "pending")
        self.assertGreater(early["percent"], 15)
        self.assertLess(early["percent"], late["percent"])
        # never claims completion while running
        self.assertLessEqual(late["percent"], 97)
        self.assertTrue(late["overdue"])
        self.assertEqual(late["eta_remaining_high_s"], 0)
        self.assertGreater(early["eta_remaining_high_s"], 0)

    def test_explicit_percent_wins(self):
        tracker, lines, clock = make(plan="azure")
        tracker.set_duration(100)
        tracker.set_eta_minutes(10, 20)
        tracker.phase("extract")
        clock.tick(1)
        tracker.feed_ffmpeg("out_time=00:00:50.000000")
        data = enrich(last_progress(lines), now=clock())
        self.assertEqual(data["percent"], 8)  # 50 % of a 15-weight phase
        self.assertEqual(data["phase_label"], "抽出音軌")

    def test_parts_average(self):
        tracker, lines, clock = make(plan="parallel")
        tracker.set_eta_minutes(10, 20)
        tracker.phase("split")
        tracker.phase("transcribe")
        tracker.set_part_total(3)
        tracker.part_started(0)
        tracker.part_started(1)
        tracker.part_done(0)
        tracker.feed_whisperx(1, ">>Performing transcription...")
        clock.tick(1)
        tracker.feed_whisperx(1, "Progress: 100.00%...")
        data = enrich(last_progress(lines), now=clock())
        # part0=100, part1=50 (top of transcribe range), part2=0 → mean 50 → 6 + 92*0.5 = 52
        self.assertEqual(data["phase_percent_effective"], 50)
        self.assertEqual(data["percent"], 52)
        self.assertIn("1/3 段完成", data["detail"])

    def test_done_is_100(self):
        tracker, lines, clock = make(plan="local")
        tracker.phase("save")
        tracker.finish(ok=True)
        data = enrich(last_progress(lines), now=clock() + 5)
        self.assertEqual(data["percent"], 100)
        self.assertTrue(all(s["state"] == "done" for s in data["phase_states"]))

    def test_failed_keeps_partial_percent(self):
        tracker, lines, clock = make(plan="local")
        tracker.phase("extract")
        tracker.finish(ok=False)
        data = enrich(last_progress(lines), now=clock())
        self.assertLess(data["percent"], 100)
        self.assertFalse(data["ok"])


class JobStateIntegrationTest(unittest.TestCase):
    def test_job_state_intercepts_progress_lines(self):
        import demo_app

        job = demo_app.JobState()
        job.reset("transcribe")
        job.append("normal line")
        job.append(PROGRESS_PREFIX + json.dumps({"started_at": 1.0, "phases": [], "phase_index": -1}))
        snap = job.snapshot()
        self.assertEqual(snap["logs"], ["normal line"])
        self.assertIsNotNone(snap["progress"])
        self.assertIn("percent", snap["progress"])
        self.assertIn("progress", demo_app.demo_core.get_status().to_dict()["api_capabilities"])

    def test_default_log_hides_progress(self):
        import demo_core

        with mock.patch("builtins.print") as p:
            demo_core.default_log(PROGRESS_PREFIX + "{}")
            demo_core.default_log("hello")
        p.assert_called_once()


class SaveReportTest(unittest.TestCase):
    def test_safe_report_name(self):
        import demo_core

        self.assertEqual(demo_core.safe_report_name("demo-2026-09-10 報告.md"), "demo-2026-09-10 報告.md")
        self.assertEqual(demo_core.safe_report_name("../../evil.md"), "evil.md")
        self.assertEqual(demo_core.safe_report_name('b:c*?.srt'), "b_c_.srt")
        with self.assertRaises(ValueError):
            demo_core.safe_report_name("x.exe")
        with self.assertRaises(ValueError):
            demo_core.safe_report_name(".md")
        with self.assertRaises(ValueError):
            demo_core.safe_report_name("")

    def test_save_report_writes_into_output(self):
        import demo_core

        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(demo_core, "ROOT", Path(tmp)):
                path = demo_core.save_report("report.md", "# hi\n")
                self.assertEqual(path, Path(tmp) / "output" / "report.md")
                self.assertEqual(path.read_text(encoding="utf-8"), "# hi\n")
                with self.assertRaises(ValueError):
                    demo_core.save_report("report.md", "   ")
                with self.assertRaises(ValueError):
                    demo_core.save_report("big.md", "x" * (demo_core.REPORT_MAX_BYTES + 1))


if __name__ == "__main__":
    unittest.main()
