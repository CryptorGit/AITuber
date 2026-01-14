from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import numpy as np


@dataclass
class VADConfig:
    sample_rate: int = 16000
    vad_sample_rate: int = 8000
    threshold: float = 0.5
    silence_threshold: Optional[float] = None
    min_speech_ms: int = 200
    min_silence_ms: int = 400
    speech_pad_ms: int = 120
    frame_ms: int = 32
    max_buffer_ms: int = 30000
    device: str = "cpu"
    backend: str = "auto"  # auto | onnx | torch
    model_path: Optional[str] = None
    onnx_path: Optional[str] = None
    model_repo: str = "snakers4/silero-vad"

    def __post_init__(self) -> None:
        if self.sample_rate <= 0:
            raise ValueError("sample_rate must be positive")
        if self.vad_sample_rate <= 0:
            raise ValueError("vad_sample_rate must be positive")
        if not 0.0 <= self.threshold <= 1.0:
            raise ValueError("threshold must be in [0, 1]")
        if self.silence_threshold is not None and not 0.0 <= self.silence_threshold <= 1.0:
            raise ValueError("silence_threshold must be in [0, 1]")
        if self.frame_ms <= 0:
            raise ValueError("frame_ms must be positive")
        if self.max_buffer_ms <= 0:
            raise ValueError("max_buffer_ms must be positive")
        backend = str(self.backend or "").strip().lower()
        if backend not in {"auto", "onnx", "torch"}:
            raise ValueError("backend must be one of: auto, onnx, torch")
        self.backend = backend


class _OnnxSileroVAD:
    def __init__(self, *, onnx_path: Path, vad_sr: int) -> None:
        try:
            import onnxruntime as ort
        except Exception as exc:  # pragma: no cover
            raise RuntimeError("ONNX Silero VAD requires onnxruntime; install onnxruntime to enable.") from exc

        self._ort = ort
        self._vad_sr = int(vad_sr)
        self._sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])

        # Signature (as observed in this repo's model):
        # inputs: input [B,T], state [2,B,128], sr []
        # outputs: output [B,1], stateN
        self._input_name = self._sess.get_inputs()[0].name
        self._state_name = self._sess.get_inputs()[1].name
        self._sr_name = self._sess.get_inputs()[2].name
        self._out_name = self._sess.get_outputs()[0].name
        self._out_state_name = self._sess.get_outputs()[1].name

        self.reset_states()

    def reset_states(self) -> None:
        import numpy as _np

        self._state = _np.zeros((2, 1, 128), dtype=_np.float32)

    def infer_prob(self, frame: np.ndarray) -> float:
        import numpy as _np

        x = _np.ascontiguousarray(frame, dtype=_np.float32).reshape(1, -1)
        sr = _np.asarray(self._vad_sr, dtype=_np.int64)
        out, new_state = self._sess.run(
            [self._out_name, self._out_state_name],
            {self._input_name: x, self._state_name: self._state, self._sr_name: sr},
        )
        self._state = _np.ascontiguousarray(new_state, dtype=_np.float32)
        return float(_np.asarray(out, dtype=_np.float32).reshape(-1)[0])


@dataclass
class VADSegment:
    audio: np.ndarray
    start_ms: int
    end_ms: int


class _ChunkBuffer:
    def __init__(self, *, max_samples: int) -> None:
        self._chunks: deque[np.ndarray] = deque()
        self._start_index = 0
        self._length = 0
        self._max_samples = max_samples

    @property
    def start_index(self) -> int:
        return self._start_index

    @property
    def end_index(self) -> int:
        return self._start_index + self._length

    def append(self, chunk: np.ndarray) -> None:
        if chunk.size == 0:
            return
        self._chunks.append(chunk)
        self._length += int(chunk.size)
        self._trim()

    def _trim(self) -> None:
        while self._length > self._max_samples and self._chunks:
            drop = self._chunks.popleft()
            self._length -= int(drop.size)
            self._start_index += int(drop.size)

    def slice(self, start_index: int, end_index: int) -> np.ndarray:
        if end_index <= start_index:
            return np.zeros((0,), dtype=np.float32)
        if start_index < self._start_index:
            start_index = self._start_index
        if end_index > self.end_index:
            end_index = self.end_index
        if end_index <= start_index:
            return np.zeros((0,), dtype=np.float32)

        rel_start = start_index - self._start_index
        rel_end = end_index - self._start_index
        out: list[np.ndarray] = []
        pos = 0
        for chunk in self._chunks:
            next_pos = pos + int(chunk.size)
            if next_pos <= rel_start:
                pos = next_pos
                continue
            if pos >= rel_end:
                break
            s = max(0, rel_start - pos)
            e = min(int(chunk.size), rel_end - pos)
            if e > s:
                out.append(chunk[s:e])
            pos = next_pos
        if not out:
            return np.zeros((0,), dtype=np.float32)
        if len(out) == 1:
            return out[0].copy()
        return np.concatenate(out)


