from __future__ import annotations

import unittest

try:
    from apps.main.server.main import _normalize_console_settings_payload
except Exception as exc:  # pragma: no cover - environment dependency guard
    _normalize_console_settings_payload = None
    _IMPORT_ERROR = exc
else:
    _IMPORT_ERROR = None


class TestConsoleSettingsNormalize(unittest.TestCase):
    def test_normalize_model_lists_and_stt(self) -> None:
        if _IMPORT_ERROR is not None or _normalize_console_settings_payload is None:
            raise unittest.SkipTest(f"server import failed: {_IMPORT_ERROR}")
        payload = {
            "providers": {"stt": "local", "llm": "gemini", "tts": "google"},
            "llm": {"model": "gemini-2.0-flash-lite", "model_list": ["a", "b", "a", ""]},
            "vlm": {"model": "gemini-2.0-flash-lite", "model_list": ["x", "x", "y"]},
            "stt": {
                "model": "large-v3-turbo",
                "model_list": ["large-v3-turbo", "small", "small"],
                "language": "ja-JP",
                "vad": {"threshold": 0.6, "min_silence_ms": 300},
                "client": {"silence_ms": 700, "buffer_size": 4096},
                "fallback": {"min_amp": 0.01},
            },
            "tts": {"provider": "google", "voice": "ja-JP-Neural2-B", "voice_list": ["v1", "v1", "v2"]},
        }
        out = _normalize_console_settings_payload(payload)
        self.assertEqual(out["llm"]["model_list"], ["a", "b"])
        self.assertEqual(out["vlm"]["model_list"], ["x", "y"])
        self.assertEqual(out["stt"]["model_list"], ["large-v3-turbo", "small"])
        self.assertEqual(out["tts"]["voice_list"], ["v1", "v2"])
        self.assertEqual(out["stt"]["vad"]["threshold"], 0.6)
        self.assertEqual(out["stt"]["vad"]["min_silence_ms"], 300)
        self.assertEqual(out["stt"]["client"]["silence_ms"], 700)
        self.assertEqual(out["stt"]["client"]["buffer_size"], 4096)
        self.assertEqual(out["stt"]["fallback"]["min_amp"], 0.01)


if __name__ == "__main__":
    unittest.main()
