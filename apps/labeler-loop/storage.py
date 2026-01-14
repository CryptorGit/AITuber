from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any


def _acquire_lock(lock_path: Path, timeout_sec: float = 5.0, poll_sec: float = 0.05) -> int:
    start = time.time()
    while True:
        try:
            fd = os.open(str(lock_path), os.O_CREAT | os.O_EXCL | os.O_RDWR)
            return fd
        except FileExistsError:
            if (time.time() - start) >= timeout_sec:
                raise TimeoutError(f"lock_timeout:{lock_path}")
            time.sleep(poll_sec)


def _release_lock(lock_path: Path, fd: int) -> None:
    try:
        os.close(fd)
    except Exception:
        pass
    try:
        lock_path.unlink(missing_ok=True)
    except Exception:
        pass


def append_jsonl(path: Path, row: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lock_path = path.with_name(path.name + ".lock")
    fd = _acquire_lock(lock_path)
    try:
        with path.open("a", encoding="utf-8", newline="\n") as f:
            f.write(json.dumps(row, ensure_ascii=False))
            f.write("\n")
    finally:
        _release_lock(lock_path, fd)
