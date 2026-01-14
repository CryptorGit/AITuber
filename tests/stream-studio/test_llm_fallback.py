from __future__ import annotations

import sys
from pathlib import Path
import unittest

APP_ROOT = Path(__file__).resolve().parents[2] / "apps" / "stream-studio"
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from llm.gemini_mvp import GeminiMVP


class TestLLMFallback(unittest.TestCase):
    def test_fallback_when_no_api_key(self) -> None:
        llm = GeminiMVP(api_key="", model="gemini-2.0-flash-lite")
        out = llm.generate(user_text="繝・せ繝・, rag_context="", vlm_summary="")
        self.assertTrue(out.speech_text)
        self.assertTrue(out.overlay_text)
        self.assertTrue(out.safety.needs_manager_approval)


if __name__ == "__main__":
    unittest.main()
