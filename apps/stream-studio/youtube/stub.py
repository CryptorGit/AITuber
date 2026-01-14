from __future__ import annotations

from dataclasses import dataclass

from core.types import EventIn


@dataclass
class YouTubeStub:
    """MVP stub: treat incoming strings as chat events."""

    def to_event(self, text: str) -> EventIn:
        return EventIn(source="youtube", text=text, include_vlm=False)
