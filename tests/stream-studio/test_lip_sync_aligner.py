from __future__ import annotations

import sys
from pathlib import Path
import unittest

APP_ROOT = Path(__file__).resolve().parents[2] / "apps" / "stream-studio"
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from lip_sync.aligner import TimedChunk, build_phonemes_from_timed_chunks, kana_to_moras, mora_to_vowel, text_to_kana


class TestLipSyncAligner(unittest.TestCase):
    def test_text_to_kana_keeps_kana(self) -> None:
        self.assertEqual(text_to_kana(text="縺ゅ＞縺・∴縺・), "繧｢繧､繧ｦ繧ｨ繧ｪ")
        self.assertEqual(text_to_kana(text="繧｢繧､繧ｦ繧ｨ繧ｪ"), "繧｢繧､繧ｦ繧ｨ繧ｪ")

    def test_kana_to_moras_basic(self) -> None:
        self.assertEqual(kana_to_moras("繧｢繧､繧ｦ繧ｨ繧ｪ"), ["繧｢", "繧､", "繧ｦ", "繧ｨ", "繧ｪ"])
        self.assertEqual(kana_to_moras("繧ｭ繝｣繝・ヨ"), ["繧ｭ繝｣", "繝・, "繝・])
        self.assertEqual(kana_to_moras("繧ｫ繝ｼ"), ["繧ｫ繝ｼ"])

    def test_mora_to_vowel(self) -> None:
        self.assertEqual(mora_to_vowel("繧｢"), "a")
        self.assertEqual(mora_to_vowel("繧､"), "i")
        self.assertEqual(mora_to_vowel("繧ｦ"), "u")
        self.assertEqual(mora_to_vowel("繧ｨ"), "e")
        self.assertEqual(mora_to_vowel("繧ｪ"), "o")
        self.assertEqual(mora_to_vowel("繧ｭ繝｣"), "a")
        self.assertIsNone(mora_to_vowel("繝・))
        self.assertIsNone(mora_to_vowel("繝ｳ"))
        self.assertEqual(mora_to_vowel("繧ｫ繝ｼ"), "a")

    def test_build_phonemes_from_timed_chunks_vowels(self) -> None:
        chunks = [TimedChunk(start_ms=0, end_ms=500, text="繧｢繧､繧ｦ繧ｨ繧ｪ")]
        ev = build_phonemes_from_timed_chunks(chunks=chunks, text="繧｢繧､繧ｦ繧ｨ繧ｪ")
        self.assertEqual([e.phoneme for e in ev], ["a", "i", "u", "e", "o"])
        self.assertTrue(all(e.end_ms > e.start_ms for e in ev))
        self.assertGreaterEqual(ev[0].start_ms, 0)
        self.assertLessEqual(ev[-1].end_ms, 500)


if __name__ == "__main__":
    unittest.main()
