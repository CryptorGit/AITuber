from __future__ import annotations

import hashlib
import json
import os
import threading
from pathlib import Path
from typing import Any

from env_loader import load_env_files
from prompt_loader import read_labeler_prompt


_whisper_lock = threading.Lock()
_whisper_model = None
_whisper_cfg: tuple[str, str, str] | None = None


def _get_whisper_model(*, model: str, device: str, compute_type: str):
    global _whisper_model, _whisper_cfg
    key = (model, device, compute_type)
    with _whisper_lock:
        if _whisper_model is None or _whisper_cfg != key:
            from faster_whisper import WhisperModel

            _whisper_model = WhisperModel(model, device=device, compute_type=compute_type)
            _whisper_cfg = key
        return _whisper_model


def _normalize_language_code(raw: str) -> str:
    s = (raw or "").strip()
    if not s:
        return "ja"
    # Accept ja-JP / en-US / etc.
    return s.split("-")[0].lower() or "ja"


def _resample_float32_mono(audio_f32, sample_rate: int, target_sr: int = 16000):
    import numpy as np

    if audio_f32 is None or getattr(audio_f32, "size", 0) == 0:
        return audio_f32, sample_rate
    if sample_rate == target_sr:
        return audio_f32, sample_rate

    duration = float(audio_f32.size) / float(sample_rate)
    target_len = int(round(duration * float(target_sr)))
    if target_len <= 0:
        return audio_f32, sample_rate

    x_old = np.linspace(0.0, duration, num=audio_f32.size, endpoint=False)
    x_new = np.linspace(0.0, duration, num=target_len, endpoint=False)
    out = np.interp(x_new, x_old, audio_f32).astype(np.float32)
    return out, target_sr


def transcribe_wav(wav_path: Path) -> tuple[str, dict[str, Any]]:
    load_env_files(Path(__file__).resolve().parent)

    # Parse WAV into float32 mono.
    try:
        import io
        import wave
        import numpy as np

        raw_wav = wav_path.read_bytes()
        with wave.open(io.BytesIO(raw_wav), "rb") as wf:
            channels = int(wf.getnchannels())
            sampwidth = int(wf.getsampwidth())
            sample_rate = int(wf.getframerate())
            n_frames = int(wf.getnframes())
            frames = wf.readframes(n_frames)

        if sampwidth != 2:
            raise RuntimeError(f"unsupported_sampwidth:{sampwidth}")

        audio_i16 = np.frombuffer(frames, dtype=np.int16)
        if channels > 1:
            audio_i16 = audio_i16.reshape(-1, channels).mean(axis=1).astype(np.int16)
        audio_f32 = (audio_i16.astype(np.float32) / 32768.0).clip(-1.0, 1.0)
    except Exception as e:
        raise RuntimeError(f"invalid_wav:{type(e).__name__}") from e

    language = _normalize_language_code(os.getenv("STT_LANGUAGE_CODE", "ja-JP"))

    device_choice = (os.getenv("AITUBER_WHISPER_DEVICE") or os.getenv("WHISPER_DEVICE") or "cpu").strip().lower()
    device = "cuda" if device_choice in ("gpu", "cuda") else "cpu"
    compute_type = "float16" if device == "cuda" else "int8"
    model_name = "large-v3-turbo"

    # Resample to 16kHz for Whisper.
    audio_16k, sr = _resample_float32_mono(audio_f32, sample_rate, 16000)

    model = _get_whisper_model(model=model_name, device=device, compute_type=compute_type)
    segments, info = model.transcribe(
        audio_16k,
        language=language or None,
        vad_filter=True,
    )
    text = "".join((s.text or "") for s in segments).strip()

    meta: dict[str, Any] = {
        "provider": "whisper",
        "model": model_name,
        "device": device,
        "compute_type": compute_type,
        "language": language,
        "sample_rate": int(sr),
    }
    try:
        meta["duration"] = float(getattr(info, "duration", 0.0) or 0.0)
        meta["language_probability"] = float(getattr(info, "language_probability", 0.0) or 0.0)
    except Exception:
        pass
    return text, meta


