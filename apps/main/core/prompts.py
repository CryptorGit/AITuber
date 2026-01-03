from __future__ import annotations

from pathlib import Path


def read_prompt_text(*, name: str) -> str:
    """Read prompt text from config/main/prompts/<name>.txt.

    Prompts are intentionally stored outside code so they can be edited via Console
    and/or replaced in the workspace.
    """
    repo_root = Path(__file__).resolve().parents[2]
    p = repo_root / "config" / "main" / "prompts" / f"{name}.txt"
    try:
        return p.read_text(encoding="utf-8")
    except Exception:
        return ""
