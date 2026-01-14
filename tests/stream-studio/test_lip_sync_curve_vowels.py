from __future__ import annotations

import sys
from pathlib import Path
import unittest

APP_ROOT = Path(__file__).resolve().parents[2] / "apps" / "stream-studio"
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from lip_sync.aligner import PhonemeEvent
from lip_sync.curve import build_curve_from_timeline
from lip_sync.mapper import LipSyncMapper, MouthPose


class TestLipSyncCurveVowels(unittest.TestCase):
    def test_curve_emits_vowel_series(self) -> None:
        mapper = LipSyncMapper(
            vowel_map={
                "a": MouthPose(mouth_open=0.9, mouth_form=0.2),
                "i": MouthPose(mouth_open=0.5, mouth_form=0.9),
                "u": MouthPose(mouth_open=0.4, mouth_form=-0.7),
                "e": MouthPose(mouth_open=0.6, mouth_form=0.6),
                "o": MouthPose(mouth_open=0.8, mouth_form=-0.4),
            },
            closed_pose=MouthPose(mouth_open=0.05, mouth_form=0.0),
        )
        phonemes = [
            PhonemeEvent(start_ms=0, end_ms=200, phoneme="a"),
            PhonemeEvent(start_ms=200, end_ms=400, phoneme="i"),
        ]
        curve = build_curve_from_timeline(
            duration_ms=450,
            fps=50,
            mapper=mapper,
            phoneme_events=phonemes,
            viseme_events=None,
            wav_path_for_envelope=None,
            alpha_viseme_open=1.0,
            speech_pad_ms=0,
            attack_ms=1,
            release_ms=1,
        )
        s = curve.series
        self.assertIn("vowel_a", s)
        self.assertIn("vowel_i", s)
        self.assertIn("vowel_u", s)
        self.assertIn("vowel_e", s)
        self.assertIn("vowel_o", s)

        # There should be some non-zero activation in a/i somewhere.
        self.assertGreater(max(s["vowel_a"]), 0.1)
        self.assertGreater(max(s["vowel_i"]), 0.1)
        # Others should remain near zero.
        self.assertLess(max(s["vowel_u"]), 0.2)


if __name__ == "__main__":
    unittest.main()
