from __future__ import annotations

import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from env_loader import load_env_files
from audio import convert_to_wav_16k_mono, save_upload_file
from fewshot import sample_fewshot
from gcp_clients import generate_candidates_json, transcribe_wav
from gcp_clients import regenerate_candidates_json
from storage import append_jsonl

BASE_DIR = Path(__file__).resolve().parent
REPO_ROOT = BASE_DIR.parents[1]
STATIC_DIR = REPO_ROOT / "web" / "labeler_loop"
DATA_DIR = REPO_ROOT / "data" / "labeler_loop"
LABELS_PATH = DATA_DIR / "labels.jsonl"
AUDIO_DIR = DATA_DIR / "audio"

GOOD_REASON_TAGS: list[dict[str, str]] = [
    {"id": "tempo_good", "desc": "テンポ良い/短い"},
    {"id": "metaphor_good", "desc": "比喩が刺さる"},
    {"id": "punch_good", "desc": "追い打ちが効いている"},
    {"id": "wrap_good", "desc": "オチ/巻き取りが良い"},
    {"id": "character_good", "desc": "キャラが立っている"},
]

BAD_REASON_TAGS: list[dict[str, str]] = [
    {"id": "too_long", "desc": "長い"},
    {"id": "too_safe", "desc": "無難/正論"},
    {"id": "unclear", "desc": "意味が分からない"},
    {"id": "too_mean", "desc": "刺し過ぎ/危険寄り"},
    {"id": "off_context", "desc": "状況ズレ"},
]

GOOD_REASON_TAG_IDS = {t["id"] for t in GOOD_REASON_TAGS}
BAD_REASON_TAG_IDS = {t["id"] for t in BAD_REASON_TAGS}

# Social support (SSBC-inspired) modes.
# Enforced in fixed order to prevent "5 paraphrases" failure.
MODES_ORDERED = [
    "NETWORK",
    "EMOTIONAL",
    "ESTEEM",
    "INFORMATIONAL",
    "TANGIBLE",
]

# Load env from repo-root .env/ (BOM-tolerant)
load_env_files(BASE_DIR)

app = FastAPI(title="labeler_loop")

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


def _backup_labels_daily() -> None:
    try:
        if not LABELS_PATH.exists():
            return
        backup_dir = REPO_ROOT / "data" / "backup"
        backup_dir.mkdir(parents=True, exist_ok=True)
        today = datetime.now(timezone.utc).strftime("%Y%m%d")
        dst = backup_dir / f"labels_{today}.jsonl"
        if dst.exists():
            return
        shutil.copyfile(LABELS_PATH, dst)
    except Exception:
        # Best-effort backup only
        pass


@app.on_event("startup")
def _on_startup() -> None:
    _backup_labels_daily()


@app.get("/")
def index() -> FileResponse:
    return FileResponse(str(STATIC_DIR / "index.html"))


class GenerateRequest(BaseModel):
    turn_id: str
    text: str
    meta: dict[str, Any] | None = None


class Candidate(BaseModel):
    mode: str
    text: str
    # Optional: tone/flavor that rides on top of the mode (e.g., comedic_tease, warm, hype).
    style: str | None = None


class LabelRequest(BaseModel):
    turn_id: str
    input_text: str
    raw_stt_text: str | None = None
    candidates: list[Candidate]
    winner_index: int = Field(ge=0, le=4)
    reason_good_tags: list[str] = Field(default_factory=list)
    reason_bad_tags: list[str] = Field(default_factory=list)
    stt_ref: dict[str, Any] | None = None
    fewshot_used: list[dict[str, Any]] = Field(default_factory=list)
    gen_ref: dict[str, Any] | None = None


def _char_bigrams(s: str) -> set[str]:
    s = "".join(ch for ch in (s or "").strip().lower() if not ch.isspace())
    if len(s) < 2:
        return {s} if s else set()
    return {s[i : i + 2] for i in range(len(s) - 1)}


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    inter = len(a & b)
    union = len(a | b)
    return (inter / union) if union else 0.0


