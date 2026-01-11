from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from .aligner import PhonemeEvent


@dataclass
class VisemeEvent:
    time_ms: int
    viseme_id: str
    intensity: Optional[float] = None


@dataclass
class MouthPose:
    mouth_open: float
    mouth_form: float
    smile: float = 0.0


class LipSyncMapper:
    """Maps phonemes/visemes to continuous mouth pose targets.

    For Japanese, we aim for vowel shapes a/i/u/e/o, plus a closed mouth pose.
    """

    def __init__(
        self,
        *,
        vowel_map: Dict[str, MouthPose],
        closed_pose: MouthPose,
        consonant_open_scale: float = 0.7,
        default_smile: float = 0.0,
        emotion_smile_boost: float = 0.15,
        emotion_tags: Optional[List[str]] = None,
    ) -> None:
        self.vowel_map = vowel_map
        self.closed_pose = closed_pose
        self.consonant_open_scale = float(consonant_open_scale)
        self.default_smile = float(default_smile)
        self.emotion_smile_boost = float(emotion_smile_boost)
        self.emotion_tags = [str(t).strip().lower() for t in (emotion_tags or []) if str(t).strip()]

    def _smile_value(self) -> float:
        s = self.default_smile
        if any(t in ("smile", "happy", "joy", "laugh") for t in self.emotion_tags):
            s += self.emotion_smile_boost
        return float(max(0.0, min(1.0, s)))

    @staticmethod
    def _phoneme_to_key(phoneme: str) -> str:
        p = (phoneme or "").strip().lower()
        # Common Japanese romanization / OpenJTalk-ish labels
        if p in ("a", "aa"):
            return "a"
        if p in ("i", "ii"):
            return "i"
        if p in ("u", "uu"):
            return "u"
        if p in ("e", "ee"):
            return "e"
        if p in ("o", "oo"):
            return "o"
        if p in ("n", "N", "ng", "m"):
            return "n"
        if p in ("sp", "sil", "pau"):
            return "sil"
        # Heuristic: final vowel char
        for v in ("a", "i", "u", "e", "o"):
            if p.endswith(v):
                return v
        return "consonant"

    def pose_for_phoneme(self, phoneme: str) -> MouthPose:
        key = self._phoneme_to_key(phoneme)
        smile = self._smile_value()
        if key == "sil":
            return MouthPose(mouth_open=self.closed_pose.mouth_open, mouth_form=self.closed_pose.mouth_form, smile=smile)
        if key == "n":
            return MouthPose(mouth_open=self.closed_pose.mouth_open, mouth_form=self.closed_pose.mouth_form, smile=smile)
        if key in self.vowel_map:
            p = self.vowel_map[key]
            return MouthPose(mouth_open=p.mouth_open, mouth_form=p.mouth_form, smile=smile)
        # consonant: keep shape near neutral and slightly closed
        return MouthPose(
            mouth_open=self.closed_pose.mouth_open + (0.35 * self.consonant_open_scale),
            mouth_form=0.0,
            smile=smile,
        )

    def pose_for_viseme_id(self, viseme_id: str) -> MouthPose:
        # Default mapping: pass through vowels if the ID already is one.
        key = (viseme_id or "").strip().lower()
        if key in ("a", "i", "u", "e", "o"):
            p = self.vowel_map.get(key, self.closed_pose)
            return MouthPose(mouth_open=p.mouth_open, mouth_form=p.mouth_form, smile=self._smile_value())
        if key in ("sil", "sp", "n", "closed"):
            return MouthPose(mouth_open=self.closed_pose.mouth_open, mouth_form=self.closed_pose.mouth_form, smile=self._smile_value())
        # Unknown: treat as consonant-ish
        return self.pose_for_phoneme(key)

    def build_targets_from_phonemes(self, phonemes: List[PhonemeEvent]) -> List[Tuple[int, int, MouthPose]]:
        out: List[Tuple[int, int, MouthPose]] = []
        for ev in phonemes:
            if ev.end_ms <= ev.start_ms:
                continue
            out.append((int(ev.start_ms), int(ev.end_ms), self.pose_for_phoneme(ev.phoneme)))
        out.sort(key=lambda x: (x[0], x[1]))
        return out
