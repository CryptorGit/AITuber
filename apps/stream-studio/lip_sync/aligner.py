from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Optional, Protocol, Tuple


@dataclass
class PhonemeEvent:
    start_ms: int
    end_ms: int
    phoneme: str
    confidence: Optional[float] = None


class IForcedAligner(Protocol):
    """Forced alignment: derive phoneme timing from (audio + text)."""

    def align(self, *, audio_wav_path: Path, text: str) -> List[PhonemeEvent]:
        raise NotImplementedError


@dataclass(frozen=True)
class TimedChunk:
    """A small timed transcript chunk (segment/word)."""

    start_ms: int
    end_ms: int
    text: str


def _katakana(s: str) -> str:
    """Normalize to Katakana (best-effort)."""
    out: list[str] = []
    for ch in (s or ""):
        code = ord(ch)
        # Hiragana -> Katakana
        if 0x3041 <= code <= 0x3096:
            out.append(chr(code + 0x60))
        else:
            out.append(ch)
    return "".join(out)


def _strip_non_kana(s: str) -> str:
    """Keep only kana + long mark; drop spaces/punctuation."""
    keep: list[str] = []
    for ch in (s or ""):
        code = ord(ch)
        if ch == "ー":
            keep.append(ch)
            continue
        # Katakana
        if 0x30A0 <= code <= 0x30FF:
            keep.append(ch)
            continue
        # Hiragana
        if 0x3040 <= code <= 0x309F:
            keep.append(ch)
            continue
        # small prolonged sound mark variants are already covered
    return _katakana("".join(keep))


def text_to_kana(*, text: str) -> str:
    """Convert Japanese text to (mostly) Katakana reading.

    Uses Janome when available; falls back to stripping kana from the surface.
    """
    try:
        from janome.tokenizer import Tokenizer  # type: ignore

        t = Tokenizer()
        parts: list[str] = []
        for tok in t.tokenize(text or ""):
            # reading is katakana or '*'
            r = getattr(tok, "reading", "") or ""
            if r and r != "*":
                parts.append(str(r))
            else:
                parts.append(str(getattr(tok, "surface", "") or ""))
        return _strip_non_kana("".join(parts))
    except Exception:
        return _strip_non_kana(text or "")


_SMALL = set("ァィゥェォャュョッヮ")


def kana_to_moras(katakana: str) -> List[str]:
    """Split Katakana reading into mora-like units."""
    s = _strip_non_kana(katakana)
    if not s:
        return []
    moras: List[str] = []
    i = 0
    while i < len(s):
        ch = s[i]
        # Long mark extends previous mora
        if ch == "ー":
            if moras:
                moras[-1] = moras[-1] + "ー"
            i += 1
            continue
        # Sokuon (small tsu) treated as its own unit (closed-ish)
        if ch == "ッ":
            moras.append(ch)
            i += 1
            continue
        # Moraic nasal
        if ch == "ン":
            moras.append(ch)
            i += 1
            continue
        # Combine base kana + following small kana (ャュョァィゥェォ)
        if i + 1 < len(s) and s[i + 1] in _SMALL:
            moras.append(ch + s[i + 1])
            i += 2
            continue
        moras.append(ch)
        i += 1
    return moras


