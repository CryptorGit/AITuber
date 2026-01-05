from __future__ import annotations

from pydantic import BaseModel, Field


class SafetyOut(BaseModel):
    needs_manager_approval: bool = True
    notes: str = ""


class LLMOut(BaseModel):
    speech_text: str = Field(..., min_length=1, max_length=1000)
    overlay_text: str = Field(..., min_length=1, max_length=120)
    emotion: str = Field(default="neutral")
    motion_tags: list[str] = Field(default_factory=list)
    safety: SafetyOut = Field(default_factory=SafetyOut)
