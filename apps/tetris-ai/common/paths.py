from __future__ import annotations

from pathlib import Path

DATA_ROOT = Path("data/tetris-ai")


def ensure_dirs() -> None:
    (DATA_ROOT / "logs").mkdir(parents=True, exist_ok=True)
    (DATA_ROOT / "checkpoints").mkdir(parents=True, exist_ok=True)
    (DATA_ROOT / "replays").mkdir(parents=True, exist_ok=True)
    (DATA_ROOT / "videos").mkdir(parents=True, exist_ok=True)
    (DATA_ROOT / "thumbs").mkdir(parents=True, exist_ok=True)
    (DATA_ROOT / "metrics").mkdir(parents=True, exist_ok=True)


def run_dir(run_id: str) -> Path:
    return DATA_ROOT / "runs" / run_id


def checkpoints_dir(run_id: str) -> Path:
    return DATA_ROOT / "checkpoints" / run_id


def replays_dir(run_id: str, checkpoint_id: str) -> Path:
    return DATA_ROOT / "replays" / run_id / checkpoint_id


def videos_dir(run_id: str, checkpoint_id: str) -> Path:
    return DATA_ROOT / "videos" / run_id / checkpoint_id


def thumbs_dir(run_id: str, checkpoint_id: str) -> Path:
    return DATA_ROOT / "thumbs" / run_id / checkpoint_id


def metrics_dir(run_id: str) -> Path:
    return DATA_ROOT / "metrics" / run_id
