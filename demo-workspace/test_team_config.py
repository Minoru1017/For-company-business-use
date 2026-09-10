#!/usr/bin/env python3
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import demo_core
from team_config import (
    TeamConfigError,
    load_team_config,
    merge_missing,
    parse_env_text,
    redact,
    render_team_config,
    validate_team_config,
)


class ParseTest(unittest.TestCase):
    def test_parse_allowed_and_ignored(self):
        text = (
            "\ufeff# comment\n"
            "AZURE_SPEECH_KEY = \"abc123\"\n"
            "AZURE_SPEECH_REGION=SouthEastAsia\n"
            "export HF_TOKEN=hf_xyz\n"
            "PATH=/evil\n"
            "not a line\n"
            "AZURE_SPEECH_ENDPOINT=\n"
        )
        values, ignored = parse_env_text(text)
        self.assertEqual(values["AZURE_SPEECH_KEY"], "abc123")
        self.assertEqual(values["AZURE_SPEECH_REGION"], "southeastasia")
        self.assertEqual(values["HF_TOKEN"], "hf_xyz")
        self.assertNotIn("AZURE_SPEECH_ENDPOINT", values)
        self.assertEqual(ignored, ["PATH"])

    def test_placeholders_skipped(self):
        values, _ = parse_env_text("AZURE_SPEECH_KEY=在這裡貼上Azure_Speech金鑰\nAZURE_SPEECH_REGION=eastasia\n")
        self.assertNotIn("AZURE_SPEECH_KEY", values)

    def test_too_large(self):
        with self.assertRaises(TeamConfigError):
            parse_env_text("A=b\n" * 40_000)


class ValidateTest(unittest.TestCase):
    def test_requires_pair(self):
        with self.assertRaises(TeamConfigError):
            validate_team_config({"AZURE_SPEECH_KEY": "k"})

    def test_bad_region(self):
        with self.assertRaises(TeamConfigError):
            validate_team_config({"AZURE_SPEECH_KEY": "k", "AZURE_SPEECH_REGION": "East Asia!"})

    def test_bad_mode_and_token(self):
        with self.assertRaises(TeamConfigError):
            validate_team_config({"HF_TOKEN": "hf_ok", "CALL_COACH_DEFAULT_MODE": "turbo"})
        with self.assertRaises(TeamConfigError):
            validate_team_config({"HF_TOKEN": "nothf"})

    def test_empty(self):
        with self.assertRaises(TeamConfigError):
            validate_team_config({})

    def test_ok(self):
        validate_team_config(
            {"AZURE_SPEECH_KEY": "k", "AZURE_SPEECH_REGION": "japaneast", "CALL_COACH_DEFAULT_MODE": "azure"}
        )


