from __future__ import annotations

import base64
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional

from core.prompts import read_prompt_text


def _guess_mime_from_header(data: bytes) -> str:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    return "application/octet-stream"


@dataclass
class VLMSummarizer:
    api_key: str
    model: str
    system_prompt: Optional[str] = None
    generation_config: Optional[Dict[str, Any]] = None

    def summarize_screenshot(self, *, screenshot_path: Path) -> str:
        """Summarize screenshot into short Japanese text.

        Uses Gemini multimodal if available; otherwise returns a cheap placeholder.
        """
        if not screenshot_path.exists() or screenshot_path.stat().st_size == 0:
            return "(no image)"

        if not (self.api_key or "").strip():
            return "(vlm not configured: skipped)"

        # Gemini multimodal (optional dependency)
        try:
            from google import genai

            client = genai.Client(api_key=self.api_key)
            data = screenshot_path.read_bytes()

            suffix = screenshot_path.suffix.lower()
            mime = "image/png"
            if suffix in (".jpg", ".jpeg"):
                mime = "image/jpeg"

            prompt = (self.system_prompt or '').strip() or read_prompt_text(name="vlm_system").strip()

            b64 = base64.b64encode(data).decode("ascii")
            kwargs: Dict[str, Any] = {
                "model": self.model,
                "contents": [
                    {
                        "role": "user",
                        "parts": [
                            {"text": prompt},
                            {"inline_data": {"mime_type": mime, "data": b64}},
                        ],
                    }
                ],
            }
            if self.generation_config and isinstance(self.generation_config, dict):
                kwargs["config"] = dict(self.generation_config)
            try:
                resp = client.models.generate_content(**kwargs)
            except TypeError:
                kwargs.pop("config", None)
                resp = client.models.generate_content(**kwargs)
            text = (resp.text or "").strip()
            return text[:300] if text else "(vlm summary empty)"
        except Exception as e:
            msg = f"{type(e).__name__}: {e}"
            return ("(vlm summary failed: " + msg + ")")[:300]

    def summarize_image_bytes(self, *, image_bytes: bytes, mime_type: str | None = None) -> str:
        """Summarize an image already in memory.

        Privacy: this avoids writing frames to disk.
        """
        if not image_bytes:
            return "(no image)"

        if not (self.api_key or "").strip():
            return "(vlm not configured: skipped)"

        mime = (mime_type or "").strip().lower() or _guess_mime_from_header(image_bytes)

        try:
            from google import genai

            client = genai.Client(api_key=self.api_key)

            prompt = (self.system_prompt or '').strip() or read_prompt_text(name="vlm_system").strip()

            b64 = base64.b64encode(image_bytes).decode("ascii")
            kwargs: Dict[str, Any] = {
                "model": self.model,
                "contents": [
                    {
                        "role": "user",
                        "parts": [
                            {"text": prompt},
                            {"inline_data": {"mime_type": mime, "data": b64}},
                        ],
                    }
                ],
            }
            if self.generation_config and isinstance(self.generation_config, dict):
                kwargs["config"] = dict(self.generation_config)
            try:
                resp = client.models.generate_content(**kwargs)
            except TypeError:
                kwargs.pop("config", None)
                resp = client.models.generate_content(**kwargs)
            text = (resp.text or "").strip()
            return text[:300] if text else "(vlm summary empty)"
        except Exception as e:
            msg = f"{type(e).__name__}: {e}"
            return ("(vlm summary failed: " + msg + ")")[:300]
