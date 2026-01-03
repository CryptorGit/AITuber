from __future__ import annotations

from pathlib import Path

from apps.main.core.storage import read_json


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
    """Read prompt text from data/config/console_settings.json.

    The user requested prompts be managed as JSON under data/, not as repo files.

    Supported names:
    - llm_system
    - vlm_system
    - gemini_json_instructions
    """
    repo_root = _find_repo_root(Path(__file__))
    path = repo_root / "data" / "config" / "console_settings.json"
    obj = read_json(path) or {}

    if name == "llm_system":
        llm = obj.get("llm") if isinstance(obj.get("llm"), dict) else {}
        return str(llm.get("system_prompt") or "").strip()

    if name == "vlm_system":
        vlm = obj.get("vlm") if isinstance(obj.get("vlm"), dict) else {}
        return str(vlm.get("system_prompt") or "").strip()

    if name == "gemini_json_instructions":
        llm = obj.get("llm") if isinstance(obj.get("llm"), dict) else {}
        # Optional: allow JSON instructions to be stored in the same JSON.
        return str(llm.get("json_instructions") or "").strip()

    return ""
