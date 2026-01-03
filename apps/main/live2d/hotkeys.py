from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Optional

import yaml


@dataclass
class HotkeyMap:
    tag_to_hotkey_id: Dict[str, str]

    @classmethod
    def from_yaml(cls, path: Path) -> "HotkeyMap":
        if not path.exists():
            return cls(tag_to_hotkey_id={})
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        hotkeys = (data or {}).get("hotkeys", {}) or {}
        return cls(tag_to_hotkey_id={str(k): str(v) for k, v in hotkeys.items() if str(v).strip()})

    def resolve(self, tag: str) -> Optional[str]:
        v = self.tag_to_hotkey_id.get(tag)
        return v if v and v.strip() else None
