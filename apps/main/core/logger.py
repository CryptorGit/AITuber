from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional


def setup_logger(*, name: str = "aituber", logs_dir: Path, run_id: str, level: str = "INFO") -> logging.Logger:
    logs_dir.mkdir(parents=True, exist_ok=True)

    logger = logging.getLogger(name)
    logger.setLevel(getattr(logging, level.upper(), logging.INFO))
    logger.propagate = False

    # Avoid duplicate handlers if re-initialized.
    if logger.handlers:
        return logger

    fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")

    sh = logging.StreamHandler()
    sh.setFormatter(fmt)
    logger.addHandler(sh)

    fh = logging.FileHandler(logs_dir / f"assistant_{run_id}.log", encoding="utf-8")
    fh.setFormatter(fmt)
    logger.addHandler(fh)

    return logger


def get_logger(name: str = "aituber") -> logging.Logger:
    return logging.getLogger(name)
