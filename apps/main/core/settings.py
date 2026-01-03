from __future__ import annotations

from pathlib import Path
from typing import Optional

import os

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _decode_env_text(raw: bytes) -> str:
    for enc in ("utf-8-sig", "utf-8"):
        try:
            return raw.decode(enc)
        except Exception:
            continue
    return ""


def _load_env_kv_file(path: Path, *, override: bool) -> None:
    """Load a simple KEY=VALUE file into os.environ.

    - BOM-tolerant (Windows)
    - Does not interpret backslash escapes (safe for C:\\Users\\...)
    - Strips optional surrounding quotes
    """
    try:
        if not path.exists():
            return
        text = _decode_env_text(path.read_bytes())
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
            value = value.strip()
            if not key:
                continue
            if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
                value = value[1:-1]
            if override or key not in os.environ:
                os.environ[key] = value
    except Exception:
        return


def _find_repo_root(start: Path) -> Path:
    """Best-effort find repository root from a file path."""
    p = start.resolve()
    for parent in [p] + list(p.parents):
        try:
            if (parent / ".git").exists():
                return parent
            if (parent / "requirements.txt").exists() and (parent / "apps").is_dir():
                return parent
        except Exception:
            continue
    # Fallback: assume 3 levels up from apps/main/core/settings.py
    return start.resolve().parents[3]


class Settings(BaseSettings):
    """Runtime settings.

    Secrets MUST come from .env or environment variables.
    Non-secrets may additionally live in config/main/app.yaml (loaded by the server).
    """

    model_config = SettingsConfigDict(env_prefix="AITUBER_", extra="ignore")

    # Paths
    data_dir: Path = Field(default=Path("data"))
    obs_overlay_path: Path = Field(default=Path("data/obs/overlay.txt"))

    # Server
    server_host: str = Field(default="127.0.0.1")
    server_port: int = Field(default=8000)

    # LLM (Gemini)
    llm_provider: str = Field(default="gemini")
    gemini_api_key: str = Field(default="")
    gemini_model: str = Field(default="gemini-2.0-flash-lite")
    openai_api_key: str = Field(default="")
    openai_model: str = Field(default="gpt-4o-mini")

    # STT
    stt_provider: str = Field(default="google")
    stt_enabled: bool = Field(default=True)
    whisper_model: str = Field(default="large-v3-turbo")
    whisper_compute_type: str = Field(default="int8")
    whisper_device: str = Field(default="cpu")
    stt_chunk_seconds: float = Field(default=0.8)
    openai_whisper_model: str = Field(default="whisper-1")

    # TTS
    tts_provider: str = Field(default="google")
    tts_voice: str = Field(default="ja-JP-Neural2-B")

    # VTube Studio
    vtube_ws_url: str = Field(default="ws://127.0.0.1:8001")
    vtube_auth_token: str = Field(default="")
    vtube_plugin_name: str = Field(default="AITuber")
    vtube_plugin_developer: str = Field(default="Cryptor")

    # Safety
    ng_words: str = Field(default="")

    # VLM
    vlm_enabled: bool = Field(default=True)
    vlm_screenshot_path: Path = Field(default=Path("data/vlm/latest.png"))
    vlm_diff_threshold: float = Field(default=0.08)

    # RAG
    rag_enabled: bool = Field(default=True)
    short_term_max_events: int = Field(default=50)

    # Short-term turns (conversation log) - separate from RAG
    short_term_enabled: bool = Field(default=True)
    short_term_turns_to_prompt: int = Field(default=8)

    @property
    def ng_words_list(self) -> list[str]:
        return [w.strip() for w in (self.ng_words or "").split(",") if w.strip()]


