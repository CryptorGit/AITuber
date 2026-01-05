from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class WebRtcVadResult:
    ok: bool
    reason: str
    sample_rate: int
    audio_f32: "Any"  # numpy.ndarray float32 mono
    meta: dict[str, Any]


def _resample_float32_mono(audio_f32, sample_rate: int, target_sr: int):
    # Lazily import numpy to keep import cost low for non-STT paths.
    import numpy as np

    if sample_rate == target_sr:
        return audio_f32.astype(np.float32, copy=False), sample_rate

    if audio_f32 is None or getattr(audio_f32, "size", 0) == 0:
        return audio_f32.astype(np.float32, copy=False), target_sr

    duration = float(audio_f32.size) / float(sample_rate)
    target_len = int(round(duration * float(target_sr)))
    if target_len <= 0:
        return np.zeros((0,), dtype=np.float32), target_sr

    x_old = np.linspace(0.0, duration, num=audio_f32.size, endpoint=False)
    x_new = np.linspace(0.0, duration, num=target_len, endpoint=False)
    out = np.interp(x_new, x_old, audio_f32).astype(np.float32)
    return out, target_sr


def _float32_to_pcm16_bytes(audio_f32):
    import numpy as np

    if audio_f32 is None or getattr(audio_f32, "size", 0) == 0:
        return b""
    x = np.clip(audio_f32, -1.0, 1.0)
    i16 = (x * 32767.0).astype(np.int16)
    return i16.tobytes(order="C")


def webrtc_vad_filter(
    *,
    audio_f32,
    sample_rate: int,
    aggressiveness: int = 2,
    frame_ms: int = 30,
    padding_ms: int = 300,
    min_speech_ms: int = 250,
    target_sr: int = 16000,
) -> WebRtcVadResult:
    """Filter audio using WebRTC VAD and return voiced-only audio.

    - Resamples to 16kHz mono.
    - Splits into 10/20/30ms frames and uses webrtcvad to detect speech.
    - Adds padding and enforces a minimum speech duration.

    Returns:
      WebRtcVadResult(ok=True, audio_f32=voiced_audio_16k_float32, ...)
      or ok=False with reason (e.g. 'no_voice', 'missing_dep:webrtcvad').
    """

    import numpy as np

    meta: dict[str, Any] = {
        "impl": "webrtcvad",
        "aggressiveness": int(aggressiveness),
        "frame_ms": int(frame_ms),
        "padding_ms": int(padding_ms),
        "min_speech_ms": int(min_speech_ms),
        "target_sr": int(target_sr),
        "input_sr": int(sample_rate),
        "input_samples": int(getattr(audio_f32, "size", 0) or 0),
    }

    try:
        import webrtcvad  # type: ignore
    except ModuleNotFoundError:
        return WebRtcVadResult(
            ok=False,
            reason="missing_dep:webrtcvad",
            sample_rate=sample_rate,
            audio_f32=audio_f32,
            meta=meta,
        )

    if frame_ms not in (10, 20, 30):
        raise ValueError("frame_ms must be one of 10, 20, 30")

    audio_16k, sr = _resample_float32_mono(audio_f32, sample_rate, target_sr)
    meta["resampled_samples"] = int(audio_16k.size)

    pcm16 = _float32_to_pcm16_bytes(audio_16k)
    if not pcm16:
        return WebRtcVadResult(ok=False, reason="empty_audio", sample_rate=sr, audio_f32=audio_16k, meta=meta)

    vad = webrtcvad.Vad(int(aggressiveness))

    bytes_per_sample = 2
    frame_len = int(sr * frame_ms / 1000)
    frame_bytes = frame_len * bytes_per_sample
    if frame_len <= 0:
        return WebRtcVadResult(ok=False, reason="invalid_frame", sample_rate=sr, audio_f32=audio_16k, meta=meta)

    # Trim to whole frames.
    usable = (len(pcm16) // frame_bytes) * frame_bytes
    pcm16 = pcm16[:usable]
    n_frames = (len(pcm16) // frame_bytes) if frame_bytes else 0
    meta["n_frames"] = int(n_frames)

    if n_frames <= 0:
        return WebRtcVadResult(ok=False, reason="empty_audio", sample_rate=sr, audio_f32=audio_16k, meta=meta)

    num_padding_frames = max(1, int(round(padding_ms / float(frame_ms))))

    # Use a ring buffer to provide padding and smoother triggering.
    ring: list[tuple[bytes, bool]] = []
    triggered = False
    voiced: list[bytes] = []
    voiced_frames = 0

    def _ring_voiced_ratio() -> float:
        if not ring:
            return 0.0
        return sum(1 for _b, is_speech in ring if is_speech) / float(len(ring))

    for i in range(n_frames):
        start = i * frame_bytes
        frame = pcm16[start : start + frame_bytes]
        try:
            is_speech = bool(vad.is_speech(frame, sr))
        except Exception:
            is_speech = False

        if not triggered:
            ring.append((frame, is_speech))
            if len(ring) > num_padding_frames:
                ring.pop(0)

            # Trigger when enough of padding window is speech.
            # Relaxed threshold reduces false negatives on breathy / quiet speech.
            if len(ring) >= num_padding_frames and _ring_voiced_ratio() >= 0.6:
                triggered = True
                for b, _s in ring:
                    voiced.append(b)
                    voiced_frames += 1
                ring.clear()
        else:
            voiced.append(frame)
            voiced_frames += 1
            ring.append((frame, is_speech))
            if len(ring) > num_padding_frames:
                ring.pop(0)

            # End segment when enough of padding window is non-speech.
            # Keep this a bit stricter to avoid fragmenting inside a sentence.
            if len(ring) >= num_padding_frames and (1.0 - _ring_voiced_ratio()) >= 0.8:
                triggered = False
                ring.clear()

    # Convert voiced frames to float32
    meta["voiced_frames"] = int(voiced_frames)

    min_frames = int(round(min_speech_ms / float(frame_ms)))
    if voiced_frames < max(1, min_frames):
        return WebRtcVadResult(ok=False, reason="no_voice", sample_rate=sr, audio_f32=np.zeros((0,), dtype=np.float32), meta=meta)

    voiced_pcm16 = b"".join(voiced)
    if not voiced_pcm16:
        return WebRtcVadResult(ok=False, reason="no_voice", sample_rate=sr, audio_f32=np.zeros((0,), dtype=np.float32), meta=meta)

    audio_i16 = np.frombuffer(voiced_pcm16, dtype=np.int16)
    voiced_f32 = (audio_i16.astype(np.float32) / 32768.0).clip(-1.0, 1.0)
    meta["output_samples"] = int(voiced_f32.size)

    return WebRtcVadResult(ok=True, reason="ok", sample_rate=sr, audio_f32=voiced_f32, meta=meta)
