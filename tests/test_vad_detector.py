from __future__ import annotations

import unittest

import numpy as np

from apps.main.stt.vad import VADConfig, VADDetector


class _DummyModel:
    def eval(self) -> "_DummyModel":
        return self

    def reset_states(self) -> None:
        return None


class DummyVAD(VADDetector):
    def __init__(self, cfg: VADConfig, probs: list[float]) -> None:
        self._probs = list(probs)
        self._prob_idx = 0
        super().__init__(cfg)

    def _load_model(self, cfg: VADConfig) -> _DummyModel:
        return _DummyModel()

    def _infer_prob(self, frame: np.ndarray) -> float:
        if self._prob_idx >= len(self._probs):
            return float(self._probs[-1]) if self._probs else 0.0
        out = float(self._probs[self._prob_idx])
        self._prob_idx += 1
        return out


class TestVADDetector(unittest.TestCase):
    def test_flush_emits_trailing_segment(self) -> None:
        cfg = VADConfig(
            sample_rate=1000,
            vad_sample_rate=1000,
            threshold=0.5,
            min_speech_ms=20,
            min_silence_ms=20,
            speech_pad_ms=0,
            frame_ms=10,
            max_buffer_ms=2000,
        )
        vad = DummyVAD(cfg, probs=[1.0] * 5)
        audio = np.ones(50, dtype=np.float32) * 0.1

        segments = vad.process_chunk(audio)
        self.assertEqual(segments, [])

        flushed = vad.flush()
        self.assertEqual(len(flushed), 1)
        self.assertEqual(len(flushed[0].audio), len(audio))
        self.assertEqual(flushed[0].start_ms, 0)

    def test_silence_triggers_end_segment(self) -> None:
        cfg = VADConfig(
            sample_rate=1000,
            vad_sample_rate=1000,
            threshold=0.5,
            silence_threshold=0.2,
            min_speech_ms=10,
            min_silence_ms=10,
            speech_pad_ms=0,
            frame_ms=10,
            max_buffer_ms=2000,
        )
        vad = DummyVAD(cfg, probs=[1.0, 1.0, 1.0, 0.0, 0.0])
        audio = np.ones(50, dtype=np.float32) * 0.1

        segments = vad.process_chunk(audio)
        self.assertEqual(len(segments), 1)
        self.assertEqual(len(segments[0].audio), 30)
        self.assertTrue(vad.speech_end)


if __name__ == "__main__":
    unittest.main()
