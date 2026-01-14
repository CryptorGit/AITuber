from __future__ import annotations

import sys
from pathlib import Path
import unittest

APP_ROOT = Path(__file__).resolve().parents[2] / "apps" / "stream-studio"
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from core.types import AssistantOutput


class TestSchema(unittest.TestCase):
    def test_assistant_output_validation(self) -> None:
        out = AssistantOutput(
            speech_text="縺薙ｓ縺ｫ縺｡縺ｯ",
            overlay_text="謖ｨ諡ｶ",
            emotion="neutral",
            motion_tags=["greet"],
            safety={"needs_manager_approval": True, "notes": ""},
        )
        self.assertEqual(out.speech_text, "縺薙ｓ縺ｫ縺｡縺ｯ")


if __name__ == "__main__":
    unittest.main()
