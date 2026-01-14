from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass
class TTSCache:
    """TTS cache stub.

    Replace with content-hash cache later.
    """

    cache_dir: Path

    def __post_init__(self) -> None:
        self.cache_dir.mkdir(parents=True, exist_ok=True)
