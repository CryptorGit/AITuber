from __future__ import annotations

import wave
from dataclasses import dataclass
from pathlib import Path


@dataclass
class TTSEngine:
    """TTS engine stub.

    For now, generates a silent WAV file and returns its path.
    """

    voice: str

    def synthesize(self, *, text: str, out_wav_path: Path, seconds: float = 1.0) -> Path:
        out_wav_path.parent.mkdir(parents=True, exist_ok=True)

        framerate = 24000
        nframes = int(framerate * max(0.1, float(seconds)))
        nchannels = 1
        sampwidth = 2  # 16-bit

        silence = (b"\x00\x00") * nframes

        with wave.open(str(out_wav_path), "wb") as wf:
            wf.setnchannels(nchannels)
            wf.setsampwidth(sampwidth)
            wf.setframerate(framerate)
            wf.writeframes(silence)

        return out_wav_path