class VADDetector:
    """Streaming VAD for float32 PCM audio.

    process_chunk() returns speech segments when an end-of-speech is detected.
    """

    def __init__(self, cfg: VADConfig) -> None:
        self.cfg = cfg
        self.is_speech = False
        self.speech_start = False
        self.speech_end = False

        self._torch = None
        self._device = "cpu"
        self._backend = "torch"
        self._model = self._load_model(cfg)
        eval_fn = getattr(self._model, "eval", None)
        if callable(eval_fn):
            eval_fn()
        self._reset_model_states()

        # IMPORTANT: if ONNX is used, the shipped model in this repo expects 8kHz.
        # If we keep cfg.vad_sample_rate at 16kHz, we'd compute frame sizes at 16k
        # (e.g. 32ms -> 512 samples) but still pass sr=8000 into the model, which
        # triggers ONNXRuntime LSTM shape errors.
        self._vad_sr = int(getattr(self._model, "_vad_sr", cfg.vad_sample_rate))
        self._frame_samples = max(1, int(round(cfg.frame_ms * self._vad_sr / 1000.0)))
        # The shipped Silero VAD ONNX model is stable with 256-sample frames at 8kHz.
        # Keep it fixed to avoid runtime crashes when users tweak frame_ms in the UI.
        if self._backend == "onnx" and self._vad_sr == 8000:
            self._frame_samples = 256
        self._min_speech_samples = max(0, int(round(cfg.min_speech_ms * self._vad_sr / 1000.0)))
        self._min_silence_samples = max(0, int(round(cfg.min_silence_ms * self._vad_sr / 1000.0)))
        self._speech_pad_samples = max(0, int(round(cfg.speech_pad_ms * self._vad_sr / 1000.0)))
        if cfg.silence_threshold is None:
            self._silence_threshold = max(0.0, cfg.threshold - 0.15)
        else:
            self._silence_threshold = cfg.silence_threshold

        max_samples = int(round(cfg.max_buffer_ms * cfg.sample_rate / 1000.0))
        self._max_buffer_samples = max(1, max_samples)
        self._buffer = _ChunkBuffer(max_samples=self._max_buffer_samples)
        self._vad_remainder = np.zeros((0,), dtype=np.float32)
        self._vad_offset = 0
        self._speech_samples = 0
        self._silence_samples = 0
        self._pending_start_vad: Optional[int] = None
        self._segment_start_vad: Optional[int] = None

    def reset(self) -> None:
        self.is_speech = False
        self.speech_start = False
        self.speech_end = False
        self._vad_remainder = np.zeros((0,), dtype=np.float32)
        self._vad_offset = 0
        self._speech_samples = 0
        self._silence_samples = 0
        self._pending_start_vad = None
        self._segment_start_vad = None
        self._buffer = _ChunkBuffer(max_samples=self._max_buffer_samples)
        self._reset_model_states()

    def process_chunk(self, chunk: np.ndarray) -> list[VADSegment]:
        self.speech_start = False
        self.speech_end = False

        segments: list[VADSegment] = []
        if chunk is None or getattr(chunk, "size", 0) == 0:
            return segments

        raw = self._to_mono(chunk)
        raw = raw.astype(np.float32, copy=False)
        raw = np.clip(raw, -1.0, 1.0)
        self._buffer.append(raw)

        vad_chunk = self._resample(raw, self.cfg.sample_rate, self._vad_sr)
        if vad_chunk.size == 0:
            return segments

        if self._vad_remainder.size:
            vad_chunk = np.concatenate([self._vad_remainder, vad_chunk])

        offset = 0
        total = int(vad_chunk.size)
        while offset + self._frame_samples <= total:
            frame = vad_chunk[offset : offset + self._frame_samples]
            frame_start = self._vad_offset
            self._vad_offset += self._frame_samples
            offset += self._frame_samples

            prob = self._infer_prob(frame)
            if not self.is_speech:
                if prob >= self.cfg.threshold:
                    if self._pending_start_vad is None:
                        self._pending_start_vad = frame_start
                    self._speech_samples += self._frame_samples
                    if self._speech_samples >= self._min_speech_samples:
                        self.is_speech = True
                        self.speech_start = True
                        start_vad = self._pending_start_vad if self._pending_start_vad is not None else frame_start
                        start_vad = max(0, start_vad - self._speech_pad_samples)
                        self._segment_start_vad = start_vad
                        self._speech_samples = 0
                        self._silence_samples = 0
                        self._pending_start_vad = None
                else:
                    self._speech_samples = 0
                    self._pending_start_vad = None
            else:
                if prob < self._silence_threshold:
                    self._silence_samples += self._frame_samples
                    if self._silence_samples >= self._min_silence_samples:
                        end_vad = self._vad_offset - self._silence_samples
                        end_vad = min(end_vad + self._speech_pad_samples, self._vad_offset)
                        seg = self._build_segment(self._segment_start_vad, end_vad)
                        if seg is not None:
                            segments.append(seg)
                        self.speech_end = True
                        self.is_speech = False
                        self._speech_samples = 0
                        self._silence_samples = 0
                        self._pending_start_vad = None
                        self._segment_start_vad = None
                else:
                    self._silence_samples = 0

        self._vad_remainder = vad_chunk[offset:] if offset < total else np.zeros((0,), dtype=np.float32)
        return segments

    def flush(self) -> list[VADSegment]:
        """Flush trailing speech at end-of-stream."""
        self.speech_start = False
        self.speech_end = False
        segments: list[VADSegment] = []

        if self.is_speech and self._segment_start_vad is not None:
            end_vad = self._vad_offset + int(self._vad_remainder.size)
            seg = self._build_segment(self._segment_start_vad, end_vad)
            if seg is not None:
                segments.append(seg)
            self.speech_end = True

        self.is_speech = False
        self._speech_samples = 0
        self._silence_samples = 0
        self._pending_start_vad = None
        self._segment_start_vad = None
        self._vad_remainder = np.zeros((0,), dtype=np.float32)
        return segments

    def _build_segment(self, start_vad: Optional[int], end_vad: int) -> Optional[VADSegment]:
        if start_vad is None:
            return None
        start_raw = self._vad_to_raw(start_vad)
        end_raw = self._vad_to_raw(end_vad)
        start_raw = max(start_raw, self._buffer.start_index)
        end_raw = min(end_raw, self._buffer.end_index)
        if end_raw <= start_raw:
            return None
        audio = self._buffer.slice(start_raw, end_raw)
        if audio.size == 0:
            return None
        duration_ms = int(round((end_raw - start_raw) * 1000.0 / float(self.cfg.sample_rate)))
        if duration_ms < self.cfg.min_speech_ms:
            return None
        start_ms = int(round(start_raw * 1000.0 / float(self.cfg.sample_rate)))
        end_ms = int(round(end_raw * 1000.0 / float(self.cfg.sample_rate)))
        return VADSegment(audio=audio, start_ms=start_ms, end_ms=end_ms)

    def _vad_to_raw(self, vad_index: int) -> int:
        return int(round(vad_index * self.cfg.sample_rate / float(self._vad_sr)))

    def _infer_prob(self, frame: np.ndarray) -> float:
        if self._backend == "onnx":
            return float(self._model.infer_prob(frame))
        torch = self._torch
        tensor = torch.from_numpy(np.ascontiguousarray(frame, dtype=np.float32))
        if self._device != "cpu":
            tensor = tensor.to(self._device)
        with self._inference_mode():
            out = self._model(tensor, self._vad_sr)
        if isinstance(out, (tuple, list)):
            out = out[0]
        if hasattr(out, "item"):
            return float(out.item())
        return float(out)

    def _inference_mode(self):
        torch = self._torch
        if hasattr(torch, "inference_mode"):
            return torch.inference_mode()
        return torch.no_grad()

    def _reset_model_states(self) -> None:
        reset_fn = getattr(self._model, "reset_states", None)
        if callable(reset_fn):
            try:
                reset_fn()
            except Exception:
                pass

    @staticmethod
    def _default_onnx_path() -> Optional[Path]:
        # Prefer repo-root-relative path.
        try:
            root = Path(__file__).resolve().parents[3]
        except Exception:
            root = Path.cwd()
        candidate = root / "data" / "models" / "silero_vad.onnx"
        return candidate if candidate.is_file() else None

    def _load_model(self, cfg: VADConfig):
        # Prefer ONNX if available (offline, no torch.hub download).
        requested = str(cfg.backend or "auto").strip().lower()
        onnx_path: Optional[Path] = None
        if cfg.onnx_path:
            onnx_path = Path(cfg.onnx_path)
        else:
            onnx_path = self._default_onnx_path()

        if requested in {"auto", "onnx"} and onnx_path is not None:
            try:
                vad_sr = int(cfg.vad_sample_rate)
                if vad_sr != 8000:
                    if requested == "auto":
                        vad_sr = 8000
                        # Keep cfg consistent so frame sizing + resampling match
                        # the ONNX model's expected sample rate.
                        try:
                            cfg.vad_sample_rate = 8000
                        except Exception:
                            pass
                    else:
                        raise RuntimeError("ONNX Silero VAD in this repo expects vad_sample_rate=8000.")
                self._backend = "onnx"
                self._device = "cpu"
                return _OnnxSileroVAD(onnx_path=onnx_path, vad_sr=vad_sr)
            except Exception:
                if requested == "onnx":
                    raise

        if requested == "onnx":
            raise RuntimeError("VAD backend 'onnx' requested but ONNX model was not usable.")

        try:
            import torch
        except Exception as exc:
            raise RuntimeError("Silero VAD requires torch; install torch to enable VAD.") from exc

        self._torch = torch
        self._backend = "torch"
        device = str(cfg.device or "cpu")
        if cfg.model_path:
            try:
                model = torch.jit.load(cfg.model_path, map_location=cfg.device)
            except Exception as exc:
                raise RuntimeError(f"Failed to load Silero VAD model from {cfg.model_path}.") from exc
            try:
                model.to(device)
                self._device = device
            except Exception:
                self._device = "cpu"
            return model

        cached = self._load_jit_from_cache(torch, cfg)
        if cached is not None:
            try:
                cached.to(device)
                self._device = device
            except Exception:
                self._device = "cpu"
            return cached

        try:
            loaded = torch.hub.load(cfg.model_repo, "silero_vad", trust_repo=True)
        except Exception as exc:
            cached = self._load_jit_from_cache(torch, cfg)
            if cached is not None:
                try:
                    cached.to(device)
                    self._device = device
                except Exception:
                    self._device = "cpu"
                return cached
            raise RuntimeError(f"Failed to load Silero VAD from {cfg.model_repo}.") from exc

        if isinstance(loaded, (tuple, list)):
            model = loaded[0]
        else:
            model = loaded
        try:
            model.to(device)
            self._device = device
        except Exception:
            self._device = "cpu"
        return model

    @staticmethod
    def _load_jit_from_cache(torch, cfg: VADConfig):
        try:
            hub_dir = Path(torch.hub.get_dir())
        except Exception:
            return None
        repo_hint = cfg.model_repo.replace("/", "_")
        candidates: list[Path] = []
        try:
            candidates.extend(p for p in hub_dir.glob(f"{repo_hint}*") if p.is_dir())
        except Exception:
            candidates = []
        if not candidates:
            try:
                candidates = [p for p in hub_dir.glob("*silero-vad*") if p.is_dir()]
            except Exception:
                candidates = []
        for repo_dir in candidates:
            jit_path = repo_dir / "src" / "silero_vad" / "data" / "silero_vad.jit"
            if jit_path.is_file():
                try:
                    return torch.jit.load(str(jit_path), map_location=cfg.device)
                except Exception:
                    continue
        for repo_dir in candidates:
            try:
                for jit_path in repo_dir.rglob("silero_vad.jit"):
                    try:
                        return torch.jit.load(str(jit_path), map_location=cfg.device)
                    except Exception:
                        continue
            except Exception:
                continue
        return None

    @staticmethod
    def _to_mono(chunk: np.ndarray) -> np.ndarray:
        if chunk.ndim <= 1:
            return chunk
        return np.mean(chunk, axis=-1)

    @staticmethod
    def _resample(audio: np.ndarray, src_sr: int, dst_sr: int) -> np.ndarray:
        if src_sr == dst_sr or audio.size == 0:
            return audio.astype(np.float32, copy=False)
        duration = audio.size / float(src_sr)
        target_len = int(round(duration * dst_sr))
        if target_len <= 0:
            return np.zeros((0,), dtype=np.float32)
        x_old = np.linspace(0.0, duration, num=audio.size, endpoint=False)
        x_new = np.linspace(0.0, duration, num=target_len, endpoint=False)
        return np.interp(x_new, x_old, audio).astype(np.float32)
