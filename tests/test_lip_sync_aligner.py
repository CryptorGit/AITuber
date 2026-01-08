from __future__ import annotations

import unittest

from lip_sync.aligner import TimedChunk, build_phonemes_from_timed_chunks, kana_to_moras, mora_to_vowel, text_to_kana


class TestLipSyncAligner(unittest.TestCase):
    def test_text_to_kana_keeps_kana(self) -> None:
        self.assertEqual(text_to_kana(text="あいうえお"), "アイウエオ")
        self.assertEqual(text_to_kana(text="アイウエオ"), "アイウエオ")

    def test_kana_to_moras_basic(self) -> None:
        self.assertEqual(kana_to_moras("アイウエオ"), ["ア", "イ", "ウ", "エ", "オ"])
        self.assertEqual(kana_to_moras("キャット"), ["キャ", "ッ", "ト"])
        self.assertEqual(kana_to_moras("カー"), ["カー"])

    def test_mora_to_vowel(self) -> None:
        self.assertEqual(mora_to_vowel("ア"), "a")
        self.assertEqual(mora_to_vowel("イ"), "i")
        self.assertEqual(mora_to_vowel("ウ"), "u")
        self.assertEqual(mora_to_vowel("エ"), "e")
        self.assertEqual(mora_to_vowel("オ"), "o")
        self.assertEqual(mora_to_vowel("キャ"), "a")
        self.assertIsNone(mora_to_vowel("ッ"))
        self.assertIsNone(mora_to_vowel("ン"))
        self.assertEqual(mora_to_vowel("カー"), "a")

    def test_build_phonemes_from_timed_chunks_vowels(self) -> None:
        chunks = [TimedChunk(start_ms=0, end_ms=500, text="アイウエオ")]
        ev = build_phonemes_from_timed_chunks(chunks=chunks, text="アイウエオ")
        self.assertEqual([e.phoneme for e in ev], ["a", "i", "u", "e", "o"])
        self.assertTrue(all(e.end_ms > e.start_ms for e in ev))
        self.assertGreaterEqual(ev[0].start_ms, 0)
        self.assertLessEqual(ev[-1].end_ms, 500)


if __name__ == "__main__":
    unittest.main()
