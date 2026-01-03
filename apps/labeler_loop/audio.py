from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

from fastapi import UploadFile

from env_loader import load_env_files


def _read_env_value(path: Path, key: str) -> str | None:
    if not path.exists():
        return None

    raw = path.read_bytes()
    for enc in ("utf-8-sig", "utf-8"):
        try:
            text = raw.decode(enc)
            break
        except Exception:
            text = ""
    if not text:
        return None

    prefix = key + "="
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if not line.startswith(prefix):
            continue
        value = line[len(prefix) :].strip().strip('"')
        return value or None
    return None


async def save_upload_file(upload: UploadFile, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with dest.open("wb") as f:
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break
            f.write(chunk)


def _resolve_ffmpeg() -> str | None:
    # Allow changing backend/.env without restarting uvicorn.
    base = Path(__file__).resolve().parent
    load_env_files(base)

    # Extra robustness: explicitly parse env files for FFMPEG_PATH (BOM-tolerant)
    direct = _read_env_value(base / ".env", "FFMPEG_PATH") or _read_env_value(base.parent / ".env", "FFMPEG_PATH")
    if direct:
        os.environ["FFMPEG_PATH"] = direct

    configured = (os.getenv("FFMPEG_PATH") or "").strip().strip('"')
    if configured:
        p = Path(configured)
        if p.exists():
            return str(p)

    found = shutil.which("ffmpeg")
    if found:
        return found

    # Common Windows locations (winget/choco/manual installs)
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


def convert_to_wav_16k_mono(in_path: Path, out_path: Path) -> None:
    ffmpeg = _resolve_ffmpeg()
    if not ffmpeg:
        raise FileNotFoundError(
            "ffmpeg not found. Install ffmpeg and ensure `ffmpeg -version` works, or set FFMPEG_PATH in backend/.env to the full path of ffmpeg.exe."
        )

    out_path.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        ffmpeg,
        "-y",
        "-i",
        str(in_path),
        "-ac",
        "1",
        "-ar",
        "16000",
        "-f",
        "wav",
        str(out_path),
    ]

    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or f"ffmpeg failed ({proc.returncode})")
