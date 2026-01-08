from __future__ import annotations

from dataclasses import dataclass
import io
import wave
from typing import List, Optional, Protocol

from .aligner import PhonemeEvent
from .mapper import VisemeEvent


@dataclass
class TTSResult:
    audio_bytes: bytes
    sample_rate: int
    duration_ms: int
    audio_format: str = "wav"
    provider: str = ""
    voice_id: str = ""
    viseme_events: Optional[List[VisemeEvent]] = None
    phoneme_events: Optional[List[PhonemeEvent]] = None


class ITextToSpeechAdapter(Protocol):
    """Adapter interface so TTS engines can be swapped without touching lip sync."""

    def synthesize(
        self,
        *,
        text: str,
        voice_id: Optional[str] = None,
        speed: Optional[float] = None,
        pitch: Optional[float] = None,
        emotion_tags: Optional[list[str]] = None,
    ) -> TTSResult:
        raise NotImplementedError


@dataclass
class StubTTSAdapter:
    """Always returns a short silent WAV.

    Useful for tests or when no TTS provider is configured.
    """

    sample_rate: int = 24000
    seconds: float = 1.0
    provider: str = "stub"
    voice_id: str = "stub"

    def synthesize(
        self,
        *,
        text: str,
        voice_id: Optional[str] = None,
        speed: Optional[float] = None,
        pitch: Optional[float] = None,
        emotion_tags: Optional[list[str]] = None,
    ) -> TTSResult:
        n = int(max(1.0, float(self.seconds)) * float(self.sample_rate))
        pcm = b"\x00\x00" * n
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(int(self.sample_rate))
            wf.writeframes(pcm)
        audio = buf.getvalue()
        dur_ms = int(round((n / float(self.sample_rate)) * 1000.0))
        return TTSResult(
            audio_bytes=audio,
            sample_rate=int(self.sample_rate),
            duration_ms=dur_ms,
            audio_format="wav",
            provider=self.provider,
            voice_id=voice_id or self.voice_id,
            viseme_events=None,
            phoneme_events=None,
        )


@dataclass
class GoogleCloudTextToSpeechAdapter:
    """Google Cloud Text-to-Speech adapter.

    Note: Google Cloud TTS does not provide viseme/phoneme timing here.
    Use a forced aligner (e.g. WhisperAligner/MFAAligner) for timing.
    """

    language_code: str = "ja-JP"
    voice_name: str = ""
    sample_rate_hz: int = 24000

    def synthesize(
        self,
        *,
        text: str,
        voice_id: Optional[str] = None,
        speed: Optional[float] = None,
        pitch: Optional[float] = None,
        emotion_tags: Optional[list[str]] = None,
    ) -> TTSResult:
        try:
            from google.cloud import texttospeech  # type: ignore
        except Exception as e:
            raise RuntimeError("google-cloud-texttospeech is not installed/configured") from e

        client = texttospeech.TextToSpeechClient()
        synthesis_input = texttospeech.SynthesisInput(text=text)
        voice_params = texttospeech.VoiceSelectionParams(
            language_code=self.language_code,
            name=voice_id or self.voice_name or "",
        )

        # LINEAR16 PCM, wrap into WAV
        audio_config = texttospeech.AudioConfig(
            audio_encoding=texttospeech.AudioEncoding.LINEAR16,
            sample_rate_hertz=int(self.sample_rate_hz),
            speaking_rate=float(speed) if speed is not None else 1.0,
            pitch=float(pitch) if pitch is not None else 0.0,
        )

        response = client.synthesize_speech(
            input=synthesis_input,
            voice=voice_params,
            audio_config=audio_config,
        )

        pcm = response.audio_content or b""
        if len(pcm) % 2 == 1:
            pcm = pcm[:-1]

        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(int(self.sample_rate_hz))
            wf.writeframes(pcm)
        audio = buf.getvalue()

        # Duration from sample count
        frames = len(pcm) // 2
        dur_ms = int(round((frames / float(self.sample_rate_hz)) * 1000.0)) if self.sample_rate_hz else 0

        return TTSResult(
            audio_bytes=audio,
            sample_rate=int(self.sample_rate_hz),
            duration_ms=dur_ms,
            audio_format="wav",
            provider="google",
            voice_id=voice_id or self.voice_name,
            viseme_events=None,
            phoneme_events=None,
        )
