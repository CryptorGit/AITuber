from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def _find_repo_root(start: Path) -> Path:
    p = start.resolve()
    for parent in [p] + list(p.parents):
        try:
            if (parent / ".git").exists():
                return parent
            if (parent / "requirements.txt").exists() and (parent / "apps").is_dir():
                return parent
        except Exception:
            continue
    # Best-effort fallback: keep prior behavior-like assumptions without embedding prompts.
    return start.resolve().parents[3]


def read_labeler_prompt(*, section: str) -> dict[str, Any]:
    repo_root = _find_repo_root(Path(__file__))
    path = repo_root / "data" / "config" / "labeler_loop_prompts.json"
    try:
        with path.open("r", encoding="utf-8-sig") as f:
            obj = json.load(f)
    except Exception:
        obj = {}
    sec = obj.get(section)
    return sec if isinstance(sec, dict) else {}
