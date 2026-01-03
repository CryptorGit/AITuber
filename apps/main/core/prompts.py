from __future__ import annotations

from pathlib import Path


def _find_repo_root(start: Path) -> Path:
    p = start.resolve()
    for parent in [p] + list(p.parents):
        try:
            if (parent / ".git").exists():
                return parent
            if (parent / "requirements.txt").exists() and (parent / "apps").is_dir():
                return parent
        except Exception:
            continue
    return start.resolve().parents[3]


def read_prompt_text(*, name: str) -> str:
    """Read prompt text from config/main/prompts/<name>.txt.

    Prompts are intentionally stored outside code so they can be edited via Console
    and/or replaced in the workspace.
    """
    repo_root = _find_repo_root(Path(__file__))
    p = repo_root / "config" / "main" / "prompts" / f"{name}.txt"
    try:
        # BOM-tolerant for Windows editors
        return p.read_text(encoding="utf-8-sig")
    except Exception:
        return ""