def _find_too_similar_indices(candidates: list[dict[str, str]], threshold: float = 0.80, max_replace: int = 2) -> list[int]:
    """Return indices (up to max_replace) to regenerate, preferring later duplicates."""
    bigrams = [_char_bigrams(c.get("text", "")) for c in candidates]
    collisions: list[tuple[float, int]] = []
    for i in range(len(candidates)):
        for j in range(i + 1, len(candidates)):
            sim = _jaccard(bigrams[i], bigrams[j])
            if sim >= threshold:
                # replace the later one
                collisions.append((sim, j))
    # pick strongest collisions first
    collisions.sort(reverse=True, key=lambda x: x[0])
    out: list[int] = []
    seen: set[int] = set()
    for _sim, idx in collisions:
        if idx in seen:
            continue
        out.append(idx)
        seen.add(idx)
        if len(out) >= max_replace:
            break
    return out


@app.post("/api/transcribe")
async def api_transcribe(audio: UploadFile) -> dict[str, Any]:
    turn_id = uuid4().hex

    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    turn_dir = AUDIO_DIR / turn_id
    turn_dir.mkdir(parents=True, exist_ok=True)

    in_path = turn_dir / "input.webm"
    wav_path = turn_dir / "audio.wav"

    await save_upload_file(audio, in_path)

    try:
        convert_to_wav_16k_mono(in_path, wav_path)
    except FileNotFoundError as e:
        raise HTTPException(
            status_code=500,
            detail=str(e),
        )
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=f"ffmpeg conversion failed: {e}")

    try:
        text, stt_raw = transcribe_wav(wav_path)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"STT failed: {e}")

    audio_path = str(wav_path.relative_to(REPO_ROOT)).replace("\\", "/")

    return {
        "turn_id": turn_id,
        "text": text,
        "stt_raw": stt_raw,
        "audio_path": audio_path,
    }