def load_settings(*, env_file: Optional[Path] = None) -> Settings:
    # pydantic-settings reads os.environ; we load .env files ourselves to avoid
    # Windows backslash escape issues in python-dotenv.
    repo_root = _find_repo_root(Path(__file__))

    def _resolve(p: Path) -> Path:
        return p if p.is_absolute() else (repo_root / p).resolve()

    if env_file is not None:
        _load_env_kv_file(_resolve(env_file), override=True)
    else:
        # AITUBER_ENV_FILE can point to an arbitrary env filename.
        env_file_var = (os.getenv("AITUBER_ENV_FILE") or "").strip()
        if env_file_var:
            _load_env_kv_file(_resolve(Path(env_file_var)), override=True)
        else:
            # Prefer .env/ folder layout
            env_dir = repo_root / ".env"
            if env_dir.is_dir():
                # Main app convention: .env/.env.main
                default_env = env_dir / ".env.main"
                if default_env.exists():
                    _load_env_kv_file(default_env, override=True)
                else:
                    legacy_env = env_dir / ".env"
                    if legacy_env.exists():
                        _load_env_kv_file(legacy_env, override=True)

    # Hard-lock providers regardless of env/console settings.
    os.environ["AITUBER_LLM_PROVIDER"] = "gemini"
    os.environ["AITUBER_TTS_PROVIDER"] = "google"
    os.environ["AITUBER_STT_PROVIDER"] = "google"

    # Resolve GOOGLE_APPLICATION_CREDENTIALS from .env/ folder if not set.
    try:
        repo_root = _find_repo_root(Path(__file__))
        env_dir = repo_root / ".env"
        gac = (os.getenv("GOOGLE_APPLICATION_CREDENTIALS") or "").strip()
        if not gac and env_dir.is_dir():
            candidates = sorted(env_dir.glob("*.json"))
            if len(candidates) == 1:
                os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(candidates[0])
        elif gac and not Path(gac).is_absolute():
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str((repo_root / gac).resolve())
    except Exception:
        pass

    # Compatibility env mapping (do not print values; only map if missing)
    if not (os.getenv("AITUBER_GEMINI_API_KEY") or "").strip():
        for k in ("GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GEMINI_API_KEY"):
            v = os.getenv(k)
            if v and v.strip():
                os.environ["AITUBER_GEMINI_API_KEY"] = v
                break

    if not (os.getenv("AITUBER_GEMINI_MODEL") or "").strip():
        for k in ("GEMINI_MODEL", "GOOGLE_GEMINI_MODEL"):
            v = os.getenv(k)
            if v and v.strip():
                os.environ["AITUBER_GEMINI_MODEL"] = v
                break

    if not (os.getenv("AITUBER_OPENAI_API_KEY") or "").strip():
        for k in ("OPENAI_API_KEY", "OPENAI_KEY"):
            v = os.getenv(k)
            if v and v.strip():
                os.environ["AITUBER_OPENAI_API_KEY"] = v
                break

    if not (os.getenv("AITUBER_OPENAI_MODEL") or "").strip():
        for k in ("OPENAI_MODEL",):
            v = os.getenv(k)
            if v and v.strip():
                os.environ["AITUBER_OPENAI_MODEL"] = v
                break

    settings = Settings()
    _apply_console_settings(settings)
    # Prevent console settings from reintroducing other providers.
    settings.llm_provider = "gemini"
    settings.tts_provider = "google"
    return settings


def _coerce_bool(val: object, default: bool) -> bool:
    if isinstance(val, bool):
        return val
    if val is None:
        return default
    if isinstance(val, (int, float)):
        return bool(val)
    s = str(val).strip().lower()
    if s in ("1", "true", "yes", "on"):
        return True
    if s in ("0", "false", "no", "off"):
        return False
    return default


def _coerce_int(val: object, default: int, *, min_value: int, max_value: int) -> int:
    try:
        out = int(val)  # type: ignore[arg-type]
    except Exception:
        return default
    return max(min_value, min(max_value, out))


def _apply_console_settings(settings: Settings) -> None:
    try:
        from apps.main.core.storage import read_json

        path = settings.data_dir / "config" / "console_settings.json"
        raw = read_json(path)
        if not isinstance(raw, dict):
            return

        toggles = raw.get("toggles")
        if isinstance(toggles, dict):
            if "stt" in toggles:
                settings.stt_enabled = _coerce_bool(toggles.get("stt"), settings.stt_enabled)
            if "vlm" in toggles:
                settings.vlm_enabled = _coerce_bool(toggles.get("vlm"), settings.vlm_enabled)
            if "rag" in toggles:
                settings.rag_enabled = _coerce_bool(toggles.get("rag"), settings.rag_enabled)
            if "short_term" in toggles:
                settings.short_term_enabled = _coerce_bool(toggles.get("short_term"), settings.short_term_enabled)

        rag = raw.get("rag")
        if isinstance(rag, dict) and "short_term_max_events" in rag:
            settings.short_term_max_events = _coerce_int(
                rag.get("short_term_max_events"),
                settings.short_term_max_events,
                min_value=0,
                max_value=200,
            )

        if isinstance(rag, dict) and "short_term_turns_to_prompt" in rag:
            settings.short_term_turns_to_prompt = _coerce_int(
                rag.get("short_term_turns_to_prompt"),
                settings.short_term_turns_to_prompt,
                min_value=0,
                max_value=100,
            )

        providers = raw.get("providers")
        if isinstance(providers, dict):
            stt = str(providers.get("stt") or "").strip().lower()
            if stt:
                settings.stt_provider = stt
            llm = str(providers.get("llm") or "").strip().lower()
            if llm:
                settings.llm_provider = llm
            tts = str(providers.get("tts") or "").strip().lower()
            if tts:
                settings.tts_provider = tts
    except Exception:
        return
