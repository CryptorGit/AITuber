from __future__ import annotations

import concurrent.futures
import json
from dataclasses import dataclass
from typing import Any, Dict, Optional

from apps.main.core.prompts import read_prompt_text
from apps.main.llm.mvp_models import LLMOut


@dataclass
class GeminiMVP:
    api_key: str
    model: str
    system_prompt: Optional[str] = None
    generation_config: Optional[Dict[str, Any]] = None

    def generate(self, *, user_text: str, rag_context: str, vlm_summary: str) -> LLMOut:
        return self.generate_full(user_text=user_text, rag_context=rag_context, vlm_summary=vlm_summary)

    def generate_fast_ack(self, *, user_text: str, rag_context: str, vlm_summary: str) -> LLMOut:
        _ = (rag_context, vlm_summary)
        ack = "了解。"
        return LLMOut(
            speech_text=ack,
            overlay_text=ack,
            emotion="neutral",
            motion_tags=["nod"],
            safety={"needs_manager_approval": False, "notes": "ack"},
        )

    def generate_full(self, *, user_text: str, rag_context: str, vlm_summary: str) -> LLMOut:
        """Return a validated structured output.

        Gracefully falls back to a safe deterministic output when Gemini isn't usable.
        """
        if not (self.api_key or "").strip():
            return self._fallback(user_text=user_text, reason="missing_api_key")

        prompt = self._build_prompt(
            user_text=user_text,
            rag_context=rag_context,
            vlm_summary=vlm_summary,
            system_prompt=self.system_prompt,
        )

        # Hard timeout for external API calls.
        # Windows-compatible (no signal alarm). If the SDK blocks due to retries/backoff,
        # we fall back quickly so the server stays responsive.
        timeout_seconds = 12

        last_err: Optional[str] = None
        for _attempt in range(2):
            try:
                from google import genai

                client = genai.Client(api_key=self.api_key)

                def _call() -> Any:
                    kwargs: Dict[str, Any] = {
                        "model": self.model,
                        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                    }
                    if self.generation_config and isinstance(self.generation_config, dict):
                        kwargs["config"] = dict(self.generation_config)
                    try:
                        return client.models.generate_content(**kwargs)
                    except TypeError:
                        # Older SDK variants may not accept config; retry without.
                        kwargs.pop("config", None)
                        return client.models.generate_content(**kwargs)

                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
                    fut = ex.submit(_call)
                    resp = fut.result(timeout=timeout_seconds)
                text = (resp.text or "").strip()
                obj = self._extract_json(text)
                return LLMOut.model_validate(obj)
            except concurrent.futures.TimeoutError:
                last_err = f"TimeoutError: gemini call exceeded {timeout_seconds}s"
                continue
            except Exception as e:
                last_err = f"{type(e).__name__}: {e}"
                continue

        reason = "gemini_failed"
        if last_err:
            reason = (reason + " | " + last_err)[:220]
        return self._fallback(user_text=user_text, reason=reason)

    def _build_prompt(
        self,
        *,
        user_text: str,
        rag_context: str,
        vlm_summary: str,
        system_prompt: Optional[str],
    ) -> str:
        sys = (system_prompt or "").strip() or read_prompt_text(name="llm_system").strip()
        instr = read_prompt_text(name="gemini_json_instructions").strip()
        if not instr:
            instr = "必ずJSONのみを出力してください。"
        return (
            sys
            + "\n"
            + instr
            + "\n\n"
            "# 入力\n"
            f"user_text: {user_text}\n\n"
            "# VLM要約（スクショ）\n"
            f"vlm_summary: {vlm_summary}\n\n"
            "# RAG文脈（短期/長期の抜粋）\n"
            f"rag_context:\n{rag_context}\n\n"
        )

    def _extract_json(self, text: str) -> Dict[str, Any]:
        try:
            return json.loads(text)
        except Exception:
            pass

        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            return json.loads(text[start : end + 1])
        raise ValueError("No JSON found")

    def _fallback(self, *, user_text: str, reason: str) -> LLMOut:
        t = (user_text or "").strip() or "（入力なし）"
        overlay = t[:60]
        return LLMOut(
            speech_text=f"了解。{t}",
            overlay_text=overlay,
            emotion="neutral",
            motion_tags=["neutral"],
            safety={"needs_manager_approval": True, "notes": reason},
        )
