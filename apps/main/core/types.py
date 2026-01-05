from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class Emotion(str, Enum):
    neutral = "neutral"
    happy = "happy"
    angry = "angry"
    sad = "sad"
    surprised = "surprised"
    smug = "smug"
    panic = "panic"


class ReplyTo(BaseModel):
    type: Literal["chat", "system", "manager"]
    id: Optional[str] = None


class DirectorDebug(BaseModel):
    reason: Optional[str] = None


class DirectorOutput(BaseModel):
    text: str = Field(..., description="発話本文（短文）")
    emotion: Emotion
    motion_tags: List[str] = Field(default_factory=list)
    reply_to: ReplyTo
    debug: DirectorDebug = Field(default_factory=DirectorDebug)

    def to_json_dict(self) -> Dict[str, Any]:
        return self.model_dump(mode="json")


# --- MVP (server) schemas ---


class SafetyModel(BaseModel):
    needs_manager_approval: bool = True
    notes: Optional[str] = None


class AssistantOutput(BaseModel):
    """Structured output produced by LLM and validated before approval."""

    speech_text: str = Field(..., min_length=1, max_length=1000)
    overlay_text: str = Field(..., min_length=1, max_length=120)
    emotion: str = Field(default="neutral")
    motion_tags: List[str] = Field(default_factory=list)
    safety: SafetyModel = Field(default_factory=SafetyModel)


class EventIn(BaseModel):
    source: Literal["stub", "youtube", "system", "manager", "vlm", "stt", "web"] = "stub"
    text: str = Field(default="")
    include_vlm: bool = Field(default=False)
    vlm_summary: Optional[str] = Field(
        default=None,
        description="Optional VLM summary provided by the client when include_vlm=true",
    )
    vlm_image_path: Optional[str] = Field(
        default=None,
        description="Optional path to an existing image file to summarize when include_vlm=true",
    )
    vlm_image_base64: Optional[str] = Field(
        default=None,
        description="Optional base64 or data URL image from the browser camera when include_vlm=true",
    )
    llm_provider: Optional[str] = Field(
        default=None,
        description="Optional LLM provider override (currently locked to gemini in Web UI flow)",
    )
    tts_provider: Optional[str] = Field(
        default=None,
        description="Optional TTS provider override (currently locked to google in Web UI flow)",
    )


class PendingItem(BaseModel):
    pending_id: str
    created_at: str
    event: EventIn
    candidate: AssistantOutput
    status: Literal["pending", "approved", "rejected"] = "pending"
    final: Optional[AssistantOutput] = None
    notes: Optional[str] = None


class ApproveIn(BaseModel):
    pending_id: str
    edits: Optional[AssistantOutput] = None
    notes: Optional[str] = None


class RejectIn(BaseModel):
    pending_id: str
    notes: Optional[str] = None
