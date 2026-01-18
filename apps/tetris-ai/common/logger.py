from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional


_DEF_FORMAT = "[%(asctime)s][%(levelname)s][%(name)s] %(message)s"


def setup_logger(name: str, log_path: Optional[Path] = None) -> logging.Logger:
    logger = logging.getLogger(name)
    if logger.handlers:
        return logger
    logger.setLevel(logging.INFO)

    formatter = logging.Formatter(_DEF_FORMAT)
    sh = logging.StreamHandler()
    sh.setFormatter(formatter)
    logger.addHandler(sh)

    if log_path is not None:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        fh = logging.FileHandler(log_path, encoding="utf-8")
        fh.setFormatter(formatter)
        logger.addHandler(fh)

    return logger
