from __future__ import annotations

import unittest

from apps.main.core.types import AssistantOutput


class TestSchema(unittest.TestCase):
    def test_assistant_output_validation(self) -> None:
        out = AssistantOutput(
            speech_text="こんにちは",
            overlay_text="挨拶",
            emotion="neutral",
            motion_tags=["greet"],
            safety={"needs_manager_approval": True, "notes": ""},
        )
        self.assertEqual(out.speech_text, "こんにちは")


if __name__ == "__main__":
    unittest.main()
