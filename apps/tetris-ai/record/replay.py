from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, Iterator, List

from common.paths import ensure_dirs


def _encode_board(board: List[List[int]]) -> Dict[str, Any]:
    flat = [v for row in board for v in row]
    out = []
    if not flat:
        return {"format": "rle", "data": []}
    cur = flat[0]
    cnt = 1
    for v in flat[1:]:
        if v == cur:
            cnt += 1
        else:
            out.append([cur, cnt])
            cur = v
            cnt = 1
    out.append([cur, cnt])
    return {"format": "rle", "data": out}


def _decode_board(payload: Dict[str, Any], width: int, height: int) -> List[List[int]]:
    fmt = payload.get("format")
    if fmt != "rle":
        return [[0 for _ in range(width)] for _ in range(height)]
    data = payload.get("data") or []
    flat: List[int] = []
    for v, cnt in data:
        flat.extend([int(v)] * int(cnt))
    if len(flat) < width * height:
        flat.extend([0] * (width * height - len(flat)))
    out = []
    for y in range(height):
        out.append(flat[y * width : (y + 1) * width])
    return out


@dataclass
class ReplayMeta:
    ruleset_version: str
    seed: int
    policy_id: str
    timestamp: str


class ReplayWriter:
    def __init__(self, path: Path, meta: ReplayMeta) -> None:
        ensure_dirs()
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self.meta = meta
        with self.path.open("w", encoding="utf-8") as f:
            f.write(json.dumps({"type": "meta", **meta.__dict__}, ensure_ascii=False) + "\n")

    def append_step(self, step: Dict[str, Any]) -> None:
        with self.path.open("a", encoding="utf-8") as f:
            f.write(json.dumps({"type": "step", **step}, ensure_ascii=False) + "\n")


class ReplayReader:
    def __init__(self, path: Path) -> None:
        self.path = path

    def __iter__(self) -> Iterator[Dict[str, Any]]:
        with self.path.open("r", encoding="utf-8") as f:
            for line in f:
                try:
                    yield json.loads(line)
                except Exception:
                    continue


def encode_board(board: List[List[int]]) -> Dict[str, Any]:
    return _encode_board(board)


def decode_board(payload: Dict[str, Any], width: int, height: int) -> List[List[int]]:
    return _decode_board(payload, width, height)
