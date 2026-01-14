from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Optional

import numpy as np

from .vad import VADConfig, VADDetector

@dataclass
class WhisperConfig:
    model: str = "large-v3-turbo"
    device: str = "cpu"
    compute_type: str = "int8"
    language: str = "ja"


_model_lock = threading.Lock()
_model = None
_model_cfg: Optional[WhisperConfig] = None


def _load_model(cfg: WhisperConfig):
    from faster_whisper import WhisperModel

    return WhisperModel(cfg.model, device=cfg.device, compute_type=cfg.compute_type)


def get_model(cfg: WhisperConfig):
    global _model, _model_cfg
    with _model_lock:
        if _model is None or _model_cfg != cfg:
            _model = _load_model(cfg)
            _model_cfg = cfg
        return _model


def transcribe_pcm(
    *,
    audio: np.ndarray,
    sample_rate: int,
    cfg: WhisperConfig,
    internal_vad: bool = False,
) -> str:
    """Transcribe mono float32 PCM audio (expected to be VAD-cleaned).

    audio: float32 numpy array in [-1,1]
    """
    if not getattr(audio, "size", 0):
        return ""
    model = get_model(cfg)

    # Resample to 16k for Whisper
    target_sr = 16000
    if sample_rate != target_sr and audio.size:
        duration = audio.size / float(sample_rate)
        target_len = int(round(duration * target_sr))
        if target_len > 0:
            x_old = np.linspace(0.0, duration, num=audio.size, endpoint=False)
            x_new = np.linspace(0.0, duration, num=target_len, endpoint=False)
            audio = np.interp(x_new, x_old, audio).astype(np.float32)
        sample_rate = target_sr

    segments, _info = model.transcribe(
        audio,
        language=cfg.language or None,
        beam_size=1,
        best_of=1,
        temperature=0.0,
        condition_on_previous_text=False,
        without_timestamps=True,
        vad_filter=bool(internal_vad),
    )
    text = "".join((s.text or "") for s in segments).strip()
    return text


def transcribe_pcm_with_vad(
    *,
    audio: np.ndarray,
    sample_rate: int,
    cfg: WhisperConfig,
    vad_cfg: VADConfig,
    allow_fallback: bool = False,
) -> tuple[str, dict]:
    """Run Silero VAD and transcribe only confirmed speech segments."""
    if not getattr(audio, "size", 0):
        return "", {"segments": 0, "speech_ms": 0, "fallback_used": False}

    total_ms = int(round((int(audio.size) * 1000.0) / float(sample_rate))) if sample_rate > 0 else 0

    vad = VADDetector(vad_cfg)
    segments = vad.process_chunk(audio)
    segments.extend(vad.flush())

    texts: list[str] = []
    speech_ms = 0
    for seg in segments:
        if not getattr(seg.audio, "size", 0):
            continue
        speech_ms += max(0, seg.end_ms - seg.start_ms)
        part = transcribe_pcm(
            audio=seg.audio,
            sample_rate=sample_rate,
            cfg=cfg,
            internal_vad=False,
        )
        if part:
            texts.append(part)

    text = " ".join([t.strip() for t in texts if t]).strip()
    fallback_used = False

    fallback_reason: Optional[str] = None
    if allow_fallback:
        # If VAD finds nothing, obviously fall back.
        if not text:
            fallback_reason = "empty_after_vad"

        # If VAD found *some* speech but it's implausibly little compared to input,
        # it tends to clip utterances (especially with conservative thresholds).
        if fallback_reason is None and total_ms > 0:
            if speech_ms <= 0:
                fallback_reason = "no_speech_detected"
            else:
                # Heuristic: if VAD speech is <15% of input (and input is >1s), try full.
                if total_ms >= 1000 and speech_ms < int(round(total_ms * 0.15)):
                    fallback_reason = "vad_undersegmented"

        if fallback_reason is None and text:
            # Another heuristic: extremely short output is often a clipped segment.
            if total_ms >= 1000 and len(text) <= 3:
                fallback_reason = "vad_text_too_short"

        if fallback_reason is not None:
            full = transcribe_pcm(
                audio=audio,
                sample_rate=sample_rate,
                cfg=cfg,
                internal_vad=False,
            )
            if full and len(full) >= len(text):
                text = full
                fallback_used = True
            else:
                fallback_reason = None

    meta = {
        "segments": len(segments),
        "speech_ms": speech_ms,
        "total_ms": total_ms,
        "fallback_used": fallback_used,
        "fallback_reason": fallback_reason,
    }
    return text, meta


class WhisperStream:
    """Streamed transcription driven by Silero VAD segments."""

    def __init__(self, *, cfg: WhisperConfig, vad_cfg: VADConfig) -> None:
        self._cfg = cfg
        self._vad = VADDetector(vad_cfg)
        self._sample_rate = int(vad_cfg.sample_rate)

    @property
    def vad(self) -> VADDetector:
        return self._vad

    def process_chunk(self, chunk: np.ndarray) -> list[str]:
        texts: list[str] = []
        segments = self._vad.process_chunk(chunk)
        for seg in segments:
            if not getattr(seg.audio, "size", 0):
                continue
            text = transcribe_pcm(
                audio=seg.audio,
                sample_rate=self._sample_rate,
                cfg=self._cfg,
                internal_vad=False,
            )
            if text:
                texts.append(text)
        return texts

    def flush(self) -> list[str]:
        texts: list[str] = []
        segments = self._vad.flush()
        for seg in segments:
            if not getattr(seg.audio, "size", 0):
                continue
            text = transcribe_pcm(
                audio=seg.audio,
                sample_rate=self._sample_rate,
                cfg=self._cfg,
                internal_vad=False,
            )
            if text:
                texts.append(text)
        return texts
