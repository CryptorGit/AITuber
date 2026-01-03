from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Dict, Optional

from apps.main.llm.mvp_models import LLMOut

from apps.main.core.prompts import read_prompt_text


@dataclass
class OpenAIChatMVP:
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
        """Return a validated structured output using OpenAI chat completions."""
        if not (self.api_key or "").strip():
            return self._fallback(user_text=user_text, reason="missing_api_key")

        prompt = self._build_prompt(
            user_text=user_text,
            rag_context=rag_context,
            vlm_summary=vlm_summary,
            system_prompt=self.system_prompt,
        )

        try:
            text = self._call_openai(prompt=prompt)
            obj = self._extract_json(text)
            return LLMOut.model_validate(obj)
        except Exception as e:
            reason = f"openai_failed | {type(e).__name__}: {e}"[:220]
            return self._fallback(user_text=user_text, reason=reason)

    def _call_openai(self, *, prompt: str) -> str:
        sys = (self.system_prompt or "").strip() or read_prompt_text(name="llm_system").strip()
        messages = [
            {"role": "system", "content": sys},
            {"role": "user", "content": prompt},
        ]
        params = self._map_generation_config()

        try:
            from openai import OpenAI
        except Exception:
            return self._call_legacy(messages=messages, params=params)

        client = OpenAI(api_key=self.api_key, timeout=12.0)
        stream = client.chat.completions.create(
            model=self.model,
            messages=messages,
            stream=True,
            **params,
        )
        chunks: list[str] = []
        for chunk in stream:
            delta = chunk.choices[0].delta
            content = ""
            if isinstance(delta, dict):
                content = delta.get("content") or ""
            else:
                content = getattr(delta, "content", "") or ""
            if content:
                chunks.append(content)
        return "".join(chunks).strip()

    def _call_legacy(self, *, messages: list[dict[str, str]], params: Dict[str, Any]) -> str:
        try:
            import openai  # type: ignore
        except Exception as e:
            raise ModuleNotFoundError("openai") from e

        openai.api_key = self.api_key
        stream = openai.ChatCompletion.create(
            model=self.model,
            messages=messages,
            stream=True,
            request_timeout=12.0,
            **params,
        )
        chunks: list[str] = []
        for chunk in stream:
            choice = (chunk.get("choices") or [{}])[0]
            delta = choice.get("delta") or {}
            content = delta.get("content") or ""
            if content:
                chunks.append(content)
        return "".join(chunks).strip()

    def _map_generation_config(self) -> Dict[str, Any]:
        cfg = self.generation_config or {}
        out: Dict[str, Any] = {}
        if "temperature" in cfg:
            val = cfg.get("temperature")
            if val is not None:
                out["temperature"] = val
        if "top_p" in cfg:
            val = cfg.get("top_p")
            if val is not None:
                out["top_p"] = val
        if "max_output_tokens" in cfg:
            val = cfg.get("max_output_tokens")
            if val is not None:
                out["max_tokens"] = val
        return out

    def _build_prompt(
        self,
        *,
        user_text: str,
        rag_context: str,
        vlm_summary: str,
        system_prompt: Optional[str],
    ) -> str:
        _ = system_prompt  # system prompt is passed via messages, keep for signature parity
        return (
            "Return JSON only. No prose or code fences.\n\n"
            "# Input\n"
            f"user_text: {user_text}\n\n"
            "# VLM summary\n"
            f"vlm_summary: {vlm_summary}\n\n"
            "# RAG context\n"
            f"rag_context:\n{rag_context}\n\n"
            "# Output JSON schema\n"
            "{\n"
            '  \"speech_text\": \"Short text for TTS (<=400 chars)\",\n'
            '  \"overlay_text\": \"Short overlay text (<=120 chars)\",\n'
            '  \"emotion\": \"neutral|happy|angry|sad|excited|confused\",\n'
            '  \"motion_tags\": [\"greet\",\"laugh\",\"think\",\"nod\",\"smile\",\"neutral\"],\n'
            '  \"safety\": {\"needs_manager_approval\": true, \"notes\": \"\"}\n'
            "}\n\n"
            "Constraints: avoid personal data, keep it concise."
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
        t = (user_text or "").strip() or "No input"
        overlay = t[:60]
        return LLMOut(
            speech_text=f"了解。{t}",
            overlay_text=overlay,
            emotion="neutral",
            motion_tags=["neutral"],
            safety={"needs_manager_approval": True, "notes": reason},
        )
