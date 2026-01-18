from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Optional


def _read_env_value(env_path: Path, key: str) -> Optional[str]:
    try:
        if not env_path.exists():
            return None
        text = env_path.read_text(encoding="utf-8-sig", errors="ignore")
        for line in text.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            k, v = line.split("=", 1)
            if k.strip() != key:
                continue
            return v.strip().strip('"')
    except Exception:
        return None
    return None


def resolve_ffmpeg(repo_root: Optional[Path] = None) -> Optional[str]:
    # Honor FFMPEG_PATH if set, else try PATH, else fallback to common locations.
    env_value = (os.getenv("FFMPEG_PATH") or "").strip().strip('"')
    if not env_value and repo_root:
        direct = _read_env_value(repo_root / ".env" / ".env", "FFMPEG_PATH") or _read_env_value(repo_root / ".env", "FFMPEG_PATH")
        if direct:
            env_value = direct.strip().strip('"')
            os.environ["FFMPEG_PATH"] = env_value
    if env_value and Path(env_value).exists():
        return env_value

    found = shutil.which("ffmpeg")
    if found:
        return found

    candidates = [
        r"C:\\Program Files\\FFmpeg\\bin\\ffmpeg.exe",
        r"C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe",
        r"C:\\ffmpeg\\bin\\ffmpeg.exe",
        r"C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe",
    ]
    for c in candidates:
        if Path(c).exists():
            return c
    return None
