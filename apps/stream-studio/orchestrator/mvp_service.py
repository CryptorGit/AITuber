from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from core.types import AssistantOutput, EventIn
from llm.mvp_models import LLMOut
from rag.long_term.store import LongTermStore
from rag.short_term.memory import ShortTermMemory
from vlm.summarizer import VLMSummarizer


class LLMProvider(Protocol):
    def generate_full(self, *, user_text: str, rag_context: str, vlm_summary: str) -> LLMOut:
        ...

    def generate_fast_ack(self, *, user_text: str, rag_context: str, vlm_summary: str) -> LLMOut:
        ...


@dataclass
class OrchestratorMVP:
    llm: LLMProvider
    st: ShortTermMemory
    lt: LongTermStore
    vlm: VLMSummarizer
    ng_words: list[str]
    rag_enabled: bool = True
    short_term_max_events: int = 50

    def _build_context(self, *, event: EventIn, include_vlm: bool) -> tuple[str, str]:
        rag_context = ""
        if self.rag_enabled:
            st_limit = max(0, int(self.short_term_max_events))
            st_text = self.st.recent_text(max_events=st_limit) if st_limit else ""
            lt_hits = self.lt.search(query=event.text, limit=5)
            lt_text = "\n".join([f"- {doc_id}: {snip}" for doc_id, snip in lt_hits])

            short_rag = self.lt.get(doc_id="shortRAG")
            long_rag = self.lt.get(doc_id="longRAG")
            short_rag_text = (short_rag or {}).get("text") if isinstance(short_rag, dict) else ""
            long_rag_text = (long_rag or {}).get("text") if isinstance(long_rag, dict) else ""

            if st_text:
                rag_context += "[short_term]\n" + st_text + "\n"
            if short_rag_text:
                rag_context += "[shortRAG]\n" + str(short_rag_text).strip() + "\n"
            if long_rag_text:
                rag_context += "[longRAG]\n" + str(long_rag_text).strip() + "\n"
            if lt_text:
                rag_context += "[long_term_search]\n" + lt_text + "\n"
        if not rag_context:
            rag_context = "no_rag"

        vlm_summary = ""
        if include_vlm:
            provided = (event.vlm_summary or "").strip()
            if provided:
                vlm_summary = provided

        return rag_context, vlm_summary

    def _apply_safety(self, out: LLMOut) -> AssistantOutput:
        blocked = False
        safe_speech = out.speech_text
        safe_overlay = out.overlay_text
        for w in self.ng_words:
            ww = (w or "").strip()
            if not ww:
                continue
            if ww in safe_speech or ww in safe_overlay:
                blocked = True
                safe_speech = "content blocked"
                safe_overlay = "content blocked"
                break

        return AssistantOutput(
            speech_text=safe_speech,
            overlay_text=safe_overlay,
            emotion=out.emotion,
            motion_tags=out.motion_tags,
            safety={
                "needs_manager_approval": bool(out.safety.needs_manager_approval),
                "notes": (out.safety.notes or "") + (" | blocked_by_ng_word" if blocked else ""),
            },
        )

    def run(self, *, event: EventIn, include_vlm: bool, screenshot_path) -> AssistantOutput:
        _ = screenshot_path
        rag_context, vlm_summary = self._build_context(event=event, include_vlm=include_vlm)
        out = self.llm.generate_full(user_text=event.text, rag_context=rag_context, vlm_summary=vlm_summary)
        return self._apply_safety(out)

    def run_fast_ack(self, *, event: EventIn, include_vlm: bool, screenshot_path) -> AssistantOutput:
        _ = screenshot_path
        rag_context, vlm_summary = self._build_context(event=event, include_vlm=include_vlm)
        out = self.llm.generate_fast_ack(user_text=event.text, rag_context=rag_context, vlm_summary=vlm_summary)
        return self._apply_safety(out)

    def run_two_phase(self, *, event: EventIn, include_vlm: bool, screenshot_path) -> tuple[AssistantOutput, AssistantOutput]:
        ack = self.run_fast_ack(event=event, include_vlm=include_vlm, screenshot_path=screenshot_path)
        full = self.run(event=event, include_vlm=include_vlm, screenshot_path=screenshot_path)
        return ack, full
