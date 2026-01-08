from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from typing import Optional, Tuple

import array
import wave

from apps.main.tts.engine import TTSEngine


@dataclass
class TTSService:
    provider: str
    voice: str

    @staticmethod
    def _apply_wav_fade(*, wav_path: Path, fade_in_ms: int = 8, fade_out_ms: int = 8) -> None:
        """Apply a short linear fade-in/out to a 16-bit PCM WAV.

        This suppresses audible clicks when playback starts/ends at a non-zero
        sample value (common with synthesized audio).
        """
        if fade_in_ms <= 0 and fade_out_ms <= 0:
            return

        try:
            with wave.open(str(wav_path), "rb") as wf:
                nch = int(wf.getnchannels())
                sampwidth = int(wf.getsampwidth())
                rate = int(wf.getframerate())
                nframes = int(wf.getnframes())
                comptype = wf.getcomptype()
                if comptype != "NONE":
                    return
                if sampwidth != 2 or nch <= 0 or rate <= 0 or nframes <= 0:
                    return
                raw = wf.readframes(nframes)

            # 16-bit signed little-endian
            samples = array.array("h")
            samples.frombytes(raw)
            if not samples:
                return

            total_frames = len(samples) // nch
            if total_frames <= 1:
                return

            fi = int(rate * max(0, fade_in_ms) / 1000)
            fo = int(rate * max(0, fade_out_ms) / 1000)
            fi = max(0, min(fi, total_frames))
            fo = max(0, min(fo, total_frames))

            # Fade-in
            if fi >= 2:
                for frame_i in range(fi):
                    g = frame_i / float(fi - 1)
                    base = frame_i * nch
                    for c in range(nch):
                        v = int(samples[base + c] * g)
                        if v > 32767:
                            v = 32767
                        elif v < -32768:
                            v = -32768
                        samples[base + c] = v

            # Fade-out
            if fo >= 2:
                start = max(0, total_frames - fo)
                for j, frame_i in enumerate(range(start, total_frames)):
                    # j=0 => gain=1, j=fo-1 => gain=0
                    g = 1.0 - (j / float(fo - 1))
                    base = frame_i * nch
                    for c in range(nch):
                        v = int(samples[base + c] * g)
                        if v > 32767:
                            v = 32767
                        elif v < -32768:
                            v = -32768
                        samples[base + c] = v

            out_bytes = samples.tobytes()
            with wave.open(str(wav_path), "wb") as wf2:
                wf2.setnchannels(nch)
                wf2.setsampwidth(2)
                wf2.setframerate(rate)
                wf2.writeframes(out_bytes)
        except Exception:
            # Best-effort: do not break TTS if postprocessing fails.
            return

    def _synthesize_google(self, *, text: str, out_path: Path, ssml: bool) -> Path:
        from google.cloud import texttospeech

        client = texttospeech.TextToSpeechClient()
        synthesis_input = texttospeech.SynthesisInput(ssml=text) if ssml else texttospeech.SynthesisInput(text=text)

        voice_params = texttospeech.VoiceSelectionParams(
            language_code="ja-JP",
            name=self.voice or "",
        )
        sample_rate_hz = 24000
        audio_config = texttospeech.AudioConfig(
            audio_encoding=texttospeech.AudioEncoding.LINEAR16,
            sample_rate_hertz=sample_rate_hz,
        )

        response = client.synthesize_speech(
            input=synthesis_input,
            voice=voice_params,
            audio_config=audio_config,
        )

        out_path.parent.mkdir(parents=True, exist_ok=True)
        pcm = response.audio_content or b""
        if len(pcm) % 2 == 1:
            pcm = pcm[:-1]
        with wave.open(str(out_path), "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate_hz)
            wf.writeframes(pcm)
        # Reduce start/end click artifacts.
        self._apply_wav_fade(wav_path=out_path, fade_in_ms=8, fade_out_ms=8)
        return out_path

    def synthesize(self, *, text: str, out_path: Path, ssml: bool = False) -> Path:
        """Generate speech audio.

        - provider=google: use Google Cloud TTS if configured, else fallback.
        - provider=stub: always fallback to silent wav.
        """
        prov = (self.provider or "").strip().lower()

        if prov == "google":
            try:
                return self._synthesize_google(text=text, out_path=out_path, ssml=ssml)
            except Exception:
                # Fall through to stub
                pass

        engine = TTSEngine(voice="stub")
        return engine.synthesize(text=text, out_wav_path=out_path, seconds=1.0)

    def synthesize_with_meta(self, *, text: str, out_path: Path, ssml: bool = False) -> Tuple[Path, str, Optional[str]]:
        """Same as synthesize() but returns (path, provider_used, error_message)."""
        prov = (self.provider or "").strip().lower()

        if prov == "google":
            try:
                p = self._synthesize_google(text=text, out_path=out_path, ssml=ssml)
                return p, "google", None
            except Exception as e:
                # fall back
                engine = TTSEngine(voice="stub")
                p = engine.synthesize(text=text, out_wav_path=out_path, seconds=1.0)
                return p, "stub", f"{type(e).__name__}: {e}"[:220]

        engine = TTSEngine(voice="stub")
        p = engine.synthesize(text=text, out_wav_path=out_path, seconds=1.0)
        return p, "stub", None
