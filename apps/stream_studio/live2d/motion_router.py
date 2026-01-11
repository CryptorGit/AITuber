from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List


@dataclass
class MotionRouter:
    """Map motion_tags to VTube Studio actions (hotkeys/expressions).

    This is rule-based and intentionally simple.
    """

    tag_to_action: Dict[str, str]

    def route(self, motion_tags: List[str]) -> List[str]:
        actions: List[str] = []
        for tag in motion_tags:
            a = self.tag_to_action.get(tag)
            if a:
                actions.append(a)
        return actions


def default_router() -> MotionRouter:
    return MotionRouter(
        tag_to_action={
            "smile": "hotkey:smile",
            "nod": "hotkey:nod",
            "laugh_small": "hotkey:laugh_small",
            "surprise": "hotkey:surprise",
            "blink": "hotkey:blink",
            "smirk": "hotkey:smirk",
            "panic": "hotkey:panic",
            "neutral": "hotkey:neutral",
            "angry": "hotkey:angry",
            "sad": "hotkey:sad",
        }
    )
