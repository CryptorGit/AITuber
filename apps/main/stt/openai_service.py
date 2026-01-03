from __future__ import annotations

import io
from typing import Optional


def _normalize_language(lang: Optional[str]) -> Optional[str]:
    if not lang:
        return None
    s = str(lang).strip().lower()
    return s or None


def transcribe_audio_via_openai(
    *,
    audio_bytes: bytes,
    filename: str,
    language: Optional[str],
    api_key: str,
    model: str,
) -> str:
    if not (api_key or "").strip():
        raise ValueError("missing_openai_api_key")
    if not audio_bytes:
        return ""

    try:
        from openai import OpenAI
    except Exception:
        return _transcribe_legacy(
            audio_bytes=audio_bytes,
            filename=filename,
            language=language,
            api_key=api_key,
            model=model,
        )

    client = OpenAI(api_key=api_key, timeout=12.0)
    file_obj = io.BytesIO(audio_bytes)
    file_obj.name = filename or "audio.wav"

    kwargs = {"model": model, "file": file_obj}
    lang = _normalize_language(language)
    if lang:
        kwargs["language"] = lang
    resp = client.audio.transcriptions.create(**kwargs)
    text = (resp.text or "").strip()
    return text


def _transcribe_legacy(
    *,
    audio_bytes: bytes,
    filename: str,
    language: Optional[str],
    api_key: str,
    model: str,
) -> str:
    try:
        import openai  # type: ignore
    except Exception as e:
        raise ModuleNotFoundError("openai") from e

    openai.api_key = api_key
    file_obj = io.BytesIO(audio_bytes)
    file_obj.name = filename or "audio.wav"
    kwargs = {"model": model, "file": file_obj}
    lang = _normalize_language(language)
    if lang:
        kwargs["language"] = lang
    resp = openai.Audio.transcribe(**kwargs)
    if isinstance(resp, dict):
        text = resp.get("text") or ""
    else:
        text = getattr(resp, "text", "") or ""
    return str(text).strip()
