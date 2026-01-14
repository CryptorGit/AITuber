"""Audio-timeline-based lip sync.

This package intentionally avoids "text-only" lip sync.
It always derives timing from either:
- viseme/phoneme timing returned by the TTS engine, or
- forced alignment (audio + text), or
- audio envelope (fallback, lower precision but robust).
"""

from .tts_adapter import ITextToSpeechAdapter, TTSResult, GoogleCloudTextToSpeechAdapter, StubTTSAdapter
from .aligner import IForcedAligner, PhonemeEvent, MFAAligner, WhisperAligner
from .curve import LipSyncCurve
from .mapper import LipSyncMapper, VisemeEvent

__all__ = [
    "ITextToSpeechAdapter",
    "TTSResult",
    "GoogleCloudTextToSpeechAdapter",
    "StubTTSAdapter",
    "IForcedAligner",
    "PhonemeEvent",
    "MFAAligner",
    "WhisperAligner",
    "VisemeEvent",
    "LipSyncMapper",
    "LipSyncCurve",
]
