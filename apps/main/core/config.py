from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

try:
    from dotenv import load_dotenv
except Exception:  # pragma: no cover
    load_dotenv = None  # type: ignore


@dataclass(frozen=True)
class AppConfig:
    llm_provider: str
    llm_api_key: str
    llm_model: str

    tts_voice: str

    vtube_ws_url: str

    ng_words: List[str]

    logs_dir: Path


def load_config(*, env_file: Optional[Path] = None) -> AppConfig:
    if load_dotenv is not None:
        load_dotenv(dotenv_path=str(env_file) if env_file else None, override=False)

    def getenv(key: str, default: str = "") -> str:
        v = os.getenv(key)
        return v if v is not None else default

    ng = getenv("AITUBER_NG_WORDS", "")
    ng_words = [w.strip() for w in ng.split(",") if w.strip()]

    logs_dir = Path(getenv("AITUBER_LOGS_DIR", "logs"))

    return AppConfig(
        llm_provider=getenv("AITUBER_LLM_PROVIDER", "stub"),
        llm_api_key=getenv("AITUBER_LLM_API_KEY", ""),
        llm_model=getenv("AITUBER_LLM_MODEL", "stub-model"),
        tts_voice=getenv("AITUBER_TTS_VOICE", "stub"),
        vtube_ws_url=getenv("AITUBER_VTUBE_WS_URL", "ws://127.0.0.1:8001"),
        ng_words=ng_words,
        logs_dir=logs_dir,
    )
