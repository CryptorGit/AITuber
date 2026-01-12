from __future__ import annotations

import concurrent.futures
import json
import os
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional

import threading

from pydantic import BaseModel, Field


class AnimationSelectOut(BaseModel):
    expression: str = Field(default="")
    motion: str = Field(default="")
    reset_after_tts: bool = Field(default=True)
    reason: str = Field(default="")
    elapsed_ms: int = Field(default=0)


@dataclass
class AnimationLLMConfig:
    enabled: bool = False
    provider: str = "gemini"
    model: str = "gemini-2.0-flash-lite"
    temperature: float = 0.2
    max_output_tokens: int = 128
    system_prompt: str = ""
    json_strict: bool = True


def _extract_json(text: str) -> Dict[str, Any]:
    try:
        return json.loads(text)
    except Exception:
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        return json.loads(text[start : end + 1])
    raise ValueError("No JSON found")


def _fallback(*, reason: str, elapsed_ms: int = 0) -> AnimationSelectOut:
    return AnimationSelectOut(
        expression="",
        motion="",
        reset_after_tts=True,
        reason=(reason or "fallback")[:200],
        elapsed_ms=int(elapsed_ms) if elapsed_ms is not None else 0,
    )


def _heuristic_expression(text: str) -> str:
    t = (text or "").strip()
    if not t:
        return "exp_01"  # neutral

    # Very simple emotion heuristics (used only when LLM is unavailable).
    # These IDs exist in mao_pro_en (exp_01..exp_08). Other models may ignore.
    angry = ("怒", "ぷん", "ムカ", "むか", "許さ", "許し", "許せ", "バカ", "ばか", "禁止", "だめ", "腹立", "イラ", "いら")
    sad = ("泣", "悲", "つら", "辛", "寂", "しょぼ", "ごめ", "すみません")
    sleepy = ("眠", "ねむ", "寝", "おやすみ")
    happy = ("笑", "嬉", "うれ", "やった", "最高", "かわいい", "すごい")

    if any(k in t for k in angry):
        return "exp_07"  # frown / angry-ish on mao_pro
    if any(k in t for k in sad):
        return "exp_05"  # worried/sad-ish on mao_pro
    if any(k in t for k in sleepy):
        return "exp_03"  # eyes closed (non-smile)
    if any(k in t for k in happy):
        return "exp_04"  # bright/sparkly smile-ish

    return "exp_01"


def _heuristic_fallback(
    *,
    reason: str,
    elapsed_ms: int,
    user_text: str,
    overlay_text: str,
    speech_text: str,
) -> AnimationSelectOut:
    # Prefer speech_text because it's what will be spoken.
    basis = (speech_text or "").strip() or (overlay_text or "").strip() or (user_text or "").strip()
    exp = _heuristic_expression(basis)
    return AnimationSelectOut(
        expression=exp,
        motion="Idle",
        reset_after_tts=True,
        reason=("heuristic|" + (reason or "fallback"))[:200],
        elapsed_ms=int(elapsed_ms) if elapsed_ms is not None else 0,
    )


_cooldown_lock = threading.Lock()
_cooldown_until: float = 0.0


def _in_cooldown() -> bool:
    with _cooldown_lock:
        return time.time() < _cooldown_until


def _start_cooldown() -> None:
    try:
        sec = float((os.getenv("AITUBER_ANIM_LLM_COOLDOWN_SEC", "") or "").strip() or "30")
    except Exception:
        sec = 30.0
    sec = max(5.0, min(300.0, sec))
    with _cooldown_lock:
        global _cooldown_until
        _cooldown_until = max(_cooldown_until, time.time() + sec)


def _call_gemini_text(
    *,
    api_key: str,
    model: str,
    system_prompt: str,
    user_text: str,
    generation_config: Dict[str, Any],
) -> str:
    from google import genai

    client = genai.Client(api_key=api_key)
    kwargs: Dict[str, Any] = {
        "model": model,
        "contents": [{"role": "user", "parts": [{"text": user_text}]}],
    }

    config: Dict[str, Any] = {}
    if generation_config:
        config.update(dict(generation_config))
    if system_prompt:
        config["system_instruction"] = system_prompt
    if config:
        kwargs["config"] = config

    resp = client.models.generate_content(**kwargs)

    # Fast path: resp.text
    try:
        t = getattr(resp, "text", None) or ""
        if isinstance(t, str) and t.strip():
            return t.strip()
    except Exception:
        pass

    # Robust path: candidates[*].content.parts[*].text
    try:
        md = getattr(resp, "model_dump", None)
        if callable(md):
            d = md()
            cands = d.get("candidates") if isinstance(d, dict) else None
            if cands and isinstance(cands, list):
                parts: list[str] = []
                for cand in cands:
                    content = (cand or {}).get("content") if isinstance(cand, dict) else None
                    ps = (content or {}).get("parts") if isinstance(content, dict) else None
                    if ps and isinstance(ps, list):
                        for p in ps:
                            tx = (p or {}).get("text") if isinstance(p, dict) else None
                            if isinstance(tx, str) and tx:
                                parts.append(tx)
                joined = "".join(parts).strip()
                if joined:
                    return joined
    except Exception:
        pass

    return ""