class MergeRenderTest(unittest.TestCase):
    def test_merge_only_fills_placeholders(self):
        team = {"AZURE_SPEECH_KEY": "team", "AZURE_SPEECH_REGION": "japaneast", "HF_TOKEN": "hf_team"}
        env = {"AZURE_SPEECH_KEY": "在這裡貼上", "AZURE_SPEECH_REGION": "", "HF_TOKEN": "hf_mine"}
        self.assertEqual(merge_missing(team, env), {"AZURE_SPEECH_KEY": "team", "AZURE_SPEECH_REGION": "japaneast"})

    def test_render_roundtrip(self):
        text = render_team_config({"AZURE_SPEECH_KEY": "k", "AZURE_SPEECH_REGION": "southeastasia"}, team_name="Sales")
        values, ignored = parse_env_text(text)
        self.assertEqual(ignored, [])
        self.assertEqual(values["CALL_COACH_TEAM_NAME"], "Sales")
        self.assertEqual(values["AZURE_SPEECH_REGION"], "southeastasia")

    def test_redact(self):
        out = redact({"AZURE_SPEECH_KEY": "0123456789abcdef", "HF_TOKEN": "short", "AZURE_SPEECH_REGION": "japaneast"})
        self.assertEqual(out["AZURE_SPEECH_KEY"], "0123…ef")
        self.assertEqual(out["HF_TOKEN"], "***")
        self.assertEqual(out["AZURE_SPEECH_REGION"], "japaneast")

    def test_load_invalid_file_returns_empty(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "team-config.env"
            p.write_text("AZURE_SPEECH_KEY=only-key\n", encoding="utf-8")
            self.assertEqual(load_team_config(p), {})
            p.write_text("AZURE_SPEECH_KEY=k\nAZURE_SPEECH_REGION=southeastasia\n", encoding="utf-8")
            self.assertEqual(load_team_config(p)["AZURE_SPEECH_REGION"], "southeastasia")


class CoreIntegrationTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / ".env.example").write_text(
            "HF_TOKEN=hf_在這裡貼上你的token\nAZURE_SPEECH_KEY=在這裡貼上Azure_Speech金鑰\nAZURE_SPEECH_REGION=eastasia\n",
            encoding="utf-8",
        )
        self.patcher = mock.patch.object(demo_core, "ROOT", self.root)
        self.patcher.start()
        os.environ.pop("CALL_COACH_TEAM_CONFIG", None)

    def tearDown(self):
        self.patcher.stop()
        self.tmp.cleanup()

    def test_apply_team_config_fills_env_and_sets_default_mode(self):
        (self.root / "team-config.env").write_text(
            "CALL_COACH_TEAM_NAME=Sales\nAZURE_SPEECH_KEY=teamkey\nAZURE_SPEECH_REGION=southeastasia\n",
            encoding="utf-8",
        )
        logs: list[str] = []
        applied = demo_core.apply_team_config(log=logs.append)
        self.assertEqual(applied, ["AZURE_SPEECH_KEY", "AZURE_SPEECH_REGION", "CALL_COACH_TEAM_NAME"])
        self.assertTrue(demo_core.has_azure_config())
        self.assertEqual(demo_core.azure_config(), ("teamkey", "southeastasia"))
        self.assertEqual(demo_core.default_transcribe_mode(), "azure")
        self.assertTrue(demo_core.azure_fast_supported())
        # Second run is a no-op and never overwrites what the user has set.
        demo_core.save_azure_config("mykey", "japaneast")
        self.assertEqual(demo_core.apply_team_config(log=logs.append), [])
        self.assertEqual(demo_core.azure_config(), ("mykey", "japaneast"))
        info = demo_core.team_config_info()
        self.assertTrue(info["present"])
        self.assertEqual(info["team_name"], "Sales")
        self.assertTrue(info["provides_azure"])

    def test_default_mode_without_azure_is_standard(self):
        self.assertEqual(demo_core.default_transcribe_mode(), "standard")
        demo_core.update_env_values({"CALL_COACH_DEFAULT_MODE": "azure"})
        self.assertEqual(demo_core.default_transcribe_mode(), "standard")
        demo_core.update_env_values({"CALL_COACH_DEFAULT_MODE": "fast"})
        self.assertEqual(demo_core.default_transcribe_mode(), "fast")

    def test_import_and_export(self):
        values = demo_core.import_team_config_text(
            "AZURE_SPEECH_KEY=k1\nAZURE_SPEECH_REGION=japaneast\nHF_TOKEN=hf_abc\n"
        )
        self.assertEqual(sorted(values), ["AZURE_SPEECH_KEY", "AZURE_SPEECH_REGION", "HF_TOKEN"])
        self.assertTrue((self.root / "team-config.env").is_file())
        self.assertTrue(demo_core.has_valid_token())
        exported = demo_core.export_team_config_text(team_name="Team A")
        self.assertIn("AZURE_SPEECH_KEY=k1", exported)
        self.assertNotIn("HF_TOKEN", exported)
        self.assertIn("CALL_COACH_TEAM_NAME=Team A", exported)
        self.assertIn("HF_TOKEN=hf_abc", demo_core.export_team_config_text(include_hf_token=True))

    def test_import_rejects_unknown_keys(self):
        with self.assertRaises(ValueError):
            demo_core.import_team_config_text("AZURE_SPEECH_KEY=k\nAZURE_SPEECH_REGION=japaneast\nPATH=x\n")

    def test_export_without_config_fails(self):
        with self.assertRaises(ValueError):
            demo_core.export_team_config_text()

    def test_save_azure_config_validates_region(self):
        with self.assertRaises(ValueError):
            demo_core.save_azure_config("k", "East Asia")
        with self.assertRaises(ValueError):
            demo_core.save_azure_config("k", "eastasia", "http://insecure")
        demo_core.save_azure_config("k", "EastAsia")
        self.assertEqual(demo_core.azure_config(), ("k", "eastasia"))
        self.assertFalse(demo_core.azure_fast_supported())


if __name__ == "__main__":
    unittest.main()
