from __future__ import annotations

import json
import math
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from .aligner import PhonemeEvent
from .mapper import LipSyncMapper, MouthPose, VisemeEvent


def _clamp(x: float, lo: float, hi: float) -> float:
    return lo if x < lo else hi if x > hi else x


def wav_duration_ms(path: Path) -> int:
    with wave.open(str(path), "rb") as wf:
        frames = wf.getnframes()
        rate = wf.getframerate()
        if not rate:
            return 0
        return int(round((frames / float(rate)) * 1000.0))


def wav_read_mono_float32(path: Path) -> Tuple[List[float], int]:
    """Read wav into mono float32 samples in [-1,1]."""
    with wave.open(str(path), "rb") as wf:
        n = wf.getnframes()
        ch = wf.getnchannels()
        sw = wf.getsampwidth()
        sr = wf.getframerate()
        raw = wf.readframes(n)
    if sw != 2:
        raise ValueError(f"Only 16-bit PCM WAV supported for envelope; got sampwidth={sw}")
    import struct

    total = len(raw) // 2
    ints = struct.unpack("<" + "h" * total, raw)
    if ch == 1:
        mono = [v / 32768.0 for v in ints]
    else:
        mono = []
        for i in range(0, len(ints), ch):
            s = 0.0
            for c in range(ch):
                s += ints[i + c] / 32768.0
            mono.append(s / ch)
    return mono, int(sr)


def rms_envelope(
    *,
    wav_path: Path,
    hop_ms: int = 10,
    win_ms: int = 30,
    floor: float = 0.02,
    gain: float = 2.0,
) -> Tuple[List[int], List[float]]:
    """Compute RMS envelope at fixed hop.

    Returns (times_ms, env_0_1)
    """
    samples, sr = wav_read_mono_float32(wav_path)
    hop = max(1, int(sr * (hop_ms / 1000.0)))
    win = max(1, int(sr * (win_ms / 1000.0)))
    out_t: List[int] = []
    out_v: List[float] = []
    for start in range(0, len(samples), hop):
        seg = samples[start : start + win]
        if not seg:
            break
        ss = 0.0
        for v in seg:
            ss += v * v
        rms = math.sqrt(ss / len(seg))
        # normalize-ish
        v = (rms - floor) * gain
        v = _clamp(v, 0.0, 1.0)
        out_t.append(int(round((start / sr) * 1000.0)))
        out_v.append(v)
    return out_t, out_v


@dataclass
class LipSyncCurve:
    fps: int
    duration_ms: int
    mode: str
    series: Dict[str, List[float]]
    meta: Dict[str, object]

    def sample(self, t_ms: float) -> Dict[str, float]:
        dt = 1000.0 / float(self.fps)
        idx = int(math.floor(float(t_ms) / dt))
        if idx < 0:
            idx = 0
        max_idx = max(0, int(math.ceil(self.duration_ms / dt)) - 1)
        if idx > max_idx:
            idx = max_idx
        out: Dict[str, float] = {}
        for k, arr in self.series.items():
            if not arr:
                out[k] = 0.0
            else:
                out[k] = float(arr[min(idx, len(arr) - 1)])
        return out

    def to_json_dict(self) -> Dict[str, object]:
        return {
            "version": 1,
            "fps": self.fps,
            "duration_ms": self.duration_ms,
            "mode": self.mode,
            "series": self.series,
            "meta": self.meta,
        }

    def write_json(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.to_json_dict(), ensure_ascii=False), encoding="utf-8")


def _attack_release_filter(
    *,
    targets: List[float],
    fps: int,
    attack_ms: int,
    release_ms: int,
) -> List[float]:
    if not targets:
        return []
    dt = 1000.0 / float(fps)
    a_up = 1.0 - math.exp(-dt / max(1.0, float(attack_ms)))
    a_dn = 1.0 - math.exp(-dt / max(1.0, float(release_ms)))
    cur = float(targets[0])
    out = [cur]
    for t in targets[1:]:
        tgt = float(t)
        if tgt >= cur:
            cur = cur + (tgt - cur) * a_up
        else:
            cur = cur + (tgt - cur) * a_dn
        out.append(float(cur))
    return out


