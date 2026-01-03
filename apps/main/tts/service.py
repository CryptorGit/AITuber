from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from typing import Optional, Tuple

import wave

from apps.main.tts.engine import TTSEngine


@dataclass
class TTSService:
    provider: str
    voice: str

    def synthesize(self, *, text: str, out_path: Path) -> Path:
        """Generate speech audio.

        - provider=google: use Google Cloud TTS if configured, else fallback.
        - provider=stub: always fallback to silent wav.
        """
        prov = (self.provider or "").strip().lower()

        if prov == "google":
            try:
                from google.cloud import texttospeech

                client = texttospeech.TextToSpeechClient()
                synthesis_input = texttospeech.SynthesisInput(text=text)

                # Voice name is optional; if given, we try to use it.
                voice_params = texttospeech.VoiceSelectionParams(
                    language_code="ja-JP",
                    name=self.voice or "",
                )
                # LINEAR16 is raw PCM; we wrap it into a WAV container ourselves.
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
                # Ensure even length for 16-bit samples.
                if len(pcm) % 2 == 1:
                    pcm = pcm[:-1]
                with wave.open(str(out_path), "wb") as wf:
                    wf.setnchannels(1)
                    wf.setsampwidth(2)
                    wf.setframerate(sample_rate_hz)
                    wf.writeframes(pcm)
                return out_path
            except Exception:
                # Fall through to stub
                pass

        engine = TTSEngine(voice="stub")
        return engine.synthesize(text=text, out_wav_path=out_path, seconds=1.0)

    def synthesize_with_meta(self, *, text: str, out_path: Path) -> Tuple[Path, str, Optional[str]]:
        """Same as synthesize() but returns (path, provider_used, error_message)."""
        prov = (self.provider or "").strip().lower()

        if prov == "google":
            try:
                from google.cloud import texttospeech

                client = texttospeech.TextToSpeechClient()
                synthesis_input = texttospeech.SynthesisInput(text=text)
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
                return out_path, "google", None
            except Exception as e:
                # fall back
                engine = TTSEngine(voice="stub")
                p = engine.synthesize(text=text, out_wav_path=out_path, seconds=1.0)
                return p, "stub", f"{type(e).__name__}: {e}"[:220]

        engine = TTSEngine(voice="stub")
        p = engine.synthesize(text=text, out_wav_path=out_path, seconds=1.0)
        return p, "stub", None
