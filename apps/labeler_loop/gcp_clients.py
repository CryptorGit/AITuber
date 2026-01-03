from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from google.protobuf.json_format import MessageToDict

from env_loader import load_env_files


def transcribe_wav(wav_path: Path) -> tuple[str, dict[str, Any]]:
    load_env_files(Path(__file__).resolve().parent)

    creds = (os.getenv("GOOGLE_APPLICATION_CREDENTIALS") or "").strip().strip('"')
    if not creds:
        raise RuntimeError(
            "GOOGLE_APPLICATION_CREDENTIALS is not set. Put the service-account JSON path into .env/.env.labeler_loop"
        )
    if not Path(creds).exists():
        raise RuntimeError(f"GOOGLE_APPLICATION_CREDENTIALS points to missing file: {creds}")

    from google.cloud import speech  # imported lazily

    language_code = os.getenv("STT_LANGUAGE_CODE", "ja-JP")

    client = speech.SpeechClient()
    audio = speech.RecognitionAudio(content=wav_path.read_bytes())
    config = speech.RecognitionConfig(
        encoding=speech.RecognitionConfig.AudioEncoding.LINEAR16,
        sample_rate_hertz=16000,
        language_code=language_code,
        enable_automatic_punctuation=True,
    )

    resp = client.recognize(config=config, audio=audio)

    text_parts: list[str] = []
    for result in resp.results:
        if result.alternatives:
            text_parts.append(result.alternatives[0].transcript)
    text = "".join(text_parts).strip()

    raw = MessageToDict(resp._pb)  # type: ignore[attr-defined]
    return text, raw


def _build_prompt(input_text: str, fewshot_used: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    lines.append("あなたは日本語の会話用アシスタント。ユーザーの発話に対し、返答候補を5つ作る。")
    lines.append("重要: 出力はJSONのみ。説明文やコードフェンスは禁止。")
    lines.append("重要: 以下の制約を必ず守る:")
    lines.append("- 例と同じ言い回しをそのままコピーしない")
    lines.append("- 固有名詞は変える（同一人物/団体/作品名に依存しない）")
    lines.append("- 各候補は2〜4連撃（2〜4文）で、最後は短い巻き取りで終える")
    lines.append("- 口調は自然で、テンポ良く")

    if fewshot_used:
        lines.append("\n参考例（真似しすぎ禁止、構造だけ参考）:")
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
            {"text": "..."},
            {"text": "..."},
            {"text": "..."},
            {"text": "..."},
            {"text": "..."},
        ]
    }

    lines.append("\nユーザー発話:")
    lines.append(input_text.strip())
    lines.append("\n必ず次のJSONスキーマに一致するJSONだけを返せ:")
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
            return obj, (last_raw or {})
        except (json.JSONDecodeError, ValueError) as e:
            last_err = e
            # Try again (up to 2 retries)
            continue
        except Exception as e:
            # Non-JSON errors (auth/model/network/etc) should fail fast.
            raise

    raise RuntimeError(f"Model returned invalid JSON after retries: {last_err}")