def select_animation(
    *,
    api_key: str,
    config: AnimationLLMConfig,
    user_text: str,
    overlay_text: str,
    speech_text: str,
) -> AnimationSelectOut:
    t0 = time.perf_counter()

    if not config.enabled:
        dt_ms = int((time.perf_counter() - t0) * 1000)
        return _fallback(reason="disabled", elapsed_ms=dt_ms)

    provider = (config.provider or "").strip().lower() or "gemini"
    if provider != "gemini":
        dt_ms = int((time.perf_counter() - t0) * 1000)
        return _fallback(reason=f"unsupported_provider:{provider}", elapsed_ms=dt_ms)

    if not (api_key or "").strip():
        dt_ms = int((time.perf_counter() - t0) * 1000)
        return _fallback(reason="missing_api_key", elapsed_ms=dt_ms)

    # If we've recently been rate-limited, skip calling the LLM for a bit.
    if _in_cooldown():
        dt_ms = int((time.perf_counter() - t0) * 1000)
        return _heuristic_fallback(
            reason="cooldown_active",
            elapsed_ms=dt_ms,
            user_text=user_text,
            overlay_text=overlay_text,
            speech_text=speech_text,
        )

    sys = (config.system_prompt or "").strip()
    strict_line = (
        "Return ONLY valid JSON. Do not wrap in markdown."
        if config.json_strict
        else "Return JSON if possible."
    )

    prompt = (
        "You are an animation selector for a Live2D avatar. "
        "Choose an expression and a motion tag suitable for the currently spoken line.\n"
        f"{strict_line}\n\n"
        "Schema:\n"
        "{\"expression\": string, \"motion\": string, \"reset_after_tts\": boolean, \"reason\": string}\n\n"
        "Guidelines:\n"
        "- expression: an identifier like exp_01 (empty string means no change)\n"
        "- motion: a motion tag like IDLE_DEFAULT (empty string means no motion)\n"
        "- reset_after_tts: true to reset to default when TTS ends\n\n"
        "Context (may be partial):\n"
        f"[user_text]\n{(user_text or '').strip()}\n\n"
        f"[overlay_text]\n{(overlay_text or '').strip()}\n\n"
        f"[speech_text]\n{(speech_text or '').strip()}\n"
    ).strip()

    # This endpoint is called during TTS playback; it must be fast.
    # Keep a small hard timeout and fall back if the model is slow.
    # For diagnostics, allow overriding via env var.
    timeout_seconds = 2.5
    try:
        v = (os.getenv("AITUBER_ANIM_LLM_TIMEOUT_SEC", "") or "").strip()
        if v:
            timeout_seconds = float(v)
    except Exception:
        pass
    timeout_seconds = max(0.5, min(15.0, float(timeout_seconds)))
    gen_cfg: Dict[str, Any] = {
        "temperature": float(config.temperature),
        "max_output_tokens": int(config.max_output_tokens),
    }

    last_err: Optional[str] = None
    try:
        ex = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        fut = ex.submit(
            _call_gemini_text,
            api_key=api_key,
            model=config.model,
            system_prompt=sys,
            user_text=prompt,
            generation_config=gen_cfg,
        )
        try:
            text = fut.result(timeout=timeout_seconds)
        finally:
            # IMPORTANT: If the LLM call is hung, the worker thread may not stop.
            # Never block request completion waiting for executor teardown.
            try:
                fut.cancel()
            except Exception:
                pass
            ex.shutdown(wait=False, cancel_futures=True)

        if not text:
            last_err = "empty_response"
            dt_ms = int((time.perf_counter() - t0) * 1000)
            return _heuristic_fallback(
                reason=("anim_select_failed|" + last_err)[:200],
                elapsed_ms=dt_ms,
                user_text=user_text,
                overlay_text=overlay_text,
                speech_text=speech_text,
            )

        obj = _extract_json(text)
        out = AnimationSelectOut.model_validate(obj)
        dt_ms = int((time.perf_counter() - t0) * 1000)
        try:
            out.elapsed_ms = dt_ms
        except Exception:
            pass
        return out
    except concurrent.futures.TimeoutError:
        last_err = f"TimeoutError:{timeout_seconds}s"
    except Exception as e:
        last_err = f"{type(e).__name__}:{e}"

    dt_ms = int((time.perf_counter() - t0) * 1000)
    if last_err and ("RESOURCE_EXHAUSTED" in last_err or "429" in last_err):
        _start_cooldown()
        return _heuristic_fallback(
            reason=("anim_select_failed|rate_limited|" + last_err)[:200],
            elapsed_ms=dt_ms,
            user_text=user_text,
            overlay_text=overlay_text,
            speech_text=speech_text,
        )
    if last_err and last_err.startswith("TimeoutError"):
        return _heuristic_fallback(
            reason=("anim_select_failed|" + (last_err or "unknown"))[:200],
            elapsed_ms=dt_ms,
            user_text=user_text,
            overlay_text=overlay_text,
            speech_text=speech_text,
        )
    return _fallback(reason=("anim_select_failed|" + (last_err or "unknown"))[:200], elapsed_ms=dt_ms)