def mora_to_vowel(mora: str, *, prev_vowel: Optional[str] = None) -> Optional[str]:
    """Return vowel key a/i/u/e/o if the mora has one, else None."""
    m = (mora or "").strip()
    if not m:
        return None
    if m == "ッ":
        return None
    if m == "ン":
        return None
    if m.endswith("ー"):
        # Prolonged sound mark: prefer the vowel of the base mora.
        base = m.rstrip("ー")
        if base:
            return mora_to_vowel(base, prev_vowel=prev_vowel)
        return prev_vowel

    # Determine vowel by the last kana in the mora (covers キャ -> ャ)
    last = m[-1]
    if last in ("ア", "ァ", "ャ"):
        return "a"
    if last in ("イ", "ィ"):
        return "i"
    if last in ("ウ", "ゥ", "ュ"):
        return "u"
    if last in ("エ", "ェ"):
        return "e"
    if last in ("オ", "ォ", "ョ"):
        return "o"

    # Fallback: try to map common rows by membership.
    a_row = set("カサタナハマヤラワガザダバパファヴァ")
    i_row = set("キシチニヒミリギジヂビピフィヴィ")
    u_row = set("クスツヌフムユルグズヅブプフュヴ")
    e_row = set("ケセテネヘメレゲゼデベペフェヴェ")
    o_row = set("コソトノホモヨロゴゾドボポフォヴォ")
    if last in a_row:
        return "a"
    if last in i_row:
        return "i"
    if last in u_row:
        return "u"
    if last in e_row:
        return "e"
    if last in o_row:
        return "o"
    return None


def _levenshtein_align(a: List[str], b: List[str]) -> List[Optional[int]]:
    """Align sequence a to b. Returns mapping a_idx -> b_idx (or None).

    Uses edit distance with substitution cost 1.
    """
    n, m = len(a), len(b)
    if n == 0:
        return []
    if m == 0:
        return [None] * n

    # dp rows
    prev = list(range(m + 1))
    back: List[List[int]] = [[0] * (m + 1) for _ in range(n + 1)]
    # back codes: 0=diag,1=up(del a),2=left(ins b)
    for j in range(1, m + 1):
        back[0][j] = 2
    for i in range(1, n + 1):
        cur = [i] + [0] * m
        back[i][0] = 1
        for j in range(1, m + 1):
            cost_sub = 0 if a[i - 1] == b[j - 1] else 1
            d_diag = prev[j - 1] + cost_sub
            d_up = prev[j] + 1
            d_left = cur[j - 1] + 1
            best = d_diag
            code = 0
            if d_up < best:
                best = d_up
                code = 1
            if d_left < best:
                best = d_left
                code = 2
            cur[j] = best
            back[i][j] = code
        prev = cur

    # Backtrace
    mapping: List[Optional[int]] = [None] * n
    i, j = n, m
    while i > 0 or j > 0:
        code = back[i][j]
        if i > 0 and j > 0 and code == 0:
            # match/substitute
            mapping[i - 1] = j - 1
            i -= 1
            j -= 1
        elif i > 0 and (j == 0 or code == 1):
            # delete a
            mapping[i - 1] = None
            i -= 1
        else:
            # insert b
            j -= 1
    return mapping


def build_phonemes_from_timed_chunks(*, chunks: Iterable[TimedChunk], text: str) -> List[PhonemeEvent]:
    """Best-effort forced alignment for Japanese using timed transcript chunks.

    Steps:
    - Convert both transcript and target text to mora sequences.
    - Expand transcript moras into time intervals (uniform within each chunk).
    - Align target moras onto transcript moras (edit-distance).
    - Emit vowel phoneme events (a/i/u/e/o) + closed-ish segments for N/ッ.
    """
    # Transcript timeline (mora -> (start,end))
    t_moras: List[str] = []
    t_times: List[Tuple[int, int]] = []
    for ch in chunks:
        if ch.end_ms <= ch.start_ms:
            continue
        mk = kana_to_moras(text_to_kana(text=ch.text))
        if not mk:
            continue
        dur = max(1, int(ch.end_ms) - int(ch.start_ms))
        step = dur / float(len(mk))
        for i, mora in enumerate(mk):
            s = int(round(ch.start_ms + step * i))
            e = int(round(ch.start_ms + step * (i + 1)))
            if e <= s:
                e = s + 1
            t_moras.append(mora)
            t_times.append((s, e))

    # Target moras
    target_moras = kana_to_moras(text_to_kana(text=text))
    if not target_moras or not t_moras:
        return []

    mapping = _levenshtein_align(target_moras, t_moras)

    events: List[PhonemeEvent] = []
    prev_v: Optional[str] = None
    for i, mora in enumerate(target_moras):
        j = mapping[i]
        if j is None:
            continue
        s, e = t_times[j]
        v = mora_to_vowel(mora, prev_vowel=prev_v)
        if v is None:
            # closed-ish markers
            if mora in ("ン", "ッ"):
                events.append(PhonemeEvent(start_ms=s, end_ms=e, phoneme="n"))
            continue
        prev_v = v
        events.append(PhonemeEvent(start_ms=s, end_ms=e, phoneme=v))

    if not events:
        return []

    # Merge consecutive same-phoneme events
    events.sort(key=lambda ev: (ev.start_ms, ev.end_ms))
    merged: List[PhonemeEvent] = [events[0]]
    for ev in events[1:]:
        last = merged[-1]
        if ev.phoneme == last.phoneme and ev.start_ms <= last.end_ms + 15:
            last.end_ms = max(last.end_ms, ev.end_ms)
        else:
            merged.append(ev)
    return merged


