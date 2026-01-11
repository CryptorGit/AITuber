from __future__ import annotations

from dataclasses import dataclass

from apps.stream_studio.core.types import DirectorOutput


@dataclass
class LLMClient:
    """LLM client stub.

    Replace with a real provider implementation later.
    """

    provider: str
    api_key: str
    model: str

    def generate(self, *, user_text: str) -> DirectorOutput:
        # Real implementation would call an LLM and parse/validate JSON.
        raise NotImplementedError("LLMClient.generate is not implemented (stub)")
