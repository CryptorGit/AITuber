from __future__ import annotations

import io
from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class GoogleSTTConfig:
    language_code: str = "ja-JP"


def transcribe_wav_via_google(
    *,
    audio_bytes: bytes,
    cfg: Optional[GoogleSTTConfig] = None,
) -> str:
    """Transcribe WAV bytes using Google Cloud Speech-to-Text.

    Expected input: WAV container with 16-bit PCM.
    """
    if not audio_bytes:
        return ""

    cfg = cfg or GoogleSTTConfig()

    try:
        import wave
        import numpy as np

        with wave.open(io.BytesIO(audio_bytes), "rb") as wf:
            channels = int(wf.getnchannels())
            sampwidth = int(wf.getsampwidth())
            sample_rate = int(wf.getframerate())
            n_frames = int(wf.getnframes())
            frames = wf.readframes(n_frames)

        if sampwidth != 2:
            raise ValueError(f"unsupported_sampwidth:{sampwidth}")

        audio_i16 = np.frombuffer(frames, dtype=np.int16)
        if channels > 1:
            try:
                audio_i16 = audio_i16.reshape(-1, channels).mean(axis=1).astype(np.int16)
            except Exception:
                # If reshape fails, fall back to using raw buffer.
                pass
        pcm_bytes = audio_i16.tobytes()
    except Exception as e:
        raise ValueError(f"invalid_wav:{type(e).__name__}") from e

    try:
        from google.cloud import speech
    except Exception as e:
        raise ModuleNotFoundError("google.cloud.speech") from e

    client = speech.SpeechClient()

    recognition_audio = speech.RecognitionAudio(content=pcm_bytes)
    recognition_config = speech.RecognitionConfig(
        encoding=speech.RecognitionConfig.AudioEncoding.LINEAR16,
        sample_rate_hertz=sample_rate,
        language_code=(cfg.language_code or "ja-JP"),
        enable_automatic_punctuation=False,
    )

    resp = client.recognize(config=recognition_config, audio=recognition_audio)

    parts: list[str] = []
    for r in (resp.results or []):
        alt = r.alternatives[0] if getattr(r, "alternatives", None) else None
        if alt and getattr(alt, "transcript", None):
            parts.append(str(alt.transcript).strip())

    return " ".join([p for p in parts if p]).strip()
