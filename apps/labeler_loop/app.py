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
from storage import append_jsonl

BASE_DIR = Path(__file__).resolve().parent
REPO_ROOT = BASE_DIR.parents[1]
STATIC_DIR = REPO_ROOT / "web" / "labeler_loop"
DATA_DIR = REPO_ROOT / "data" / "labeler_loop"
LABELS_PATH = DATA_DIR / "labels.jsonl"
AUDIO_DIR = DATA_DIR / "audio"

REASON_TAGS: list[dict[str, str]] = [
    {"id": "tempo_good", "desc": "テンポ良い/短い"},
    {"id": "metaphor_good", "desc": "比喩が刺さる"},
    {"id": "punch_good", "desc": "追い打ちが効いている"},
    {"id": "wrap_good", "desc": "オチ/巻き取りが良い"},
    {"id": "character_good", "desc": "キャラが立っている"},
    {"id": "too_long", "desc": "長い"},
    {"id": "too_safe", "desc": "無難/正論"},
    {"id": "unclear", "desc": "意味が分からない"},
    {"id": "too_mean", "desc": "刺し過ぎ/危険寄り"},
    {"id": "off_context", "desc": "状況ズレ"},
]
REASON_TAG_IDS = {t["id"] for t in REASON_TAGS}

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
    text: str


class LabelRequest(BaseModel):
    turn_id: str
    input_text: str
    raw_stt_text: str | None = None
    candidates: list[Candidate]
    winner_index: int = Field(ge=0, le=4)
    reason_tags: list[str] = Field(default_factory=list)
    stt_ref: dict[str, Any] | None = None
    fewshot_used: list[dict[str, Any]] = Field(default_factory=list)
    gen_ref: dict[str, Any] | None = None


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

    normalized: list[dict[str, str]] = []
    for c in candidates:
        if not isinstance(c, dict) or not isinstance(c.get("text"), str):
            raise HTTPException(status_code=502, detail="Invalid candidate format")
        normalized.append({"text": c["text"]})

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

    unknown = [t for t in (req.reason_tags or []) if t not in REASON_TAG_IDS]
    if unknown:
        raise HTTPException(status_code=400, detail=f"unknown_reason_tags: {unknown}")

    record_id = uuid4().hex
    now = datetime.now(timezone.utc).isoformat()

    candidates_text = [c.text for c in req.candidates]

    gen_raw = req.gen_ref or {}
    provider = str(gen_raw.get("provider") or "").strip() or "google-genai"
    model = str(gen_raw.get("model") or "").strip() or str(os.getenv("GEMINI_MODEL", "")).strip()

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
        "candidates": candidates_text,
        "winner_index": req.winner_index,
        "reason_tags": req.reason_tags,
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
