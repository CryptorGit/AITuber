from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from core.types import DirectorOutput, Emotion, ReplyTo


def _pick_emotion(text: str) -> Emotion:
    t = (text or "").strip()
    if not t:
        return Emotion.neutral
    if any(x in t for x in ("!", "・・)):
        return Emotion.happy
    if any(x in t for x in ("?", "・・)):
        return Emotion.surprised
    if any(x in t for x in ("窶ｦ", "...")):
        return Emotion.smug
    return Emotion.neutral


def _pick_motion_tags(emotion: Emotion) -> list[str]:
    return {
        Emotion.happy: ["smile", "nod"],
        Emotion.surprised: ["surprise", "blink"],
        Emotion.smug: ["smirk"],
        Emotion.angry: ["angry"],
        Emotion.sad: ["sad"],
        Emotion.panic: ["panic"],
        Emotion.neutral: ["neutral"],
    }[emotion]


@dataclass
class Director:
    templates_dir: Path

    def run(self, *, user_text: str, reply_to: ReplyTo | None = None) -> DirectorOutput:
        # Stub: deterministic output (no LLM call) but still conforms to schema.
        emotion = _pick_emotion(user_text)
        motion_tags = _pick_motion_tags(emotion)
        text = (user_text or "").strip()
        if not text:
            text = "・亥・蜉帙′遨ｺ縺縺｣縺溘・縺ｧ縲√・縺ｨ縺ｾ縺壽肩諡ｶ縺吶ｋ縺ｭ・・
            emotion = Emotion.neutral
            motion_tags = ["neutral"]

        return DirectorOutput(
            text=f"莠・ｧ｣・√施text}縲上□縺ｭ縲・,
            emotion=emotion,
            motion_tags=motion_tags,
            reply_to=reply_to or ReplyTo(type="system"),
            debug={"reason": "stub_director"},
        )
