from __future__ import annotations

import concurrent.futures
import json
from collections.abc import Sequence
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

    @staticmethod
    def _resp_to_text(resp: Any) -> str:
        """Best-effort extraction of response text.

        Some google-genai SDK versions / response shapes can yield an incomplete
        `resp.text` (e.g., only the first part). Prefer concatenating all text
        parts when available.
        """
        # Fast path: resp.text
        try:
            t = (getattr(resp, "text", None) or "")
            if isinstance(t, str) and t.strip():
                text0 = t.strip()
            else:
                text0 = ""
        except Exception:
            text0 = ""

        def _as_dict(x: Any) -> Optional[Dict[str, Any]]:
            if isinstance(x, dict):
                return x
            try:
                md = getattr(x, "model_dump", None)
                if callable(md):
                    out = md()
                    return out if isinstance(out, dict) else None
            except Exception:
                return None
            return None

        def _is_seq(x: Any) -> bool:
            return isinstance(x, Sequence) and not isinstance(x, (str, bytes, bytearray))

        # Robust path: candidates[*].content.parts[*].text
        parts_text: list[str] = []
        try:
            resp_dict = _as_dict(resp)
            candidates = resp_dict.get("candidates") if resp_dict is not None else getattr(resp, "candidates", None)

            if candidates and _is_seq(candidates):
                for cand in candidates:
                    cand_dict = _as_dict(cand)
                    content = cand_dict.get("content") if cand_dict is not None else getattr(cand, "content", None)

                    content_dict = _as_dict(content)
                    parts = content_dict.get("parts") if content_dict is not None else getattr(content, "parts", None) if content is not None else None

                    if parts and _is_seq(parts):
                        for p in parts:
                            p_dict = _as_dict(p)
                            pt = p_dict.get("text") if p_dict is not None else getattr(p, "text", None)
                            if isinstance(pt, str) and pt:
                                parts_text.append(pt)
        except Exception:
            parts_text = []

        text1 = "".join(parts_text).strip() if parts_text else ""
        # Prefer the longer non-empty extraction.
        if text1 and (not text0 or len(text1) > len(text0)):
            return text1
        return text0

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
                text = self._resp_to_text(resp)
                if not text:
                    last_err = "empty_response"
                    continue

                # Prefer structured JSON (for motion/emotion/safety), but accept
                # plain text if the model doesn't follow schema.
                try:
                    obj = self._extract_json(text)
                    try:
                        return LLMOut.model_validate(obj)
                    except Exception:
                        # Common failure mode: model wraps the answer in {"response": "..."}
                        if isinstance(obj, dict):
                            r = obj.get("response")
                            if isinstance(r, str) and r.strip():
                                return self._wrap_plain_text(text=r, reason="gemini_response_field")
                        raise
                except Exception:
                    return self._wrap_plain_text(text=text, reason="gemini_plain_text")
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

    def _wrap_plain_text(self, *, text: str, reason: str) -> LLMOut:
        t = (text or "").strip()
        if not t:
            t = "（空の返答）"
        overlay = t[:60]
        return LLMOut(
            speech_text=t,
            overlay_text=overlay,
            emotion="neutral",
            motion_tags=["neutral"],
            safety={"needs_manager_approval": True, "notes": reason},
        )

    def _build_prompt(
        self,
        *,
        user_text: str,
        rag_context: str,
        vlm_summary: str,
        system_prompt: Optional[str],
    ) -> str:
        sys = (system_prompt or "").strip() or read_prompt_text(name="llm_system").strip()
        parts: list[str] = []
        ut = (user_text or "").strip()
        if ut:
            parts.append(ut)
        vs = (vlm_summary or "").strip()
        if vs:
            parts.append("[VLM]\n" + vs)
        rc = (rag_context or "").strip()
        if rc:
            parts.append("[RAG]\n" + rc)
        body = "\n\n".join([p for p in parts if p]).strip() or "（入力なし）"
        return (sys + "\n\n" + body).strip() + "\n"

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
