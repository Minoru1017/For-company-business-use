"""WoL packet tests."""
from __future__ import annotations

import unittest

import wol_utils


class WolUtilsTests(unittest.TestCase):
    def test_normalize_mac(self) -> None:
        self.assertEqual(wol_utils.normalize_mac("aa-bb-cc-dd-ee-ff"), "AA:BB:CC:DD:EE:FF")

    def test_magic_packet_length(self) -> None:
        pkt = wol_utils.build_magic_packet("AA:BB:CC:DD:EE:FF")
        self.assertEqual(len(pkt), 6 + 16 * 6)

    def test_bad_mac(self) -> None:
        with self.assertRaises(ValueError):
            wol_utils.normalize_mac("bad")


if __name__ == "__main__":
    unittest.main()
