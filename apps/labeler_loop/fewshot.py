from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Any


def _load_labels(path: Path, max_rows: int = 5000) -> list[dict[str, Any]]:
    if not path.exists():
        return []

    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(obj, dict):
                rows.append(obj)
            if len(rows) >= max_rows:
                break
    return rows


def sample_fewshot(labels_path: Path, k_min: int = 2, k_max: int = 3) -> list[dict[str, Any]]:
    rows = _load_labels(labels_path)
    if not rows:
        return []

    k = random.randint(k_min, k_max)
    k = max(0, min(k, len(rows)))
    sampled = random.sample(rows, k=k)

    out: list[dict[str, Any]] = []
    for r in sampled:
        try:
            rid = str(r.get("id") or "")
            inp = ((r.get("input") or {}) if isinstance(r.get("input"), dict) else {})
            inp_text = str(inp.get("text") or "")
            candidates = r.get("candidates")
            winner_index = r.get("winner_index")
            winner = ""
            if isinstance(candidates, list) and isinstance(winner_index, int) and 0 <= winner_index < len(candidates):
                w = candidates[winner_index]
                if isinstance(w, str):
                    winner = w
            if inp_text and winner:
                out.append({"id": rid, "input": inp_text, "winner": winner})
        except Exception:
            continue

    return out
