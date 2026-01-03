from __future__ import annotations

from dataclasses import dataclass
from typing import List, Tuple

from apps.main.core.types import DirectorOutput, Emotion


@dataclass
class SafetyFilter:
    ng_words: List[str]

    def apply(self, out: DirectorOutput) -> Tuple[DirectorOutput, bool]:
        txt = (out.text or "")
        for w in self.ng_words:
            ww = (w or "").strip()
            if not ww:
                continue
            if ww in txt:
                safe = out.model_copy(deep=True)
                safe.text = "（安全のため省略）"
                safe.emotion = Emotion.neutral
                safe.motion_tags = []
                safe.debug.reason = "blocked_by_ng_word"
                return safe, True
        return out, False
