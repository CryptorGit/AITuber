from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

from common.ffmpeg import resolve_ffmpeg
from render.renderer import render_board
from record.replay import ReplayReader, decode_board


def render_replay_to_video(
    *,
    replay_path: Path,
    video_path: Path,
    thumb_path: Optional[Path],
    fps: int = 30,
    cell: int = 24,
    repo_root: Optional[Path] = None,
) -> bool:
    ffmpeg = resolve_ffmpeg(repo_root=repo_root)
    if not ffmpeg:
        return False

    video_path.parent.mkdir(parents=True, exist_ok=True)
    if thumb_path:
        thumb_path.parent.mkdir(parents=True, exist_ok=True)

    tmp_dir = Path(tempfile.mkdtemp(prefix="tetris_frames_"))
    try:
        frame_idx = 0
        first_frame = None
        for obj in ReplayReader(replay_path):
            if obj.get("type") != "step":
                continue
            board_payload = obj.get("board") or {}
            board = decode_board(board_payload, width=10, height=20)
            img = render_board(board, cell=cell)
            if first_frame is None:
                first_frame = img
            frame_path = tmp_dir / f"frame_{frame_idx:06d}.png"
            img.save(frame_path)
            frame_idx += 1

        if frame_idx == 0:
            return False

        if first_frame and thumb_path:
            first_frame.save(thumb_path)

        cmd = [
            ffmpeg,
            "-y",
            "-framerate",
            str(fps),
            "-i",
            str(tmp_dir / "frame_%06d.png"),
            "-pix_fmt",
            "yuv420p",
            str(video_path),
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            return False
        return True
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)