def _build_prompt(input_text: str, fewshot_used: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    cfg = read_labeler_prompt(section="candidate_generation")
    for s in (cfg.get("preamble_lines") if isinstance(cfg.get("preamble_lines"), list) else []):
        if isinstance(s, str) and s:
            lines.append(s)

    # Fixed modes (MUST output exactly once each, in this order)
    lines.append(str(cfg.get("modes_header") or "").rstrip())
    modes = cfg.get("modes") if isinstance(cfg.get("modes"), list) else []
    for item in modes:
        if not isinstance(item, dict):
            continue
        m = str(item.get("mode") or "").strip()
        d = str(item.get("desc") or "").strip()
        ex = str(item.get("style_example") or "").strip()
        if m and d and ex:
            lines.append(f"- {m}: {d} (style例: {ex})")

    style_line = str(cfg.get("style_line") or "").rstrip()
    if style_line:
        lines.append(style_line)
    diversity_line = str(cfg.get("diversity_line") or "").rstrip()
    if diversity_line:
        lines.append(diversity_line)

    if fewshot_used:
        fewshot_header = str(cfg.get("fewshot_header") or "").rstrip() or "\n"
        lines.append(fewshot_header)
        for ex in fewshot_used:
            ex_in = str(ex.get("input") or "")
            ex_win = str(ex.get("winner") or "")
            ex_id = str(ex.get("id") or "")
            if not ex_in or not ex_win:
                continue
            lines.append(f"- id={ex_id}")
            lines.append(f"  input: {ex_in}")
            lines.append(f"  winner: {ex_win}")

    schema = {
        "candidates": [
            {"mode": "NETWORK", "style": "comedic_tease", "text": "..."},
            {"mode": "EMOTIONAL", "style": "warm", "text": "..."},
            {"mode": "ESTEEM", "style": "hype", "text": "..."},
            {"mode": "INFORMATIONAL", "style": "practical", "text": "..."},
            {"mode": "TANGIBLE", "style": "actionable", "text": "..."},
        ]
    }

    user_header = str(cfg.get("user_header") or "").rstrip() or "\n"
    lines.append(user_header)
    lines.append(input_text.strip())
    schema_header = str(cfg.get("schema_header") or "").rstrip() or "\n"
    lines.append(schema_header)
    lines.append(json.dumps(schema, ensure_ascii=False))

    return "\n".join(lines)


def _extract_text_from_response(resp: Any) -> str:
    # google-genai: resp.text
    txt = getattr(resp, "text", None)
    if isinstance(txt, str) and txt.strip():
        return txt

    # google-generativeai: resp.text
    if isinstance(txt, str):
        return txt

    # best-effort fallback
    return str(resp)


def _looks_like_model_not_found(err: Exception) -> bool:
    s = str(err).lower()
    return (
        "model" in s
        and ("not found" in s or "404" in s)
        and ("models/" in s or "models\\" in s)
    )


def _list_models_genai(client: Any, limit: int = 30) -> list[str]:
    names: list[str] = []
    try:
        it = client.models.list()
        for m in it:
            name = getattr(m, "name", None) or getattr(m, "model", None)
            if isinstance(name, str) and name:
                names.append(name)
            if len(names) >= limit:
                break
    except Exception:
        return []
    return names


def _try_generate_with_models(client: Any, types_mod: Any, models: list[str], prompt: str, temperature: float) -> tuple[str, dict[str, Any]]:
    last: Exception | None = None
    for m in models:
        try:
            resp = client.models.generate_content(
                model=m,
                contents=prompt,
                config=types_mod.GenerateContentConfig(
                    temperature=temperature,
                    response_mime_type="application/json",
                ),
            )
            text = _extract_text_from_response(resp)
            raw = {
                "provider": "google-genai",
                "model": m,
                "temperature": temperature,
                "params": {
                    "temperature": temperature,
                    "response_mime_type": "application/json",
                    "candidate_count": 5,
                },
                "text": text,
            }
            return text, raw
        except Exception as e:
            last = e
            continue
    raise RuntimeError(f"All candidate models failed: {last}")


def _genai_generate(prompt: str) -> tuple[str, dict[str, Any]]:
    load_env_files(Path(__file__).resolve().parent)

    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY (or GOOGLE_API_KEY) is not set")

    model = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")
    temperature = float(os.getenv("GEMINI_TEMPERATURE", "0.8"))

    # Prefer modern google-genai.
    # IMPORTANT: Do not silently fall back to older v1beta clients, because model
    # availability/method support differs and causes confusing 404s.
    try:
        from google import genai  # type: ignore
        from google.genai import types  # type: ignore

        client = genai.Client(api_key=api_key)

        # First try the configured model.
        try:
            return _try_generate_with_models(client, types, [model], prompt, temperature)
        except Exception as e:
            # If the model isn't supported/doesn't exist, try to auto-pick.
            if _looks_like_model_not_found(e):
                available = _list_models_genai(client)
                fallback_order = [
                    "gemini-2.0-flash",
                    "gemini-2.0-flash-exp",
                    "gemini-1.5-flash",
                    "gemini-1.5-flash-latest",
                    "gemini-1.5-pro",
                    "gemini-1.5-pro-latest",
                ]
                # Prefer known names, then whatever the API returns.
                candidates = [m for m in fallback_order if m in (available or fallback_order)]
                if available:
                    for m in available:
                        if m not in candidates:
                            candidates.append(m)
                try:
                    return _try_generate_with_models(client, types, candidates, prompt, temperature)
                except Exception as e2:
                    hint = ""
                    if available:
                        hint = " Available models: " + ", ".join(available[:10])
                    raise RuntimeError(
                        f"Configured GEMINI_MODEL '{model}' is not supported/available. Set GEMINI_MODEL to a working model.{hint} (last error: {e2})"
                    )
            raise
    except ImportError as e:
        raise RuntimeError(f"google-genai is not available in this environment: {e}")
    except Exception as e:
        raise RuntimeError(f"Gemini call failed: {e}")


def generate_candidates_json(
    input_text: str,
    fewshot_used: list[dict[str, Any]],
) -> tuple[dict[str, Any], dict[str, Any]]:
    prompt = _build_prompt(input_text=input_text, fewshot_used=fewshot_used)
    prompt_hash = "sha256:" + hashlib.sha256(prompt.encode("utf-8")).hexdigest()

    last_err: Exception | None = None
    last_raw: dict[str, Any] | None = None

    # Retry is ONLY for malformed JSON (model didn't obey schema).
    for attempt in range(3):
        try:
            text, raw = _genai_generate(prompt)
            last_raw = raw
            obj = json.loads(text)
            if not isinstance(obj, dict) or "candidates" not in obj:
                raise ValueError("JSON missing 'candidates'")
            enriched = dict(last_raw or {})
            enriched.setdefault("prompt_hash", prompt_hash)
            # Ensure candidate_count is always available.
            if isinstance(enriched.get("params"), dict):
                enriched["params"].setdefault("candidate_count", 5)
            else:
                enriched["params"] = {"candidate_count": 5}
            return obj, enriched
        except (json.JSONDecodeError, ValueError) as e:
            last_err = e
            # Try again (up to 2 retries)
            continue
        except Exception as e:
            # Non-JSON errors (auth/model/network/etc) should fail fast.
            raise

    raise RuntimeError(f"Model returned invalid JSON after retries: {last_err}")


def regenerate_candidates_json(
    input_text: str,
    fewshot_used: list[dict[str, Any]],
    existing_candidates: list[dict[str, Any]],
    regen_modes: list[str],
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Regenerate ONLY selected modes.

    Returns JSON: {"candidates": [{"mode": ..., "text": ...}, ...]} for the requested modes.
    """

    lines: list[str] = []
    cfg = read_labeler_prompt(section="regen_generation")
    for s in (cfg.get("preamble_lines") if isinstance(cfg.get("preamble_lines"), list) else []):
        if isinstance(s, str) and s:
            lines.append(s)

    # Provide existing candidates to forbid overlaps.
    existing_header = str(cfg.get("existing_header") or "").rstrip() or "\n"
    lines.append(existing_header)
    for c in existing_candidates:
        m = str(c.get("mode") or "")
        t = str(c.get("text") or "")
        if not m or not t:
            continue
        lines.append(f"- {m}: {t}")

    user_header = str(cfg.get("user_header") or "").rstrip() or "\n"
    lines.append(user_header)
    lines.append(input_text.strip())

    regen_modes_header = str(cfg.get("regen_modes_header") or "").rstrip() or "\n"
    lines.append(regen_modes_header)
    for m in regen_modes:
        lines.append(f"- {m}")

    schema = {
        "candidates": [{"mode": "<one_of_requested_modes>", "text": "..."}],
    }
    schema_header = str(cfg.get("schema_header") or "").rstrip() or "\n"
    lines.append(schema_header)
    lines.append(json.dumps(schema, ensure_ascii=False))

    prompt = "\n".join(lines)
    prompt_hash = "sha256:" + hashlib.sha256(prompt.encode("utf-8")).hexdigest()

    last_err: Exception | None = None
    last_raw: dict[str, Any] | None = None
    for _attempt in range(3):
        try:
            text, raw = _genai_generate(prompt)
            last_raw = raw
            obj = json.loads(text)
            if not isinstance(obj, dict) or "candidates" not in obj:
                raise ValueError("JSON missing 'candidates'")
            enriched = dict(last_raw or {})
            enriched.setdefault("prompt_hash", prompt_hash)
            if isinstance(enriched.get("params"), dict):
                enriched["params"].setdefault("candidate_count", 5)
            else:
                enriched["params"] = {"candidate_count": 5}
            return obj, enriched
        except (json.JSONDecodeError, ValueError) as e:
            last_err = e
            continue

    raise RuntimeError(f"Model returned invalid JSON after retries: {last_err}")
