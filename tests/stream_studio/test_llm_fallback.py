from __future__ import annotations

import unittest

from apps.stream_studio.llm.gemini_mvp import GeminiMVP


class TestLLMFallback(unittest.TestCase):
    def test_fallback_when_no_api_key(self) -> None:
        llm = GeminiMVP(api_key="", model="gemini-2.0-flash-lite")
        out = llm.generate(user_text="テスト", rag_context="", vlm_summary="")
        self.assertTrue(out.speech_text)
        self.assertTrue(out.overlay_text)
        self.assertTrue(out.safety.needs_manager_approval)


if __name__ == "__main__":
    unittest.main()
