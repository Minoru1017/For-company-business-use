#!/usr/bin/env python3
import unittest

import job_log


class AppendCompactTest(unittest.TestCase):
    def test_progress_updates_collapse_in_place(self):
        logs: list[str] = []
        job_log.append_compact(logs, "開始")
        job_log.append_compact(logs, "Transcribing:  10%|█         | 1/10 [00:05<00:45, 5.0s/it]")
        job_log.append_compact(logs, "Transcribing:  20%|██        | 2/10 [00:10<00:40, 5.0s/it]")
        job_log.append_compact(logs, "Transcribing: 100%|██████████| 10/10 [00:50<00:00, 5.0s/it]")
        self.assertEqual(len(logs), 2)
        self.assertIn("100%", logs[-1])

    def test_interleaved_chunks_keep_separate_bars(self):
        logs: list[str] = []
        job_log.append_compact(logs, "  [段 1] model.bin:  10%|█ | 1/10")
        job_log.append_compact(logs, "  [段 2] model.bin:  10%|█ | 1/10")
        job_log.append_compact(logs, "  [段 1] model.bin:  50%|█████ | 5/10")
        job_log.append_compact(logs, "  [段 2] model.bin:  70%|███████ | 7/10")
        self.assertEqual(logs, ["  [段 1] model.bin:  50%|█████ | 5/10", "  [段 2] model.bin:  70%|███████ | 7/10"])

    def test_plain_lines_are_appended(self):
        logs: list[str] = []
        job_log.append_compact(logs, "a")
        job_log.append_compact(logs, "a")
        self.assertEqual(logs, ["a", "a"])

    def test_cap_keeps_head_and_tail(self):
        logs: list[str] = []
        for i in range(job_log.MAX_LOG_LINES + 50):
            job_log.append_compact(logs, f"line {i}")
        self.assertLessEqual(len(logs), job_log.MAX_LOG_LINES + 1)
        self.assertEqual(logs[0], "line 0")
        self.assertEqual(logs[job_log.HEAD_KEEP], job_log.TRIM_MARKER)
        self.assertEqual(logs[-1], f"line {job_log.MAX_LOG_LINES + 49}")


if __name__ == "__main__":
    unittest.main()
