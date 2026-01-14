from __future__ import annotations

import os
from pathlib import Path


def _decode_text(raw: bytes) -> str:
    for enc in ("utf-8-sig", "utf-8"):
        try:
            return raw.decode(enc)
        except Exception:
            continue
    return ""


def load_env_file(path: Path, override: bool = False) -> None:
    if not path.exists():
        return

    text = _decode_text(path.read_bytes())
    if not text:
        return

    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"')
        if not key:
            continue
        if override or key not in os.environ:
            os.environ[key] = value


def load_env_files(base_dir: Path) -> None:
    """Load labeler-loop env in a repo-conventional way.

    Priority (later overrides earlier):
    - repo_root/.env/.env.labeler-loop (local, uncommitted)
    - repo_root/.env/.env (optional, uncommitted)

    Backward-compat (optional):
    - base_dir/.env (legacy; avoid using going forward)

    This loader is BOM-tolerant (utf-8-sig) because Windows editors / PS can
    produce UTF-8 with BOM.
    """

    # base_dir -> apps/labeler-loop
    # repo_root -> AITuber/
    repo_root = base_dir.parents[1]
    env_dir = repo_root / ".env"

    load_env_file(env_dir / ".env", override=False)
    load_env_file(env_dir / ".env.labeler-loop", override=True)

    # Legacy fallback (avoid using going forward)
    load_env_file(base_dir / ".env", override=False)