@dataclass
class WhisperAligner:
    """Forced aligner using faster-whisper as a timing oracle.

    This is not a perfect forced alignment, but it is audio-timeline-based:
    we extract timed chunks from the audio (segments/words) and align the
    target text moras onto that timeline.
    """

    model_size: str = "small"
    language: str = "ja"
    beam_size: int = 1
    vad_filter: bool = True

    def align(self, *, audio_wav_path: Path, text: str) -> List[PhonemeEvent]:
        try:
            from faster_whisper import WhisperModel  # type: ignore
        except Exception as e:
            raise RuntimeError(
                "WhisperAligner requires faster-whisper. Install it (already in requirements.txt) and its runtime deps."
            ) from e

        audio_wav_path = Path(audio_wav_path)
        if not audio_wav_path.exists():
            raise FileNotFoundError(str(audio_wav_path))

        model = WhisperModel(self.model_size)
        segments, _info = model.transcribe(
            str(audio_wav_path),
            language=self.language or None,
            beam_size=max(1, int(self.beam_size)),
            vad_filter=bool(self.vad_filter),
            word_timestamps=True,
        )

        chunks: List[TimedChunk] = []
        for seg in segments:
            # Prefer word timestamps if present
            words = getattr(seg, "words", None)
            if words:
                for w in words:
                    s = int(round(float(getattr(w, "start", 0.0)) * 1000.0))
                    e = int(round(float(getattr(w, "end", 0.0)) * 1000.0))
                    tx = str(getattr(w, "word", "") or "")
                    if e > s and tx.strip():
                        chunks.append(TimedChunk(start_ms=s, end_ms=e, text=tx))
                continue

            s = int(round(float(getattr(seg, "start", 0.0)) * 1000.0))
            e = int(round(float(getattr(seg, "end", 0.0)) * 1000.0))
            tx = str(getattr(seg, "text", "") or "")
            if e > s and tx.strip():
                chunks.append(TimedChunk(start_ms=s, end_ms=e, text=tx))

        # Final safety: if whisper returned nothing, bail
        if not chunks:
            return []
        return build_phonemes_from_timed_chunks(chunks=chunks, text=text)