@app.post("/api/generate")
def api_generate(req: GenerateRequest) -> dict[str, Any]:
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="text is empty")

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    fewshot_used = sample_fewshot(LABELS_PATH, k_min=2, k_max=3)

    try:
        out, gen_raw = generate_candidates_json(
            input_text=req.text,
            fewshot_used=fewshot_used,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Gemini generate failed: {e}")

    candidates = out.get("candidates")
    if not isinstance(candidates, list) or len(candidates) != 5:
        raise HTTPException(status_code=502, detail="Model did not return exactly 5 candidates")

    normalized: list[dict[str, Any]] = []
    for idx, c in enumerate(candidates):
        if not isinstance(c, dict) or not isinstance(c.get("text"), str) or not isinstance(c.get("mode"), str):
            raise HTTPException(status_code=502, detail="Invalid candidate format")
        out_c: dict[str, Any] = {"mode": str(c["mode"]), "text": c["text"]}
        if isinstance(c.get("style"), str) and str(c.get("style") or "").strip():
            out_c["style"] = str(c["style"])
        normalized.append(out_c)

    # Enforce mode order strictly (to avoid '5 paraphrases' failure).
    if [c["mode"] for c in normalized] != MODES_ORDERED:
        raise HTTPException(status_code=502, detail="Model returned wrong mode order")

    # Similarity check + partial regeneration (max 2 candidates, max 2 rounds)
    dedupe_meta: dict[str, Any] = {
        "metric": "char_bigram_jaccard",
        "threshold": 0.80,
        "rounds": 0,
        "replaced_modes": [],
        "dedupe_failed": False,
        "regen_raw": [],
    }

    for _round in range(2):
        idxs = _find_too_similar_indices(normalized, threshold=0.80, max_replace=2)
        if not idxs:
            break

        regen_modes = [normalized[i]["mode"] for i in idxs]
        try:
            regen_out, regen_raw = regenerate_candidates_json(
                input_text=req.text,
                fewshot_used=fewshot_used,
                existing_candidates=normalized,
                regen_modes=regen_modes,
            )
        except Exception as e:
            # If partial regeneration fails, keep original but surface info in gen_raw
            dedupe_meta["dedupe_failed"] = True
            dedupe_meta["error"] = f"partial_regen_failed:{e}"
            break

        repl = regen_out.get("candidates")
        if not isinstance(repl, list):
            dedupe_meta["dedupe_failed"] = True
            dedupe_meta["error"] = "partial_regen_invalid_json"
            break

        # Apply replacements by mode.
        by_mode: dict[str, str] = {}
        for c in repl:
            if not isinstance(c, dict):
                continue
            m = c.get("mode")
            t = c.get("text")
            if isinstance(m, str) and isinstance(t, str) and m in regen_modes:
                by_mode[m] = t

        for i in idxs:
            m = normalized[i]["mode"]
            if m in by_mode and by_mode[m].strip():
                normalized[i]["text"] = by_mode[m]

        dedupe_meta["rounds"] += 1
        dedupe_meta["replaced_modes"].extend(regen_modes)
        dedupe_meta["regen_raw"].append(regen_raw)

    # After attempts, if still too similar, leave as-is but mark failure.
    if _find_too_similar_indices(normalized, threshold=0.80, max_replace=1):
        if dedupe_meta["rounds"] > 0:
            dedupe_meta["dedupe_failed"] = True

    if isinstance(gen_raw, dict):
        gen_raw["dedupe"] = dedupe_meta

    return {
        "turn_id": req.turn_id,
        "candidates": normalized,
        "fewshot_used": fewshot_used,
        "gen_raw": gen_raw,
    }


@app.post("/api/label")
def api_label(req: LabelRequest) -> dict[str, Any]:
    if len(req.candidates) != 5:
        raise HTTPException(status_code=400, detail="candidates must be length 5")

    # Candidate modes must match the fixed 5 in order (anti-tamper)
    req_modes = [c.mode for c in req.candidates]
    if req_modes != MODES_ORDERED:
        raise HTTPException(status_code=400, detail="candidates.mode must match required order")

    if not req.reason_good_tags or len(req.reason_good_tags) < 1:
        raise HTTPException(status_code=400, detail="reason_good_tags must be non-empty")

    unknown_good = [t for t in (req.reason_good_tags or []) if t not in GOOD_REASON_TAG_IDS]
    if unknown_good:
        raise HTTPException(status_code=400, detail=f"unknown_reason_good_tags: {unknown_good}")

    unknown_bad = [t for t in (req.reason_bad_tags or []) if t not in BAD_REASON_TAG_IDS]
    if unknown_bad:
        raise HTTPException(status_code=400, detail=f"unknown_reason_bad_tags: {unknown_bad}")

    record_id = uuid4().hex
    now = datetime.now(timezone.utc).isoformat()

    candidates_full = [{"mode": c.mode, "text": c.text} for c in req.candidates]

    gen_raw = req.gen_ref or {}
    provider = str(gen_raw.get("provider") or "").strip() or "google-genai"
    model = str(gen_raw.get("model") or "").strip() or str(os.getenv("GEMINI_MODEL", "")).strip() or "unknown"

    params: dict[str, Any] = {}
    # Prefer runtime values from generation result if available.
    if gen_raw.get("temperature") is not None:
        params["temperature"] = gen_raw.get("temperature")
    else:
        try:
            params["temperature"] = float(os.getenv("GEMINI_TEMPERATURE", "0.8"))
        except Exception:
            pass
    # Optional params (store if configured)
    for env_key, out_key, cast in (
        ("GEMINI_TOP_P", "top_p", float),
        ("GEMINI_MAX_OUTPUT_TOKENS", "max_output_tokens", int),
        ("GEMINI_SEED", "seed", int),
    ):
        v = (os.getenv(env_key) or "").strip()
        if not v:
            continue
        try:
            params[out_key] = cast(v)
        except Exception:
            continue
    params["candidate_count"] = 5

    gen_meta = {
        "provider": provider,
        "model": model,
        "params": params,
        "prompt_hash": gen_raw.get("prompt_hash"),
        "raw": gen_raw,
    }

    row = {
        "schema_version": 1,
        "id": record_id,
        "ts": now,
        "turn_id": req.turn_id,
        "input": {
            "text": req.input_text,
            "raw_stt_text": req.raw_stt_text,
            "source": "stt" if (req.raw_stt_text or "").strip() else "typed",
            "meta": {},
        },
        "candidates": candidates_full,
        "winner_index": req.winner_index,
        "reason_good_tags": req.reason_good_tags,
        "reason_bad_tags": req.reason_bad_tags,
        "fewshot_used": req.fewshot_used,
        "stt": {
            "audio_path": (req.stt_ref or {}).get("audio_path"),
            "raw": (req.stt_ref or {}).get("raw"),
        },
        "gen": gen_meta,
    }

    # Basic JSON-serializability check
    try:
        json.dumps(row, ensure_ascii=False)
    except TypeError as e:
        raise HTTPException(status_code=500, detail=f"record not serializable: {e}")

    append_jsonl(LABELS_PATH, row)

    return {"ok": True}
