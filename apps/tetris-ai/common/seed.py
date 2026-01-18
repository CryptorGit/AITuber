from __future__ import annotations

import os
import random
from typing import Optional

import numpy as np


def set_seed(seed: int, *, deterministic_torch: bool = True) -> None:
    os.environ["PYTHONHASHSEED"] = str(seed)
    random.seed(seed)
    np.random.seed(seed)
    try:
        import torch

        torch.manual_seed(seed)
        torch.cuda.manual_seed_all(seed)
        if deterministic_torch:
            torch.backends.cudnn.deterministic = True
            torch.backends.cudnn.benchmark = False
            try:
                torch.use_deterministic_algorithms(True)
            except Exception:
                pass
    except Exception:
        pass


def get_seed(seed: Optional[int] = None) -> int:
    if seed is None:
        seed = int(os.getenv("AITUBER_TETRIS_SEED", "0") or "0")
    return int(seed)