@dataclass
class MFAAligner:
    """CLI runner for Montreal Forced Aligner (optional).

    This is intentionally best-effort and kept optional because MFA setup is
    heavyweight (acoustic models + dictionary).

    Expected workflow:
    - Provide `mfa_exe` pointing to `mfa`.
    - Provide `dict_path` and `acoustic_model_path`.
    - We create a temp corpus dir with a single wav+txt and parse TextGrid.
    """

    mfa_exe: str = "mfa"
    dict_path: Optional[Path] = None
    acoustic_model_path: Optional[Path] = None
    timeout_s: int = 300

    def align(self, *, audio_wav_path: Path, text: str) -> List[PhonemeEvent]:
        if not self.dict_path or not self.acoustic_model_path:
            raise RuntimeError("MFAAligner requires dict_path and acoustic_model_path")

        import tempfile

        audio_wav_path = Path(audio_wav_path)
        if not audio_wav_path.exists():
            raise FileNotFoundError(str(audio_wav_path))

        with tempfile.TemporaryDirectory(prefix="aituber_mfa_") as td:
            td_path = Path(td)
            corpus = td_path / "corpus"
            out_dir = td_path / "out"
            corpus.mkdir(parents=True, exist_ok=True)
            out_dir.mkdir(parents=True, exist_ok=True)

            stem = "utt"
            (corpus / f"{stem}.wav").write_bytes(audio_wav_path.read_bytes())
            (corpus / f"{stem}.txt").write_text(text, encoding="utf-8")

            cmd = [
                self.mfa_exe,
                "align",
                str(corpus),
                str(self.dict_path),
                str(self.acoustic_model_path),
                str(out_dir),
                "--clean",
                "--single_speaker",
            ]
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=self.timeout_s)
            if proc.returncode != 0:
                raise RuntimeError(f"mfa align failed: {proc.stderr.strip()[:500]}")

            # MFA output: TextGrid under out_dir (tier names vary). We parse a minimal subset.
            grid = next(out_dir.rglob("*.TextGrid"), None)
            if not grid:
                raise RuntimeError("mfa align produced no TextGrid")

            return _parse_textgrid_phonemes(grid)


def _parse_textgrid_phonemes(textgrid_path: Path) -> List[PhonemeEvent]:
    """Very small TextGrid parser (interval tiers)."""
    # Avoid extra dependencies. This parser is intentionally minimal.
    lines = textgrid_path.read_text(encoding="utf-8", errors="ignore").splitlines()
    events: List[PhonemeEvent] = []

    # Heuristic: find tiers with "phones" or "phoneme" in name; else take first interval tier.
    tier_names: list[tuple[int, str]] = []
    for i, line in enumerate(lines):
        s = line.strip()
        if s.startswith("name ="):
            name = s.split("=", 1)[1].strip().strip('"')
            tier_names.append((i, name))

    preferred_idx = None
    for i, name in tier_names:
        if any(k in name.lower() for k in ("phone", "phoneme", "phones")):
            preferred_idx = i
            break
    start_at = preferred_idx if preferred_idx is not None else (tier_names[0][0] if tier_names else 0)

    def _read_float_at(j: int, key: str) -> Optional[float]:
        # Expect: xmin = 0.123
        for k in range(j, min(len(lines), j + 8)):
            t = lines[k].strip()
            if t.startswith(key):
                try:
                    return float(t.split("=", 1)[1].strip())
                except Exception:
                    return None
        return None

    def _read_text_at(j: int) -> str:
        for k in range(j, min(len(lines), j + 8)):
            t = lines[k].strip()
            if t.startswith("text ="):
                return t.split("=", 1)[1].strip().strip('"')
        return ""

    for i in range(start_at, len(lines)):
        if "intervals [" in lines[i]:
            xmin = _read_float_at(i, "xmin")
            xmax = _read_float_at(i, "xmax")
            txt = _read_text_at(i)
            if xmin is None or xmax is None:
                continue
            ph = (txt or "").strip()
            if not ph or ph in ("sp", "sil"):
                continue
            events.append(
                PhonemeEvent(
                    start_ms=int(round(xmin * 1000.0)),
                    end_ms=int(round(xmax * 1000.0)),
                    phoneme=ph,
                )
            )

    # Ensure monotonic order
    events.sort(key=lambda e: (e.start_ms, e.end_ms))
    return events


def dumps_phoneme_events(events: List[PhonemeEvent]) -> str:
    return json.dumps([e.__dict__ for e in events], ensure_ascii=False)
