from __future__ import annotations

import json
import os
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

# Load env from repo-root .env/ (BOM-tolerant)
load_env_files(BASE_DIR)

app = FastAPI(title="labeler_loop")

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


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

    record_id = uuid4().hex
    now = datetime.now(timezone.utc).isoformat()

    candidates_text = [c.text for c in req.candidates]

    gen_meta = {
        "model": os.getenv("GEMINI_MODEL", ""),
        "params": {
            "temperature": float(os.getenv("GEMINI_TEMPERATURE", "0.8")),
        },
        "raw": req.gen_ref,
    }

    row = {
        "id": record_id,
        "ts": now,
        "turn_id": req.turn_id,
        "input": {
            "text": req.input_text,
            "source": "stt",
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
