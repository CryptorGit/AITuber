from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Optional

import numpy as np


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
) -> str:
    """Transcribe mono float32 PCM audio.

    audio: float32 numpy array in [-1,1]
    """
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
        vad_filter=True,
    )
    text = "".join((s.text or "") for s in segments).strip()
    return text
