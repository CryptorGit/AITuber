from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, Optional

JsonDict = Dict[str, Any]


def utc_iso() -> str:
    # ISO8601 with Z (seconds precision is fine for MVP)
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def atomic_write_text(path: Path, text: str, encoding: str = "utf-8") -> None:
    ensure_parent(path)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding=encoding)
    os.replace(tmp, path)


def read_json(path: Path) -> Optional[JsonDict]:
    try:
        # Use utf-8-sig to tolerate UTF-8 BOM (common on Windows/PowerShell).
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (FileNotFoundError, PermissionError, OSError, json.JSONDecodeError):
        return None


def write_json(path: Path, obj: Any) -> None:
    # Write with BOM so Windows PowerShell shows Japanese text correctly.
    atomic_write_text(path, json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8-sig")


@dataclass
class JsonlWriter:
    path: Path

    def append(self, obj: Any) -> None:
        ensure_parent(self.path)
        line = json.dumps(obj, ensure_ascii=False)
        with self.path.open("a", encoding="utf-8") as f:
            f.write(line + "\n")


def tail_jsonl(path: Path, max_lines: int) -> list[JsonDict]:
    if max_lines <= 0:
        return []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return []

    out: list[JsonDict] = []
    for line in lines[-max_lines:]:
        try:
            out.append(json.loads(line))
        except Exception:
            continue
    return out