def build_curve_from_timeline(
    *,
    duration_ms: int,
    fps: int,
    mapper: LipSyncMapper,
    phoneme_events: Optional[List[PhonemeEvent]] = None,
    viseme_events: Optional[List[VisemeEvent]] = None,
    wav_path_for_envelope: Optional[Path] = None,
    alpha_viseme_open: float = 0.75,
    speech_pad_ms: int = 60,
    attack_ms: int = 45,
    release_ms: int = 90,
) -> LipSyncCurve:
    """Generate a time-keyed curve (sampled at fps).

    Priority:
      1) viseme timing
      2) phoneme timing
      3) envelope only
    """
    dt = 1000.0 / float(fps)
    n = max(1, int(math.ceil(duration_ms / dt)))
    times = [int(round(i * dt)) for i in range(n)]

    # Envelope (fallback, and can be mixed into viseme_open)
    env_by_ms: Dict[int, float] = {}
    if wav_path_for_envelope:
        et, ev = rms_envelope(wav_path=wav_path_for_envelope)
        for t, v in zip(et, ev):
            env_by_ms[int(t)] = float(v)

    def env_at(t_ms: int) -> float:
        if not env_by_ms:
            return 0.0
        hop = 10
        k = int(round(t_ms / hop) * hop)
        return float(env_by_ms.get(k, 0.0))

    # Build pose targets per frame
    mouth_open_tgt: List[float] = []
    mouth_form_tgt: List[float] = []
    smile_tgt: List[float] = []
    vowel_a_tgt: List[float] = []
    vowel_i_tgt: List[float] = []
    vowel_u_tgt: List[float] = []
    vowel_e_tgt: List[float] = []
    vowel_o_tgt: List[float] = []

    mode = "envelope"

    phoneme_spans: List[Tuple[int, int, MouthPose]] = []
    if phoneme_events:
        phoneme_spans = mapper.build_targets_from_phonemes(phoneme_events)
        if phoneme_spans:
            mode = "phoneme"

    # Visemes: treat as instantaneous events, hold until next
    visemes_sorted: List[VisemeEvent] = []
    if viseme_events:
        visemes_sorted = sorted(viseme_events, key=lambda e: int(e.time_ms))
        if visemes_sorted:
            mode = "viseme"

    def pose_at(t: int) -> MouthPose:
        # pad around speech boundaries to avoid snapping
        t2 = t
        if visemes_sorted:
            # find last viseme <= t
            last = None
            for ev in visemes_sorted:
                if ev.time_ms <= t2:
                    last = ev
                else:
                    break
            if last is None:
                return mapper.pose_for_viseme_id("sil")
            p = mapper.pose_for_viseme_id(last.viseme_id)
            if last.intensity is not None:
                p = MouthPose(
                    mouth_open=_clamp(p.mouth_open * float(last.intensity), 0.0, 1.0),
                    mouth_form=p.mouth_form,
                    smile=p.smile,
                )
            return p

        if phoneme_spans:
            # linear scan is fine for MVP sizes; optimize later if needed
            for s, e, p in phoneme_spans:
                if (s - speech_pad_ms) <= t2 < (e + speech_pad_ms):
                    return p
            return mapper.pose_for_phoneme("sil")

        return mapper.pose_for_phoneme("sil")

    def _active_vowel_key_at(t: int) -> Optional[str]:
        """Return active vowel key a/i/u/e/o when the timeline suggests one."""
        t2 = t
        if visemes_sorted:
            last = None
            for ev in visemes_sorted:
                if ev.time_ms <= t2:
                    last = ev
                else:
                    break
            if last is None:
                return None
            k = (last.viseme_id or "").strip().lower()
            return k if k in ("a", "i", "u", "e", "o") else None

        if phoneme_events:
            # Use raw phoneme events as timing oracle.
            for ev in phoneme_events:
                if (ev.start_ms - speech_pad_ms) <= t2 < (ev.end_ms + speech_pad_ms):
                    k = (ev.phoneme or "").strip().lower()
                    return k if k in ("a", "i", "u", "e", "o") else None
        return None

    for t in times:
        p = pose_at(t)
        vis_open = float(_clamp(p.mouth_open, 0.0, 1.0))
        form = float(_clamp(p.mouth_form, -1.0, 1.0))
        sm = float(_clamp(p.smile, 0.0, 1.0))
        env = env_at(t)
        # Mix envelope as robustness (prevents open=0 during strong consonants)
        open_v = _clamp(alpha_viseme_open * vis_open + (1.0 - alpha_viseme_open) * env, 0.0, 1.0)
        mouth_open_tgt.append(open_v)
        mouth_form_tgt.append(form)
        smile_tgt.append(sm)

        # Per-vowel activation (for models exposing ParamMouthA/I/U/E/O).
        # Drive it from the same audio-timeline oracle; scale by mouth openness.
        k = _active_vowel_key_at(t)
        vowel_a_tgt.append(open_v if k == "a" else 0.0)
        vowel_i_tgt.append(open_v if k == "i" else 0.0)
        vowel_u_tgt.append(open_v if k == "u" else 0.0)
        vowel_e_tgt.append(open_v if k == "e" else 0.0)
        vowel_o_tgt.append(open_v if k == "o" else 0.0)

    # Smooth (attack/release)
    mouth_open = _attack_release_filter(targets=mouth_open_tgt, fps=fps, attack_ms=attack_ms, release_ms=release_ms)
    mouth_form = _attack_release_filter(targets=mouth_form_tgt, fps=fps, attack_ms=attack_ms, release_ms=release_ms)
    smile = _attack_release_filter(targets=smile_tgt, fps=fps, attack_ms=attack_ms, release_ms=release_ms)
    vowel_a = _attack_release_filter(targets=vowel_a_tgt, fps=fps, attack_ms=attack_ms, release_ms=release_ms)
    vowel_i = _attack_release_filter(targets=vowel_i_tgt, fps=fps, attack_ms=attack_ms, release_ms=release_ms)
    vowel_u = _attack_release_filter(targets=vowel_u_tgt, fps=fps, attack_ms=attack_ms, release_ms=release_ms)
    vowel_e = _attack_release_filter(targets=vowel_e_tgt, fps=fps, attack_ms=attack_ms, release_ms=release_ms)
    vowel_o = _attack_release_filter(targets=vowel_o_tgt, fps=fps, attack_ms=attack_ms, release_ms=release_ms)

    return LipSyncCurve(
        fps=fps,
        duration_ms=duration_ms,
        mode=mode,
        series={
            "mouth_open": mouth_open,
            "mouth_form": mouth_form,
            "smile": smile,
            "vowel_a": vowel_a,
            "vowel_i": vowel_i,
            "vowel_u": vowel_u,
            "vowel_e": vowel_e,
            "vowel_o": vowel_o,
        },
        meta={
            "alpha_viseme_open": alpha_viseme_open,
            "speech_pad_ms": speech_pad_ms,
            "attack_ms": attack_ms,
            "release_ms": release_ms,
        },
    )
