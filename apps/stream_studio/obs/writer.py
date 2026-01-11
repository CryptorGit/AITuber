from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass
class OBSOverlayWriter:
    overlay_path: Path

    def write(self, *, text: str) -> Path:
        self.overlay_path.parent.mkdir(parents=True, exist_ok=True)
        safe = (text or "").replace("\r", " ").strip()
        # OBS text sources tend to prefer short text.
        if len(safe) > 200:
            safe = safe[:200]
        self.overlay_path.write_text(safe, encoding="utf-8")
        return self.overlay_path
