from __future__ import annotations

import asyncio
import base64
import json
import re
import threading
import time
import traceback
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import RedirectResponse
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from apps.main.core.settings import load_settings
from apps.main.core.storage import JsonlWriter, read_json, tail_jsonl, utc_iso, write_json
from apps.main.core.types import ApproveIn, AssistantOutput, EventIn, PendingItem, RejectIn
from apps.main.live2d.hotkeys import HotkeyMap
from apps.main.live2d.vts_ws import VTubeStudioWS
from apps.main.obs.writer import OBSOverlayWriter
from apps.main.orchestrator.mvp_service import OrchestratorMVP
from apps.main.rag.long_term.store import LongTermStore
from apps.main.rag.short_term.memory import ShortTermMemory
from apps.main.rag.items_store import RagItemsStore
from apps.main.rag.turns_store import TurnsStore
from apps.main.core.prompts import read_prompt_text
from apps.main.tts.service import TTSService
from apps.main.vlm.screenshot import ScreenshotCapturer
from apps.main.vlm.summarizer import VLMSummarizer
from apps.main.llm.gemini_mvp import GeminiMVP
from apps.main.llm.openai_chat import OpenAIChatMVP
from apps.main.stt.google_service import GoogleSTTConfig, transcribe_wav_via_google
from apps.main.stt.webrtc_vad import webrtc_vad_filter
from apps.main.stt.whisper_service import WhisperConfig, transcribe_pcm, get_model


def _try_inject_motions_into_model3(model3_path: Path) -> None:
    """Best-effort: add FileReferences.Motions if missing.

    Some exported models (e.g. VTube Studio) may ship motions in the folder but
    not list them in the model3.json. Our web Stage relies on that field to
    map hotkeys -> motion playback.
    """
    try:
        import json

        if not model3_path.exists():
            return

        raw = json.loads(model3_path.read_text(encoding="utf-8"))
        fr = raw.get("FileReferences")
        if not isinstance(fr, dict):
            return

        # If already has motions, keep as-is.
        if isinstance(fr.get("Motions"), dict) and fr.get("Motions"):
            return

        folder = model3_path.parent
        motions = sorted({p.name for p in folder.glob("*.motion3.json")})
        if not motions:
            return

        fr["Motions"] = {
            "Main": [{"File": name} for name in motions]
        }
        raw["FileReferences"] = fr
        model3_path.write_text(json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        return


def _load_app_yaml(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except Exception:
        return {}


def _get_vlm_system_prompt(*, settings: Settings, appcfg: Dict[str, Any]) -> str:
    """Get VLM system prompt from persisted settings or config/prompts fallback."""
    try:
        lt = _get_long_term_store(settings=settings, appcfg=appcfg)
        txt = _get_long_term_doc_text(lt, doc_id="system_vlm")
        if (txt or "").strip():
            return str(txt)
    except Exception:
        pass
    return read_prompt_text(name="vlm_system")


def _safe_write_text(path: Path, text: str) -> bool:
    tmp = path.with_suffix(path.suffix + ".tmp")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp.write_text(text, encoding="utf-8")
        tmp.replace(path)
        return True
    except Exception:
        try:
            if tmp.exists():
                tmp.unlink(missing_ok=True)
        except Exception:
            pass
        return False


def _resolve_env_file() -> Path:
    import os

    repo_root = _repo_root()
    env_file_var = (os.getenv("AITUBER_ENV_FILE") or "").strip()
    if env_file_var:
        p = Path(env_file_var)
        return p if p.is_absolute() else (repo_root / p).resolve()

    env_dir = repo_root / ".env"
    if env_dir.is_dir():
        return env_dir / ".env"

    return repo_root / ".env"


def _update_env_vars(path: Path, updates: Dict[str, str]) -> bool:
    if not updates:
        return True

    raw_lines: List[str] = []
    try:
        raw_bytes = path.read_bytes()
        text: Optional[str] = None
        # Try common encodings for Windows/.env files.
        for enc in ("utf-8", "utf-8-sig", "utf-16", "utf-16-le", "utf-16-be", "cp932"):
            try:
                text = raw_bytes.decode(enc)
                break
            except Exception:
                continue
        if text is None:
            text = raw_bytes.decode("utf-8", errors="ignore")

        # If the file had a UTF-8 BOM, ensure it doesn't pollute the first key name.
        text = text.replace("\ufeff", "")
        raw_lines = text.splitlines()
    except Exception:
        raw_lines = []

    # Rewrite strategy (idempotent):
    # - remove ALL existing occurrences of the updated keys
    # - append one canonical line per updated key at the end
    out_lines: List[str] = []
    for line in raw_lines:
        m = re.match(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$", line)
        if not m:
            out_lines.append(line)
            continue
        key = m.group(1)
        if key in updates:
            continue
        out_lines.append(line)

    for key, value in updates.items():
        out_lines.append(f"{key}={value}")

    content = "\n".join(out_lines).rstrip() + "\n"
    return _safe_write_text(path, content)


def _update_hotkeys_yaml(path: Path, updates: Dict[str, str]) -> bool:
    if not updates:
        return True
    data: Dict[str, Any] = {}
    if path.exists():
        try:
            data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        except Exception:
            return False
    if not isinstance(data, dict):
        return False
    hotkeys = data.get("hotkeys")
    if not isinstance(hotkeys, dict):
        hotkeys = {}
    for tag, hotkey_id in updates.items():
        if not tag or not hotkey_id:
            continue
        hotkeys[str(tag)] = str(hotkey_id)
    data["hotkeys"] = hotkeys
    content = yaml.safe_dump(data, sort_keys=False, allow_unicode=True)
    return _safe_write_text(path, content)


def _console_settings_path(settings: "Settings") -> Path:
    return settings.data_dir / "config" / "console_settings.json"


def _load_console_settings(settings: "Settings") -> Dict[str, Any]:
    raw = read_json(_console_settings_path(settings))
    return raw if isinstance(raw, dict) else {}


def _get_long_term_store(*, settings: Settings, appcfg: Dict[str, Any]) -> LongTermStore:
    db_path = Path(appcfg.get("rag", {}).get("long_term_db_path", settings.data_dir / "rag/long_term.sqlite"))
    return LongTermStore(db_path=db_path)


def _rag_items_db_path(settings: Settings) -> Path:
    return settings.data_dir / "rag" / "rag_items.sqlite"


def _turns_db_path(settings: Settings) -> Path:
    return settings.data_dir / "rag" / "short_term_turns.sqlite"


def _get_long_term_doc_text(lt: LongTermStore, *, doc_id: str) -> str:
    try:
        doc = lt.get(doc_id=doc_id)
        if isinstance(doc, dict):
            return str(doc.get("text") or "")
    except Exception:
        pass
    return ""


def _get_long_term_doc_json(lt: LongTermStore, *, doc_id: str) -> Dict[str, Any]:
    raw = _get_long_term_doc_text(lt, doc_id=doc_id).strip()
    if not raw:
        return {}
    try:
        obj = json.loads(raw)
        return obj if isinstance(obj, dict) else {}
    except Exception:
        return {}


def _make_llm_and_vlm(
    *, settings: Settings, lt: LongTermStore, llm_provider: Optional[str] = None
) -> tuple[Any, VLMSummarizer]:
    llm_sys = _get_long_term_doc_text(lt, doc_id="system_llm").strip()
    vlm_sys = _get_long_term_doc_text(lt, doc_id="system_vlm").strip()
    llm_cfg = dict(_get_long_term_doc_json(lt, doc_id="settings_llm") or {})
    vlm_cfg = dict(_get_long_term_doc_json(lt, doc_id="settings_vlm") or {})

    console_cfg = _load_console_settings(settings)
    llm_console = console_cfg.get("llm")
    if isinstance(llm_console, dict):
        if "system_prompt" in llm_console:
            llm_sys = str(llm_console.get("system_prompt") or "").strip()
        char_prompt = str(llm_console.get("character_prompt") or "").strip()
        if char_prompt:
            llm_sys = (llm_sys + "\n\n" + char_prompt).strip() if llm_sys else char_prompt
        if "model" in llm_console:
            llm_cfg["model"] = str(llm_console.get("model") or "").strip()
        if "temperature" in llm_console:
            temp = _parse_float(llm_console.get("temperature"))
            if temp is not None:
                llm_cfg["temperature"] = temp
        if "max_output_tokens" in llm_console:
            max_tokens = _parse_int(llm_console.get("max_output_tokens"))
            if max_tokens is not None:
                llm_cfg["max_output_tokens"] = max_tokens

    vlm_console = console_cfg.get("vlm")
    if isinstance(vlm_console, dict):
        if "system_prompt" in vlm_console:
            vlm_sys = str(vlm_console.get("system_prompt") or "").strip()
        if "model" in vlm_console:
            vlm_cfg["model"] = str(vlm_console.get("model") or "").strip()
        if "temperature" in vlm_console:
            temp = _parse_float(vlm_console.get("temperature"))
            if temp is not None:
                vlm_cfg["temperature"] = temp
        if "max_output_tokens" in vlm_console:
            max_tokens = _parse_int(vlm_console.get("max_output_tokens"))
            if max_tokens is not None:
                vlm_cfg["max_output_tokens"] = max_tokens

    vlm_model = str(vlm_cfg.get("model") or settings.gemini_model).strip() or settings.gemini_model

    llm_gen: Dict[str, Any] = {}
    for k in ("temperature", "top_p", "max_output_tokens"):
        if k in llm_cfg:
            llm_gen[k] = llm_cfg.get(k)
    vlm_gen: Dict[str, Any] = {}
    for k in ("temperature", "top_p", "max_output_tokens"):
        if k in vlm_cfg:
            vlm_gen[k] = vlm_cfg.get(k)

    # Gemini models may allocate a large hidden "thought" budget from max_output_tokens,
    # causing extremely short visible outputs (FinishReason.MAX_TOKENS). Default to no thinking
    # unless the user explicitly sets it.
    if "thinking_config" not in llm_gen:
        llm_gen["thinking_config"] = {"thinking_budget": 0}
    if "thinking_config" not in vlm_gen:
        vlm_gen["thinking_config"] = {"thinking_budget": 0}

    prov = (llm_provider or settings.llm_provider or "gemini").strip().lower()
    if prov == "openai":
        llm_model = str(llm_cfg.get("model") or settings.openai_model).strip() or settings.openai_model
        llm = OpenAIChatMVP(
            api_key=settings.openai_api_key,
            model=llm_model,
            system_prompt=llm_sys or None,
            generation_config=llm_gen or None,
        )
    else:
        llm_model = str(llm_cfg.get("model") or settings.gemini_model).strip() or settings.gemini_model
        llm = GeminiMVP(
            api_key=settings.gemini_api_key,
            model=llm_model,
            system_prompt=llm_sys or None,
            generation_config=llm_gen or None,
        )
    vlm = VLMSummarizer(api_key=settings.gemini_api_key, model=vlm_model, system_prompt=vlm_sys or None, generation_config=vlm_gen or None)
    return llm, vlm


def _update_web_hotkeys_json(path: Path, updates: Dict[str, str]) -> bool:
    if not updates or not path.exists():
        return False
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return False
    if not isinstance(data, dict):
        return False
    changed = False
    for tag in updates:
        if tag not in data:
            data[tag] = ""
            changed = True
    if not changed:
        return True
    content = json.dumps(data, ensure_ascii=True, indent=2)
    return _safe_write_text(path, content)


def _extract_vts_hotkeys_by_name(resp: Dict[str, Any]) -> Dict[str, str]:
    if not resp or not isinstance(resp, dict) or not resp.get("ok"):
        return {}
    payload = resp.get("response")
    if not isinstance(payload, dict):
        return {}
    data = payload.get("data")
    if not isinstance(data, dict):
        data = payload
    hotkey_list = None
    for key in ("availableHotkeys", "hotkeys", "items"):
        if isinstance(data.get(key), list):
            hotkey_list = data.get(key)
            break
    if not hotkey_list:
        return {}
    out: Dict[str, str] = {}
    for item in hotkey_list:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or item.get("hotkeyName") or "").strip()
        hid = str(item.get("hotkeyID") or item.get("hotkeyId") or item.get("id") or "").strip()
        if name and hid:
            out[name] = hid
    return out


def _classify_gemini_notes(notes: str) -> Dict[str, Optional[str]]:
    raw = (notes or "").strip()
    low = raw.lower()
    if "missing_api_key" in low:
        return {"status": "not_called", "reason": None}
    if "gemini_failed" in low:
        reason = raw
        if "gemini_failed" in raw:
            reason = raw.split("gemini_failed", 1)[1]
        reason = reason.replace("|", " ").strip()
        reason_low = reason.lower()
        if "api_key" in reason_low or "apikey" in reason_low or "token" in reason_low or "aiza" in reason_low:
            reason = "[redacted]"
        return {"status": "failed", "reason": reason[:160] if reason else None}
    return {"status": "succeeded", "reason": None}


def _log_gemini_status(writer: JsonlWriter, *, candidate: AssistantOutput, model: str) -> None:
    notes = ""
    try:
        notes = str(candidate.safety.notes or "")
    except Exception:
        notes = ""
    info = _classify_gemini_notes(notes)
    status = info.get("status") or "succeeded"
    reason = info.get("reason")
    if status == "not_called":
        message = "Gemini not called"
    elif status == "failed":
        message = f"Gemini failed: {reason}" if reason else "Gemini failed"
    else:
        message = "Gemini call succeeded"
    writer.append(
        {
            "ts": utc_iso(),
            "run_id": _now_id(),
            "source": "llm",
            "type": "diagnostic",
            "message": message,
            "payload": {"status": status, "model": model, "reason": reason},
            "pii": {"contains_pii": False, "redacted": True},
        }
    )


def _parse_bool_flag(val: Any, *, default: bool = False) -> bool:
    if isinstance(val, bool):
        return val
    if val is None:
        return default
    s = str(val).strip().lower()
    if s in ("1", "true", "yes", "on"):
        return True
    if s in ("0", "false", "no", "off"):
        return False
    return default


def _parse_float(val: Any) -> Optional[float]:
    try:
        return float(val)
    except Exception:
        return None


def _parse_int(val: Any) -> Optional[int]:
    try:
        return int(val)
    except Exception:
        return None


_STT_BAD_PHRASES = [
    "\u3054\u8996\u8074\u3042\u308a\u304c\u3068\u3046\u3054\u3056\u3044\u307e\u3057\u305f[!！。.\\s]*",
    "\u3054\u6e05\u8074\u3042\u308a\u304c\u3068\u3046\u3054\u3056\u3044\u307e\u3057\u305f[!！。.\\s]*",
]


def _strip_transcript_phrases(text: str) -> str:
    out = text or ""
    for pat in _STT_BAD_PHRASES:
        try:
            out = re.sub(pat, "", out)
        except re.error:
            continue
    return out.strip()


def _should_filter_transcript(text: str) -> Optional[str]:
    cleaned = (text or "").strip()
    if not cleaned:
        return "empty"
    if len(cleaned) <= 1:
        return "too_short"
    return None


def _now_id() -> str:
    return time.strftime("%Y%m%d_%H%M%S")


def _repo_root() -> Path:
    # .../AITuber/apps/server/main.py -> repo root
    return Path(__file__).resolve().parents[2]


def _resolve_safe_path(p: str) -> Optional[Path]:
    """Resolve a user-provided path safely.

    Only allow reading files under the repository root.
    """
    try:
        rp = Path(p)
        if not rp.is_absolute():
            rp = (_repo_root() / rp).resolve()
        else:
            rp = rp.resolve()
        root = _repo_root().resolve()
        if root not in rp.parents and rp != root:
            return None
        return rp
    except Exception:
        return None


def _web_models_root() -> Path:
    return _repo_root() / "web" / "main" / "models"


def _safe_models_relpath(p: str) -> Optional[Path]:
    """Sanitize a user-provided models-relative path.

    Only allow paths under web/main/models.
    """
    try:
        raw = Path(str(p or "").replace("\\", "/"))
        parts = [x for x in raw.parts if x not in ("", ".")]
        if not parts:
            return None
        if any(x == ".." for x in parts):
            return None
        rel = Path(*parts)
        return rel
    except Exception:
        return None


def _pending_path(data_dir: Path) -> Path:
    return data_dir / "manager" / "pending.json"


def _state_path(data_dir: Path) -> Path:
    return data_dir / "state.json"


def _load_pending(data_dir: Path) -> Dict[str, Any]:
    return read_json(_pending_path(data_dir)) or {"items": []}


def _chat_log_path(data_dir: Path) -> Path:
    return data_dir / "logs" / "chat.jsonl"


def _append_chat_log(*, data_dir: Path, run_id: str, role: str, text: str, source: str, meta: Optional[Dict[str, Any]] = None) -> None:
    try:
        t = (text or "").strip()
        if not t:
            return
        writer = JsonlWriter(_chat_log_path(data_dir))
        writer.append(
            {
                "ts": utc_iso(),
                "run_id": run_id,
                "role": role,
                "source": source,
                "text": t,
                "meta": meta or {},
            }
        )
    except Exception:
        pass


def _save_pending(data_dir: Path, obj: Any) -> None:
    write_json(_pending_path(data_dir), obj)


def _append_pending(data_dir: Path, item: PendingItem) -> None:
    p = _load_pending(data_dir)
    items = list(p.get("items", []))
    items.append(item.model_dump(mode="json"))
    p["items"] = items
    _save_pending(data_dir, p)


def _update_pending(data_dir: Path, pending_id: str, patch: Dict[str, Any]) -> Optional[PendingItem]:
    p = _load_pending(data_dir)
    items = list(p.get("items", []))
    out_items = []
    found: Optional[PendingItem] = None
    for raw in items:
        try:
            it = PendingItem.model_validate(raw)
        except Exception:
            continue
        if it.pending_id == pending_id:
            merged = it.model_copy(deep=True)
            for k, v in patch.items():
                setattr(merged, k, v)
            found = merged
            out_items.append(merged.model_dump(mode="json"))
        else:
            out_items.append(it.model_dump(mode="json"))
    p["items"] = out_items
    _save_pending(data_dir, p)
    return found


def _load_state(data_dir: Path) -> Dict[str, Any]:
    return read_json(_state_path(data_dir)) or {}


def _save_state(data_dir: Path, state: Dict[str, Any]) -> None:
    write_json(_state_path(data_dir), state)


def _bump_live2d_seq(state: Dict[str, Any], *, tags: List[str], last_tag: Optional[str]) -> Dict[str, Any]:
    web = dict(state.get("live2d_web") or {})
    try:
        seq = int(web.get("seq") or 0)
    except Exception:
        seq = 0
    web["seq"] = seq + 1
    web["last_tag"] = last_tag
    web["last_tags"] = tags
    web["updated_at"] = utc_iso()
    state["live2d_web"] = web
    return state


def _normalize_data_url_to_b64(s: str) -> str:
    t = (s or "").strip()
    if not t:
        return ""
    if t.startswith("data:"):
        # data:image/jpeg;base64,....
        parts = t.split(",", 1)
        return parts[1] if len(parts) == 2 else ""
    return t


_vlm_lock = threading.Lock()
_last_vlm_fingerprint: Optional[list[int]] = None
_last_vlm_summary: str = ""
_last_vlm_summary_ts: float = 0.0
_vlm_thread_started = False


def _normalize_whisper_model_name(raw: str) -> str:
    name = (raw or "").strip()
    low = name.lower()
    if not low:
        return "large-v3-turbo"
    if low == "turbo":
        return "large-v3-turbo"
    return name


def _clamp_chunk_seconds(val: float) -> float:
    try:
        v = float(val)
    except Exception:
        v = 0.8
    return max(0.5, min(1.0, v))


def _iter_audio_chunks(audio, sample_rate: int, chunk_sec: float):
    chunk_len = int(round(chunk_sec * sample_rate))
    if chunk_len <= 0 or audio.size <= chunk_len:
        yield 0, audio
        return
    for start in range(0, audio.size, chunk_len):
        yield start, audio[start : start + chunk_len]


def _compute_image_fingerprint(path: Path) -> Optional[list[int]]:
    try:
        from PIL import Image

        img = Image.open(path).convert("L").resize((8, 8))
        pixels = list(img.getdata())
        if not pixels:
            return None
        avg = sum(pixels) / float(len(pixels))
        return [1 if p >= avg else 0 for p in pixels]
    except Exception:
        return None


def _diff_ratio(a: Optional[list[int]], b: Optional[list[int]]) -> float:
    if not a or not b or len(a) != len(b):
        return 1.0
    diff = sum(1 for i in range(len(a)) if a[i] != b[i])
    return float(diff) / float(len(a))


def _vlm_hash_path(settings: Settings) -> Path:
    return settings.data_dir / "vlm" / "last_hash.json"


def _load_last_vlm_fingerprint(settings: Settings) -> Optional[list[int]]:
    global _last_vlm_fingerprint
    if _last_vlm_fingerprint is not None:
        return _last_vlm_fingerprint
    try:
        raw = read_json(_vlm_hash_path(settings))
        if isinstance(raw, dict) and isinstance(raw.get("fp"), list):
            _last_vlm_fingerprint = [int(x) for x in raw.get("fp") or []]
    except Exception:
        _last_vlm_fingerprint = None
    return _last_vlm_fingerprint


def _save_last_vlm_fingerprint(settings: Settings, fp: list[int]) -> None:
    global _last_vlm_fingerprint
    _last_vlm_fingerprint = list(fp)
    try:
        write_json(_vlm_hash_path(settings), {"fp": _last_vlm_fingerprint})
    except Exception:
        pass


def _update_last_vlm_summary(summary: str) -> None:
    global _last_vlm_summary, _last_vlm_summary_ts
    _last_vlm_summary = summary
    _last_vlm_summary_ts = time.time()


def _get_latest_vlm_summary(events_path: Path, max_events: int = 200) -> str:
    try:
        for e in reversed(tail_jsonl(events_path, max_events)):
            if str(e.get("source") or "") == "vlm":
                msg = str(e.get("message") or "").strip()
                if msg:
                    return msg
    except Exception:
        pass
    return ""


def _get_cached_vlm_summary(events_path: Path, max_age_sec: float = 60.0) -> str:
    now = time.time()
    if _last_vlm_summary and (now - _last_vlm_summary_ts) <= max_age_sec:
        return _last_vlm_summary
    return _get_latest_vlm_summary(events_path)


def _text_requests_vlm(text: str) -> bool:
    t = (text or "").lower()
    for key in ("look", "see", "\u898b\u3066", "\u307f\u3066", "\u753b\u9762"):
        if key in t:
            return True
    return False


def _log_phase_timing(
    writer: JsonlWriter,
    *,
    run_id: str,
    source: str,
    phase: str,
    start: float,
    end: float,
    payload: Optional[Dict[str, Any]] = None,
) -> None:
    elapsed_ms = int(max(0.0, (end - start) * 1000.0))
    body = {
        "ts": utc_iso(),
        "run_id": run_id,
        "source": source,
        "type": "timing",
        "message": phase,
        "payload": {"elapsed_ms": elapsed_ms},
        "pii": {"contains_pii": False, "redacted": True},
    }
    if payload:
        body["payload"].update(payload)
    writer.append(body)


def _should_summarize_vlm(
    *, settings: Settings, fingerprint: Optional[list[int]], force: bool
) -> tuple[bool, float]:
    last_fp = _load_last_vlm_fingerprint(settings)
    diff = _diff_ratio(last_fp, fingerprint)
    if force or diff >= float(settings.vlm_diff_threshold):
        if fingerprint:
            _save_last_vlm_fingerprint(settings, fingerprint)
        return True, diff
    return False, diff


def _run_vlm_summary_sync(
    *,
    settings: Settings,
    appcfg: Dict[str, Any],
    reason: str,
    force: bool = False,
) -> str:
    data_dir = settings.data_dir
    events_path = data_dir / "events.jsonl"
    writer = JsonlWriter(events_path)
    run_id = _now_id()
    screenshot_path = Path(appcfg.get("vlm", {}).get("screenshot_path", settings.vlm_screenshot_path))

    t0 = time.perf_counter()
    out = ScreenshotCapturer(out_path=screenshot_path).capture()
    t1 = time.perf_counter()
    _log_phase_timing(
        writer,
        run_id=run_id,
        source="vlm",
        phase="vlm_capture",
        start=t0,
        end=t1,
        payload={"path": str(out.as_posix())},
    )

    fingerprint = _compute_image_fingerprint(out)
    should, diff = _should_summarize_vlm(settings=settings, fingerprint=fingerprint, force=force)
    if not should:
        return ""

    t2 = time.perf_counter()
    summ = VLMSummarizer(
        api_key=settings.gemini_api_key,
        model=settings.gemini_model,
        system_prompt=_get_vlm_system_prompt(settings=settings, appcfg=appcfg),
    ).summarize_screenshot(
        screenshot_path=out,
    )
    t3 = time.perf_counter()
    _log_phase_timing(
        writer,
        run_id=run_id,
        source="vlm",
        phase="vlm_summarize",
        start=t2,
        end=t3,
        payload={"diff": diff, "reason": reason},
    )

    if summ:
        _update_last_vlm_summary(summ)
        writer.append(
            {
                "ts": utc_iso(),
                "run_id": run_id,
                "source": "vlm",
                "type": "decision",
                "message": summ,
                "payload": {"path": str(out.as_posix()), "reason": reason, "diff": diff},
                "pii": {"contains_pii": False, "redacted": True},
            }
        )
    return summ


def _vlm_periodic_loop(period_seconds: float) -> None:
    while True:
        try:
            settings = load_settings()
            if not settings.vlm_enabled:
                time.sleep(period_seconds)
                continue
            appcfg = _load_app_yaml(Path("config/main/app.yaml"))
            _run_vlm_summary_sync(settings=settings, appcfg=appcfg, reason="periodic", force=False)
        except Exception:
            pass
        time.sleep(period_seconds)


def _start_vlm_periodic_thread() -> None:
    global _vlm_thread_started
    if _vlm_thread_started:
        return
    settings = load_settings()
    appcfg = _load_app_yaml(Path("config/main/app.yaml"))
    vlm_cfg = appcfg.get("vlm", {}) if isinstance(appcfg, dict) else {}
    mode = str(vlm_cfg.get("capture_mode") or "manual").strip().lower()
    if not settings.vlm_enabled or mode != "periodic":
        return
    try:
        period = float(vlm_cfg.get("periodic_seconds") or 30)
    except Exception:
        period = 30.0
    period = max(5.0, period)
    t = threading.Thread(target=_vlm_periodic_loop, args=(period,), daemon=True)
    t.start()
    _vlm_thread_started = True


async def _trigger_live2d_hotkeys(
    *,
    tags: List[str],
    hotkeys_path: Path,
    vts: VTubeStudioWS,
) -> Dict[str, Any]:
    hk = HotkeyMap.from_yaml(hotkeys_path)
    resolved: Dict[str, str] = {}
    unresolved: List[str] = []
    for tag in tags:
        hotkey_id = hk.resolve(tag)
        if hotkey_id:
            resolved[tag] = hotkey_id
        else:
            unresolved.append(tag)

    updates: Dict[str, str] = {}
    if unresolved:
        res = await vts.list_hotkeys()
        hotkeys_by_name = _extract_vts_hotkeys_by_name(res)
        for tag in unresolved:
            hotkey_id = hotkeys_by_name.get(tag)
            if hotkey_id:
                resolved[tag] = hotkey_id
                updates[tag] = hotkey_id

    if updates:
        _update_hotkeys_yaml(hotkeys_path, updates)
        _update_web_hotkeys_json(Path("web/main/hotkeys.json"), updates)

    triggered = []
    for tag in tags:
        hotkey_id = resolved.get(tag)
        if not hotkey_id:
            continue
        res = await vts.trigger_hotkey(hotkey_id=hotkey_id)
        triggered.append({"tag": tag, "hotkey_id": hotkey_id, "result": res})

    return {"ok": True, "triggered": triggered, "auto_mapped": updates}


class STTIn(BaseModel):
    text: str = Field(default="", min_length=1, max_length=1000)


class STTAudioOut(BaseModel):
    ok: bool = True
    text: str = ""
    error: Optional[str] = None
    vlm_summary: Optional[str] = None
    timing_ms: Optional[Dict[str, Any]] = None


class MotionIn(BaseModel):
    tag: str = Field(default="", min_length=1, max_length=80)


class WebSubmitIn(BaseModel):
    text: str = Field(default="", min_length=1, max_length=1000)
    include_vlm: bool = Field(default=False)
    vlm_image_base64: Optional[str] = None
    vlm_summary: Optional[str] = None
    llm_provider: Optional[str] = None
    tts_provider: Optional[str] = None


class ProviderUpdateIn(BaseModel):
    stt_provider: Optional[str] = None
    llm_provider: Optional[str] = None
    tts_provider: Optional[str] = None


app = FastAPI(title="AITuber MVP Server")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"] ,
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    settings = load_settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    (settings.data_dir / "audio").mkdir(parents=True, exist_ok=True)
    (settings.data_dir / "manager").mkdir(parents=True, exist_ok=True)
    (settings.data_dir / "obs").mkdir(parents=True, exist_ok=True)
    try:
        import os

        provider = (os.getenv("AITUBER_STT_PROVIDER") or settings.stt_provider or "local").strip().lower()
        if settings.stt_enabled and provider in ("local", "whisper", "faster-whisper"):
            model_name = _normalize_whisper_model_name(
                os.getenv("AITUBER_WHISPER_MODEL") or settings.whisper_model
            )
            compute_type = (os.getenv("AITUBER_WHISPER_COMPUTE_TYPE") or settings.whisper_compute_type or "int8").strip() or "int8"
            device = (os.getenv("AITUBER_WHISPER_DEVICE") or settings.whisper_device or "cpu").strip() or "cpu"
            cfg = WhisperConfig(model=model_name, device=device, compute_type=compute_type, language="ja")
            get_model(cfg)
    except Exception:
        pass
    _start_vlm_periodic_thread()


# Static mounts
# NOTE: We keep these mounts (as requested) for simple asset delivery.
# /stage and /console are served via web/index.html which redirects to stage.html/console.html.
Path("web/main").mkdir(parents=True, exist_ok=True)
Path("data/audio").mkdir(parents=True, exist_ok=True)
app.mount("/stage", StaticFiles(directory="web/main", html=True), name="stage")
app.mount("/console", StaticFiles(directory="web/main", html=True), name="console")
# NOTE: /models is optional; create the folder only when the user uploads models.
try:
    if Path("web/main/models").is_dir():
        app.mount("/models", StaticFiles(directory="web/main/models", html=True), name="models")
except Exception:
    pass
app.mount("/audio", StaticFiles(directory="data/audio", html=True), name="audio")


@app.get("/health")
def health() -> Dict[str, Any]:
    return {"ok": True}


@app.get("/")
def root() -> RedirectResponse:
    # Default to stage for streaming.
    return RedirectResponse(url="/stage")


@app.get("/api/models/index")
def models_index() -> Dict[str, Any]:
    """List available .model3.json files under web/models.

    Returned paths are relative to /models.
    """
    root = _web_models_root()
    if not root.is_dir():
        return {"ok": True, "items": []}

    out: List[str] = []
    try:
        for p in root.rglob("*.model3.json"):
            try:
                rel = p.relative_to(root).as_posix()
                out.append(rel)
            except Exception:
                continue
    except Exception:
        out = []

    out = sorted(set(out))
    return {"ok": True, "items": out}


@app.post("/api/models/upload")
async def models_upload(
    files: List[UploadFile] = File(...),
) -> Dict[str, Any]:
    """Upload a model folder from the browser into web/models.

    The client should send each file with filename=webkitRelativePath.
    Security: paths are sanitized to stay inside web/models.
    """
    root = _web_models_root()
    root.mkdir(parents=True, exist_ok=True)

    written: List[str] = []
    skipped: int = 0

    for f in files:
        rel = _safe_models_relpath(f.filename)
        if rel is None:
            skipped += 1
            continue
        data = await f.read()
        if not data:
            skipped += 1
            continue

        dest = (root / rel).resolve()
        # Ensure under root
        try:
            if root.resolve() not in dest.parents and dest != root.resolve():
                skipped += 1
                continue
        except Exception:
            skipped += 1
            continue

        dest.parent.mkdir(parents=True, exist_ok=True)
        try:
            dest.write_bytes(data)
            written.append(rel.as_posix())
        except Exception:
            skipped += 1

    # Post-process: inject motions into any uploaded model3.json missing it.
    try:
        for p in root.rglob("*.model3.json"):
            _try_inject_motions_into_model3(p)
    except Exception:
        pass

    return {"ok": True, "written": written, "skipped": skipped}


@app.get("/diagnostics")
def diagnostics() -> Dict[str, Any]:
    """Non-secret diagnostics for API connectivity.

    This endpoint never returns secrets.
    """
    settings = load_settings()
    gemini_key_set = bool((settings.gemini_api_key or "").strip())

    # Check Google ADC availability for TTS (best-effort)
    adc_ok = False
    adc_err: Optional[str] = None
    try:
        import google.auth

        google.auth.default()
        adc_ok = True
    except Exception as e:
        adc_err = f"{type(e).__name__}: {e}"[:200]

    return {
        "ok": True,
        "gemini": {
            "api_key_set": gemini_key_set,
            "model": settings.gemini_model,
        },
        "tts": {
            "provider": settings.tts_provider,
            "adc_ok": adc_ok,
            "adc_error": adc_err,
        },
        "vtube": {
            "ws_url": settings.vtube_ws_url,
            "auth_token_set": bool((settings.vtube_auth_token or "").strip()),
        },
    }




def _normalize_console_settings_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        return {}
    out: Dict[str, Any] = {}

    providers_in = payload.get("providers")
    if isinstance(providers_in, dict):
        providers: Dict[str, Any] = {}
        if "stt" in providers_in:
            providers["stt"] = str(providers_in.get("stt") or "").strip().lower()
        if "llm" in providers_in:
            providers["llm"] = str(providers_in.get("llm") or "").strip().lower()
        if "tts" in providers_in:
            providers["tts"] = str(providers_in.get("tts") or "").strip().lower()
        if providers:
            out["providers"] = providers

    llm_in = payload.get("llm")
    if isinstance(llm_in, dict):
        llm: Dict[str, Any] = {}
        if "system_prompt" in llm_in:
            llm["system_prompt"] = str(llm_in.get("system_prompt") or "")
        if "character_prompt" in llm_in:
            llm["character_prompt"] = str(llm_in.get("character_prompt") or "")
        if "model" in llm_in:
            llm["model"] = str(llm_in.get("model") or "")
        if "temperature" in llm_in:
            llm["temperature"] = _parse_float(llm_in.get("temperature"))
        if "max_output_tokens" in llm_in:
            llm["max_output_tokens"] = _parse_int(llm_in.get("max_output_tokens"))
        if llm:
            out["llm"] = llm

    vlm_in = payload.get("vlm")
    if isinstance(vlm_in, dict):
        vlm: Dict[str, Any] = {}
        if "system_prompt" in vlm_in:
            vlm["system_prompt"] = str(vlm_in.get("system_prompt") or "")
        if "model" in vlm_in:
            vlm["model"] = str(vlm_in.get("model") or "")
        if "temperature" in vlm_in:
            vlm["temperature"] = _parse_float(vlm_in.get("temperature"))
        if "max_output_tokens" in vlm_in:
            vlm["max_output_tokens"] = _parse_int(vlm_in.get("max_output_tokens"))
        if vlm:
            out["vlm"] = vlm

    toggles_in = payload.get("toggles")
    if isinstance(toggles_in, dict):
        toggles: Dict[str, Any] = {}
        if "stt" in toggles_in:
            toggles["stt"] = _parse_bool_flag(toggles_in.get("stt"), default=False)
        if "vlm" in toggles_in:
            toggles["vlm"] = _parse_bool_flag(toggles_in.get("vlm"), default=False)
        if "rag" in toggles_in:
            toggles["rag"] = _parse_bool_flag(toggles_in.get("rag"), default=False)
        if "short_term" in toggles_in:
            toggles["short_term"] = _parse_bool_flag(toggles_in.get("short_term"), default=False)
        if toggles:
            out["toggles"] = toggles

    rag_in = payload.get("rag")
    if isinstance(rag_in, dict):
        rag: Dict[str, Any] = {}
        if "short_term_max_events" in rag_in:
            rag["short_term_max_events"] = _parse_int(rag_in.get("short_term_max_events"))
        if "short_term_turns_to_prompt" in rag_in:
            rag["short_term_turns_to_prompt"] = _parse_int(rag_in.get("short_term_turns_to_prompt"))
        if rag:
            out["rag"] = rag

    return out


@app.post("/config/save_all")
def config_save_all(payload: Dict[str, Any]) -> Dict[str, Any]:
    import os

    settings = load_settings()
    appcfg = _load_app_yaml(Path("config/main/app.yaml"))
    cleaned = _normalize_console_settings_payload(payload)
    write_json(_console_settings_path(settings), cleaned)

    updates: Dict[str, str] = {}
    providers = cleaned.get("providers")
    if isinstance(providers, dict):
        stt = str(providers.get("stt") or "").strip().lower()
        if stt:
            updates["AITUBER_STT_PROVIDER"] = stt
        llm = str(providers.get("llm") or "").strip().lower()
        if llm:
            updates["AITUBER_LLM_PROVIDER"] = llm
        tts = str(providers.get("tts") or "").strip().lower()
        if tts:
            updates["AITUBER_TTS_PROVIDER"] = tts
    if updates:
        env_path = _resolve_env_file()
        _update_env_vars(env_path, updates)
        for key, value in updates.items():
            os.environ[key] = value

    lt = _get_long_term_store(settings=settings, appcfg=appcfg)
    llm_cfg = cleaned.get("llm")
    if isinstance(llm_cfg, dict):
        if "system_prompt" in llm_cfg:
            lt.upsert(
                doc_id="system_llm",
                text=str(llm_cfg.get("system_prompt") or ""),
                source="console",
                created_at=utc_iso(),
            )
        llm_settings: Dict[str, Any] = {}
        if "model" in llm_cfg:
            llm_settings["model"] = llm_cfg.get("model")
        if llm_cfg.get("temperature") is not None:
            llm_settings["temperature"] = llm_cfg.get("temperature")
        if llm_cfg.get("max_output_tokens") is not None:
            llm_settings["max_output_tokens"] = llm_cfg.get("max_output_tokens")
        if llm_settings:
            lt.upsert(
                doc_id="settings_llm",
                text=json.dumps(llm_settings, ensure_ascii=False),
                source="console",
                created_at=utc_iso(),
            )

    vlm_cfg = cleaned.get("vlm")
    if isinstance(vlm_cfg, dict):
        if "system_prompt" in vlm_cfg:
            lt.upsert(
                doc_id="system_vlm",
                text=str(vlm_cfg.get("system_prompt") or ""),
                source="console",
                created_at=utc_iso(),
            )
        vlm_settings: Dict[str, Any] = {}
        if "model" in vlm_cfg:
            vlm_settings["model"] = vlm_cfg.get("model")
        if vlm_cfg.get("temperature") is not None:
            vlm_settings["temperature"] = vlm_cfg.get("temperature")
        if vlm_cfg.get("max_output_tokens") is not None:
            vlm_settings["max_output_tokens"] = vlm_cfg.get("max_output_tokens")
        if vlm_settings:
            lt.upsert(
                doc_id="settings_vlm",
                text=json.dumps(vlm_settings, ensure_ascii=False),
                source="console",
                created_at=utc_iso(),
            )

    return {"ok": True}


@app.get("/config/load_all")
def config_load_all() -> Dict[str, Any]:
    settings = load_settings()
    appcfg = _load_app_yaml(Path("config/main/app.yaml"))
    lt = _get_long_term_store(settings=settings, appcfg=appcfg)
    raw = _load_console_settings(settings)

    # Providers are intentionally locked for this workflow:
    # - LLM: Gemini
    # - TTS: Google Cloud TTS
    providers_raw = raw.get("providers") if isinstance(raw, dict) else {}
    providers: Dict[str, Any] = {
        "stt": str(providers_raw.get("stt") or settings.stt_provider or "local")
        if "stt" not in providers_raw
        else str(providers_raw.get("stt") or ""),
        "llm": "gemini",
        "tts": "google",
    }

    llm_raw = raw.get("llm") if isinstance(raw, dict) else {}
    llm_store = _get_long_term_doc_json(lt, doc_id="settings_llm")
    llm_sys = (
        str(llm_raw.get("system_prompt") or "")
        if isinstance(llm_raw, dict) and "system_prompt" in llm_raw
        else _get_long_term_doc_text(lt, doc_id="system_llm")
    )
    if not (llm_sys or "").strip():
        llm_sys = read_prompt_text(name="llm_system")
    llm_char = (
        str(llm_raw.get("character_prompt") or "")
        if isinstance(llm_raw, dict) and "character_prompt" in llm_raw
        else ""
    )
    llm_provider = "gemini"
    default_llm_model = settings.gemini_model
    llm_model = (
        llm_raw.get("model")
        if isinstance(llm_raw, dict) and "model" in llm_raw
        else llm_store.get("model") or default_llm_model
    )
    llm_temp = (
        llm_raw.get("temperature")
        if isinstance(llm_raw, dict) and "temperature" in llm_raw and llm_raw.get("temperature") is not None
        else llm_store.get("temperature")
    )
    if llm_temp is None:
        llm_temp = 0.7
    llm_max_tokens = (
        llm_raw.get("max_output_tokens")
        if isinstance(llm_raw, dict) and "max_output_tokens" in llm_raw and llm_raw.get("max_output_tokens") is not None
        else llm_store.get("max_output_tokens")
    )
    if llm_max_tokens is None:
        llm_max_tokens = 2048

    vlm_raw = raw.get("vlm") if isinstance(raw, dict) else {}
    vlm_store = _get_long_term_doc_json(lt, doc_id="settings_vlm")
    vlm_sys = (
        str(vlm_raw.get("system_prompt") or "")
        if isinstance(vlm_raw, dict) and "system_prompt" in vlm_raw
        else _get_long_term_doc_text(lt, doc_id="system_vlm")
    )
    if not (vlm_sys or "").strip():
        vlm_sys = read_prompt_text(name="vlm_system")
    vlm_model = (
        vlm_raw.get("model")
        if isinstance(vlm_raw, dict) and "model" in vlm_raw
        else vlm_store.get("model") or settings.gemini_model
    )
    vlm_temp = (
        vlm_raw.get("temperature")
        if isinstance(vlm_raw, dict) and "temperature" in vlm_raw and vlm_raw.get("temperature") is not None
        else vlm_store.get("temperature")
    )
    if vlm_temp is None:
        vlm_temp = 0.2
    vlm_max_tokens = (
        vlm_raw.get("max_output_tokens")
        if isinstance(vlm_raw, dict) and "max_output_tokens" in vlm_raw and vlm_raw.get("max_output_tokens") is not None
        else vlm_store.get("max_output_tokens")
    )
    if vlm_max_tokens is None:
        vlm_max_tokens = 256

    toggles_raw = raw.get("toggles") if isinstance(raw, dict) else {}
    toggles = {
        "stt": _parse_bool_flag(toggles_raw.get("stt"), default=settings.stt_enabled)
        if isinstance(toggles_raw, dict) and "stt" in toggles_raw
        else settings.stt_enabled,
        "vlm": _parse_bool_flag(toggles_raw.get("vlm"), default=settings.vlm_enabled)
        if isinstance(toggles_raw, dict) and "vlm" in toggles_raw
        else settings.vlm_enabled,
        "rag": _parse_bool_flag(toggles_raw.get("rag"), default=settings.rag_enabled)
        if isinstance(toggles_raw, dict) and "rag" in toggles_raw
        else settings.rag_enabled,
        "short_term": _parse_bool_flag(toggles_raw.get("short_term"), default=settings.short_term_enabled)
        if isinstance(toggles_raw, dict) and "short_term" in toggles_raw
        else settings.short_term_enabled,
    }

    rag_raw = raw.get("rag") if isinstance(raw, dict) else {}
    short_term_max_events = settings.short_term_max_events
    if isinstance(rag_raw, dict) and "short_term_max_events" in rag_raw:
        val = _parse_int(rag_raw.get("short_term_max_events"))
        if val is not None:
            short_term_max_events = val

    short_term_turns_to_prompt = settings.short_term_turns_to_prompt
    if isinstance(rag_raw, dict) and "short_term_turns_to_prompt" in rag_raw:
        val = _parse_int(rag_raw.get("short_term_turns_to_prompt"))
        if val is not None:
            short_term_turns_to_prompt = val

    return {
        "ok": True,
        "settings": {
            "providers": providers,
            "llm": {
                "system_prompt": llm_sys,
                "character_prompt": llm_char,
                "model": llm_model,
                "temperature": llm_temp,
                "max_output_tokens": llm_max_tokens,
            },
            "vlm": {
                "system_prompt": vlm_sys,
                "model": vlm_model,
                "temperature": vlm_temp,
                "max_output_tokens": vlm_max_tokens,
            },
            "toggles": toggles,
            "rag": {
                "short_term_max_events": short_term_max_events,
                "short_term_turns_to_prompt": short_term_turns_to_prompt,
            },
        },
    }


@app.get("/tts/health")
def tts_health() -> Dict[str, Any]:
    """Health check for Google Cloud TTS credentials (fast, no audio generated)."""
    settings = load_settings()
    try:
        from google.cloud import texttospeech

        client = texttospeech.TextToSpeechClient()
        # A lightweight call to verify auth works.
        _ = client.list_voices(language_code="ja-JP")
        return {"ok": True, "provider": "google", "voice": settings.tts_voice}
    except Exception as e:
        return {"ok": False, "provider": "google", "error": f"{type(e).__name__}: {e}"[:200]}

@app.post("/config/providers")
def config_providers(req: ProviderUpdateIn) -> Dict[str, Any]:
    import os

    updates: Dict[str, str] = {}

    stt = (req.stt_provider or "").strip().lower()
    if stt in ("local", "google"):
        updates["AITUBER_STT_PROVIDER"] = stt

    llm = (req.llm_provider or "").strip().lower()
    if llm in ("gemini",):
        updates["AITUBER_LLM_PROVIDER"] = "gemini"

    tts = (req.tts_provider or "").strip().lower()
    if tts in ("google",):
        updates["AITUBER_TTS_PROVIDER"] = "google"

    if not updates:
        return {"ok": False, "error": "no_valid_updates"}

    env_path = _resolve_env_file()
    if not _update_env_vars(env_path, updates):
        return {"ok": False, "error": "write_failed"}

    for key, value in updates.items():
        os.environ[key] = value

    return {"ok": True, "updated": list(updates.keys())}


@app.get("/rag/short_term/recent")
def rag_short_term_recent(max_events: Optional[int] = None) -> Dict[str, Any]:
    settings = load_settings()
    events_path = settings.data_dir / "events.jsonl"
    st = ShortTermMemory(events_path=events_path)
    limit = settings.short_term_max_events if max_events is None else max_events
    return {"ok": True, "text": st.recent_text(max_events=limit)}


@app.get("/rag/short_term/list")
def rag_short_term_list(limit: int = 50) -> Dict[str, Any]:
    settings = load_settings()
    events_path = settings.data_dir / "events.jsonl"
    st = ShortTermMemory(events_path=events_path)
    items = st.list(limit=limit, newest_first=True)
    return {"ok": True, "items": items}


@app.post("/rag/short_term/delete")
def rag_short_term_delete(payload: Dict[str, Any]) -> Dict[str, Any]:
    row_id = payload.get("id") if isinstance(payload, dict) else None
    if row_id is None:
        return {"ok": False, "error": "missing_id"}
    settings = load_settings()
    events_path = settings.data_dir / "events.jsonl"
    st = ShortTermMemory(events_path=events_path)
    ok = st.delete(row_id=row_id)
    return {"ok": ok}


@app.get("/rag/long_term/search")
def rag_long_term_search(q: str, limit: int = 5) -> Dict[str, Any]:
    settings = load_settings()
    appcfg = _load_app_yaml(Path("config/main/app.yaml"))
    db_path = Path(appcfg.get("rag", {}).get("long_term_db_path", settings.data_dir / "rag/long_term.sqlite"))
    lt = LongTermStore(db_path=db_path)
    hits = lt.search(query=q, limit=limit)
    return {"ok": True, "hits": [{"doc_id": doc_id, "snippet": snip} for doc_id, snip in hits]}


@app.get("/rag/long_term/list")
def rag_long_term_list(limit: int = 200) -> Dict[str, Any]:
    settings = load_settings()
    appcfg = _load_app_yaml(Path("config/main/app.yaml"))
    db_path = Path(appcfg.get("rag", {}).get("long_term_db_path", settings.data_dir / "rag/long_term.sqlite"))
    lt = LongTermStore(db_path=db_path)
    items = lt.list(limit=limit)
    hidden = {"system_llm", "settings_llm", "system_vlm", "settings_vlm"}
    items = [it for it in items if str(it.get("doc_id") or "") not in hidden]
    return {"ok": True, "items": items}


@app.post("/rag/long_term/delete")
def rag_long_term_delete(payload: Dict[str, Any]) -> Dict[str, Any]:
    did = str(payload.get("doc_id") or "").strip() if isinstance(payload, dict) else ""
    if not did:
        return {"ok": False, "error": "missing_doc_id"}
    settings = load_settings()
    appcfg = _load_app_yaml(Path("config/main/app.yaml"))
    db_path = Path(appcfg.get("rag", {}).get("long_term_db_path", settings.data_dir / "rag/long_term.sqlite"))
    lt = LongTermStore(db_path=db_path)
    ok = lt.delete(doc_id=did)
    return {"ok": ok}


@app.get("/rag/long_term/get")
def rag_long_term_get(doc_id: str) -> Dict[str, Any]:
    did = (doc_id or "").strip()
    if not did:
        return {"ok": False, "error": "missing_doc_id"}
    settings = load_settings()
    appcfg = _load_app_yaml(Path("config/main/app.yaml"))
    db_path = Path(appcfg.get("rag", {}).get("long_term_db_path", settings.data_dir / "rag/long_term.sqlite"))
    lt = LongTermStore(db_path=db_path)
    doc = lt.get(doc_id=did)
    if not doc:
        return {"ok": False, "error": "not_found"}
    return {
        "ok": True,
        "doc_id": doc.get("doc_id"),
        "text": doc.get("text"),
        "source": doc.get("source"),
        "created_at": doc.get("created_at"),
    }


@app.post("/rag/long_term/upsert")
def rag_long_term_upsert(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Upsert long-term memory documents.

    Payload example:
      {"doc_id":"persona", "text":"...", "source":"persona"}
    """
    settings = load_settings()
    appcfg = _load_app_yaml(Path("config/main/app.yaml"))
    db_path = Path(appcfg.get("rag", {}).get("long_term_db_path", settings.data_dir / "rag/long_term.sqlite"))
    lt = LongTermStore(db_path=db_path)

    doc_id = str(payload.get("doc_id", "")).strip() or f"doc_{_now_id()}"
    text = str(payload.get("text", "")).strip()
    source = str(payload.get("source", "script")).strip() or "script"
    if not text:
        return {"ok": False, "error": "missing_text"}

    lt.upsert(doc_id=doc_id, text=text, source=source, created_at=utc_iso())
    JsonlWriter(settings.data_dir / "events.jsonl").append(
        {
            "ts": utc_iso(),
            "run_id": doc_id,
            "source": "rag",
            "type": "artifact",
            "message": f"upsert long_term: {doc_id}",
            "payload": {"doc_id": doc_id, "source": source},
            "pii": {"contains_pii": False, "redacted": True},
        }
    )
    return {"ok": True, "doc_id": doc_id}


@app.post("/vlm/capture")
def vlm_capture() -> Dict[str, Any]:
    settings = load_settings()
    appcfg = _load_app_yaml(Path("config/main/app.yaml"))
    screenshot_path = Path(appcfg.get("vlm", {}).get("screenshot_path", settings.vlm_screenshot_path))
    out = ScreenshotCapturer(out_path=screenshot_path).capture()
    JsonlWriter(settings.data_dir / "events.jsonl").append(
        {
            "ts": utc_iso(),
            "run_id": _now_id(),
            "source": "vlm",
            "type": "artifact",
            "message": "screenshot captured",
            "payload": {"path": str(out.as_posix())},
            "pii": {"contains_pii": False, "redacted": True},
        }
    )
    return {"ok": True, "path": str(out.as_posix())}


@app.get("/vlm/summary")
def vlm_summary() -> Dict[str, Any]:
    settings = load_settings()
    appcfg = _load_app_yaml(Path("config/main/app.yaml"))
    screenshot_path = Path(appcfg.get("vlm", {}).get("screenshot_path", settings.vlm_screenshot_path))
    summ = VLMSummarizer(
        api_key=settings.gemini_api_key,
        model=settings.gemini_model,
        system_prompt=_get_vlm_system_prompt(settings=settings, appcfg=appcfg),
    ).summarize_screenshot(screenshot_path=screenshot_path)
    JsonlWriter(settings.data_dir / "events.jsonl").append(
        {
            "ts": utc_iso(),
            "run_id": _now_id(),
            "source": "vlm",
            "type": "decision",
            "message": summ,
            "payload": {"screenshot": str(screenshot_path.as_posix())},
            "pii": {"contains_pii": False, "redacted": True},
        }
    )
    return {"ok": True, "summary": summ}


@app.post("/vlm/summary_from_path")
def vlm_summary_from_path(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Summarize an existing image file by path.

    Safety: only allows paths within the repository root.
    Example payload: {"path": "tests/image_test.jpg"}
    """
    settings = load_settings()
    appcfg = _load_app_yaml(Path("config/main/app.yaml"))
    p = str(payload.get("path", "")).strip()
    if not p:
        return {"ok": False, "error": "missing_path"}

    safe = _resolve_safe_path(p)
    if safe is None or not safe.exists():
        return {"ok": False, "error": "invalid_path"}

    summ = VLMSummarizer(
        api_key=settings.gemini_api_key,
        model=settings.gemini_model,
        system_prompt=_get_vlm_system_prompt(settings=settings, appcfg=appcfg),
    ).summarize_screenshot(screenshot_path=safe)
    JsonlWriter(settings.data_dir / "events.jsonl").append(
        {
            "ts": utc_iso(),
            "run_id": _now_id(),
            "source": "vlm",
            "type": "decision",
            "message": summ,
            "payload": {"path": str(safe.as_posix())},
            "pii": {"contains_pii": False, "redacted": True},
        }
    )
    return {"ok": True, "path": str(safe.as_posix()), "summary": summ}


@app.get("/live2d/hotkeys")
def live2d_hotkeys() -> Dict[str, Any]:
    settings = load_settings()
    vts = VTubeStudioWS(
        ws_url=settings.vtube_ws_url,
        auth_token=settings.vtube_auth_token,
        plugin_name=settings.vtube_plugin_name,
        plugin_developer=settings.vtube_plugin_developer,
    )
    try:
        return asyncio.run(vts.list_hotkeys())
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.get("/state")
def get_state() -> Dict[str, Any]:
    settings = load_settings()
    st = read_json(_state_path(settings.data_dir)) or {}
    return {"ok": True, "state": st}


@app.get("/overlay_text")
def overlay_text() -> Dict[str, Any]:
    settings = load_settings()
    st = _load_state(settings.data_dir)
    overlay = str(st.get("overlay_text") or "")
    speech = str(st.get("speech_text") or "")
    tts_path = str(st.get("tts_path") or "")
    tts_version = st.get("tts_version")
    request_id = str(st.get("request_id") or "")
    tts_queue = st.get("tts_queue") if isinstance(st.get("tts_queue"), list) else []
    tts_queue_version = st.get("tts_queue_version")
    if tts_version is None:
        # best-effort fallback: mtime of tts_latest.wav
        try:
            p = settings.data_dir / "audio" / "tts_latest.wav"
            if p.exists():
                tts_version = int(p.stat().st_mtime_ns)
        except Exception:
            tts_version = None
    return {
        "ok": True,
        "overlay_text": overlay,
        "speech_text": speech,
        "tts_path": tts_path,
        "tts_version": tts_version,
        "request_id": request_id,
        "tts_queue": tts_queue,
        "tts_queue_version": tts_queue_version,
        "updated_at": st.get("updated_at"),
    }


@app.get("/rag/list")
def rag_list(type: str) -> Dict[str, Any]:
    rt = (type or "").strip().lower()
    if rt not in ("short", "long"):
        return {"ok": False, "error": "invalid_type"}
    settings = load_settings()
    store = RagItemsStore(db_path=_rag_items_db_path(settings))
    try:
        items = store.list(rag_type=rt, limit=500)
        return {"ok": True, "items": items}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"[:200]}


@app.post("/rag/add")
def rag_add(payload: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        return {"ok": False, "error": "invalid_payload"}
    rt = str(payload.get("rag_type") or "").strip().lower()
    title = str(payload.get("title") or "")
    text = str(payload.get("text") or "")
    settings = load_settings()
    store = RagItemsStore(db_path=_rag_items_db_path(settings))
    try:
        row_id = store.add(rag_type=rt, title=title, text=text, created_at=utc_iso())
        return {"ok": True, "id": row_id}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"[:200]}


@app.post("/rag/delete")
def rag_delete(payload: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        return {"ok": False, "error": "invalid_payload"}
    row_id = payload.get("id")
    if row_id is None:
        return {"ok": False, "error": "missing_id"}
    settings = load_settings()
    store = RagItemsStore(db_path=_rag_items_db_path(settings))
    try:
        ok = store.delete(row_id=int(row_id))
        return {"ok": ok}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"[:200]}


@app.get("/turns/list")
def turns_list(limit: int = 200) -> Dict[str, Any]:
    settings = load_settings()
    store = TurnsStore(db_path=_turns_db_path(settings))
    try:
        items = store.list(limit=limit)
        return {"ok": True, "items": items}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"[:200]}


@app.post("/turns/delete")
def turns_delete(payload: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        return {"ok": False, "error": "invalid_payload"}
    row_id = payload.get("id")
    if row_id is None:
        return {"ok": False, "error": "missing_id"}
    settings = load_settings()
    store = TurnsStore(db_path=_turns_db_path(settings))
    try:
        ok = store.delete(row_id=int(row_id))
        return {"ok": ok}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"[:200]}


@app.post("/turns/clear")
def turns_clear() -> Dict[str, Any]:
    settings = load_settings()
    store = TurnsStore(db_path=_turns_db_path(settings))
    try:
        store.clear()
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"[:200]}


def _split_sentences(text: str) -> tuple[list[str], str]:
    """Return (completed_sentences, remainder)."""
    if not text:
        return [], ""
    buf = text
    out: list[str] = []
    seps = set(["。", "！", "?", "？", "!", "\n"])
    start = 0
    for i, ch in enumerate(buf):
        if ch in seps:
            s = buf[start : i + 1].strip()
            start = i + 1
            if s:
                out.append(s)
    rem = buf[start:]
    return out, rem


def _build_stream_prompt(*, user_text: str, rag_context: str, vlm_summary: str, system_prompt: str) -> tuple[str, str]:
    sys = (system_prompt or "").strip() or read_prompt_text(name="llm_system").strip()
    prompt = (
        "次の入力と文脈を踏まえて、日本語で自然に返答してください。\n"
        "- 返答はそのまま字幕/音声に使います（要約しない）\n"
        "- できるだけ早く返事を開始できるよう、短い文から書き始めてください\n"
        "- 改行しても良い\n\n"
        f"user_text: {user_text}\n\n"
        f"vlm_summary: {vlm_summary}\n\n"
        f"rag_context:\n{rag_context}\n"
    )
    return sys, prompt


def _stream_llm_text(
    *,
    llm_provider: str,
    settings: Settings,
    system_prompt: str,
    prompt: str,
    max_tokens: int,
) -> str:
    """Best-effort streaming: returns full text, but yields early through state updates in the caller."""
    prov = (llm_provider or "").strip().lower() or "gemini"
    if prov == "openai":
        try:
            from openai import OpenAI

            client = OpenAI(api_key=settings.openai_api_key, timeout=20.0)
            stream = client.chat.completions.create(
                model=settings.openai_model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt},
                ],
                stream=True,
                max_tokens=max_tokens,
            )
            chunks: list[str] = []
            for chunk in stream:
                delta = chunk.choices[0].delta
                content = ""
                if isinstance(delta, dict):
                    content = delta.get("content") or ""
                else:
                    content = getattr(delta, "content", "") or ""
                if content:
                    chunks.append(content)
            return "".join(chunks)
        except Exception:
            return "了解。"

    # Gemini fallback (non-stream or SDK-dependent stream)
    if not (settings.gemini_api_key or "").strip():
        return "（Gemini APIキー未設定: フォールバック）"

    timeout_seconds = 12
    try:
        import concurrent.futures

        from google import genai

        client = genai.Client(api_key=settings.gemini_api_key)

        def _call() -> Any:
            kwargs: Dict[str, Any] = {
                "model": settings.gemini_model,
                "contents": [
                    {"role": "user", "parts": [{"text": system_prompt + "\n\n" + prompt}]},
                ],
            }
            return client.models.generate_content(**kwargs)

        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
            fut = ex.submit(_call)
            resp = fut.result(timeout=timeout_seconds)

        out = (getattr(resp, "text", "") or "").strip()
        return out or "了解。"
    except concurrent.futures.TimeoutError:
        return "（Gemini timeout: フォールバック）"
    except Exception:
        return "了解。"


@app.get("/state/live2d")
def state_live2d() -> Dict[str, Any]:
    settings = load_settings()
    st = _load_state(settings.data_dir)
    web = dict(st.get("live2d_web") or {})
    return {
        "ok": True,
        "model": web.get("model"),
        "seq": web.get("seq", 0),
        "last_tag": web.get("last_tag"),
        "last_tags": web.get("last_tags", []),
        "motion_tags": st.get("motion_tags", []),
        "updated_at": web.get("updated_at") or st.get("updated_at"),
    }


@app.post("/motion")
def post_motion(req: MotionIn) -> Dict[str, Any]:
    settings = load_settings()
    data_dir = settings.data_dir
    st = _load_state(data_dir)
    tag = (req.tag or "").strip()
    if not tag:
        return {"ok": False, "error": "missing_tag"}
    st = _bump_live2d_seq(st, tags=[tag], last_tag=tag)
    st["updated_at"] = utc_iso()
    _save_state(data_dir, st)
    JsonlWriter(data_dir / "events.jsonl").append(
        {
            "ts": utc_iso(),
            "run_id": _now_id(),
            "source": "manager",
            "type": "decision",
            "message": f"motion: {tag}",
            "payload": {"tag": tag},
            "pii": {"contains_pii": False, "redacted": True},
        }
    )
    return {"ok": True, "tag": tag, "seq": (st.get("live2d_web") or {}).get("seq", 0)}


@app.post("/vlm/frame")
async def vlm_frame(
    image_base64: Optional[str] = Form(default=None),
    file: Optional[UploadFile] = File(default=None),
) -> Dict[str, Any]:
    """Accept a camera frame and summarize it.

    Accepts either:
    - multipart/form-data with a file field
    - multipart/form-data with image_base64 (data URL or raw base64)
    """
    settings = load_settings()
    data_dir = settings.data_dir
    events_path = data_dir / "events.jsonl"
    writer = JsonlWriter(events_path)

    img_bytes: bytes = b""
    mime: Optional[str] = None

    if file is not None:
        img_bytes = await file.read()
        mime = (file.content_type or "").strip() or None
    else:
        b64 = _normalize_data_url_to_b64(image_base64 or "")
        if b64:
            try:
                img_bytes = base64.b64decode(b64, validate=False)
            except Exception:
                img_bytes = b""

    if not img_bytes:
        return {"ok": False, "error": "missing_image"}

    appcfg = _load_app_yaml(Path("config/main/app.yaml"))
    summ = VLMSummarizer(
        api_key=settings.gemini_api_key,
        model=settings.gemini_model,
        system_prompt=_get_vlm_system_prompt(settings=settings, appcfg=appcfg),
    ).summarize_image_bytes(
        image_bytes=img_bytes,
        mime_type=mime,
    )

    # Privacy: only store the summary (never persist frames).
    writer.append(
        {
            "ts": utc_iso(),
            "run_id": _now_id(),
            "source": "vlm",
            "type": "input",
            "message": summ,
            "payload": {"source": "webcam"},
            "pii": {"contains_pii": False, "redacted": True},
        }
    )
    return {"ok": True, "summary": summ}


def _handle_event(event: EventIn) -> Dict[str, Any]:
    """Shared handler for /events and /stt/text."""
    settings = load_settings()

    # Load non-secret yaml config (best-effort)
    appcfg = _load_app_yaml(Path("config/main/app.yaml"))

    data_dir = settings.data_dir
    events_path = data_dir / "events.jsonl"
    writer = JsonlWriter(events_path)

    screenshot_path = Path(appcfg.get("vlm", {}).get("screenshot_path", settings.vlm_screenshot_path))
    event.include_vlm = bool(event.include_vlm and settings.vlm_enabled)
    if event.include_vlm and not (event.vlm_summary or "").strip():
        cached = _get_cached_vlm_summary(events_path)
        if cached:
            event.vlm_summary = cached

    run_id = _now_id()
    _append_chat_log(data_dir=data_dir, run_id=run_id, role="user", text=event.text, source=event.source)
    writer.append(
        {
            "ts": utc_iso(),
            "run_id": run_id,
            "source": event.source,
            "type": "input",
            "message": event.text,
            "payload": {"include_vlm": event.include_vlm, "vlm_image_path": event.vlm_image_path},
            "pii": {"contains_pii": False, "redacted": True},
        }
    )

    llm_provider = (event.llm_provider or settings.llm_provider or "gemini").strip().lower()
    try:
        st = ShortTermMemory(events_path=events_path)
        st.append(role="user", text=event.text)
        lt = _get_long_term_store(settings=settings, appcfg=appcfg)
        llm, vlm = _make_llm_and_vlm(settings=settings, lt=lt, llm_provider=llm_provider)

        orchestrator = OrchestratorMVP(
            llm=llm,
            st=st,
            lt=lt,
            vlm=vlm,
            ng_words=settings.ng_words_list,
            rag_enabled=settings.rag_enabled,
            short_term_max_events=settings.short_term_max_events,
        )
        llm_start = time.perf_counter()
        candidate = orchestrator.run(event=event, include_vlm=event.include_vlm, screenshot_path=screenshot_path)
        llm_end = time.perf_counter()
        _log_phase_timing(
            writer,
            run_id=run_id,
            source="llm",
            phase="llm_full",
            start=llm_start,
            end=llm_end,
            payload={"provider": llm_provider},
        )
        try:
            if llm_provider == "gemini":
                _log_gemini_status(writer, candidate=candidate, model=settings.gemini_model)
        except Exception:
            pass
    except Exception as e:
        tb = traceback.format_exc()
        writer.append(
            {
                "ts": utc_iso(),
                "run_id": _now_id(),
                "source": "server",
                "type": "error",
                "message": str(e),
                "payload": {"traceback": tb},
                "pii": {"contains_pii": False, "redacted": True},
            }
        )
        return JSONResponse(status_code=500, content={"ok": False, "error": str(e)})
    finally:
        pass

    pending_id = f"p_{_now_id()}"
    item = PendingItem(
        pending_id=pending_id,
        created_at=utc_iso(),
        event=event,
        candidate=candidate,
        status="pending",
    )
    _append_pending(data_dir, item)

    writer.append(
        {
            "ts": utc_iso(),
            "run_id": pending_id,
            "source": "llm",
            "type": "decision",
            "message": candidate.overlay_text,
            "payload": {"candidate": candidate.model_dump(mode="json")},
            "pii": {"contains_pii": False, "redacted": True},
        }
    )

    # Log assistant candidate (pending) to chat log as well.
    try:
        _append_chat_log(
            data_dir=data_dir,
            run_id=pending_id,
            role="assistant",
            text=(candidate.speech_text or candidate.overlay_text or "").strip(),
            source="llm",
            meta={"status": "pending", "provider": llm_provider},
        )
    except Exception:
        pass

    return {"ok": True, "pending_id": pending_id, "candidate": candidate.model_dump(mode="json")}


def _should_store_short_term(notes: Optional[str]) -> bool:
    if not notes:
        return True
    return not str(notes).strip().lower().startswith("web:ack")


def _apply_output(
    *,
    run_id: str,
    final: AssistantOutput,
    notes: Optional[str],
    tts_provider: Optional[str] = None,
    request_id: Optional[str] = None,
) -> Dict[str, Any]:
    settings = load_settings()
    appcfg = _load_app_yaml(Path("config/main/app.yaml"))

    req_id = (request_id or run_id).strip() or run_id

    data_dir = settings.data_dir
    events_path = data_dir / "events.jsonl"
    writer = JsonlWriter(events_path)

    # OBS overlay
    overlay_path = Path(appcfg.get("paths", {}).get("obs_overlay_path", settings.obs_overlay_path))
    obs_start = time.perf_counter()
    obs_path = OBSOverlayWriter(overlay_path=overlay_path).write(text=final.overlay_text)
    obs_end = time.perf_counter()
    _log_phase_timing(
        writer,
        run_id=req_id,
        source="server",
        phase="obs_write",
        start=obs_start,
        end=obs_end,
    )

    # TTS
    audio_dir = Path(appcfg.get("tts", {}).get("audio_dir", data_dir / "audio"))
    audio_dir.mkdir(parents=True, exist_ok=True)
    audio_path = audio_dir / f"{run_id}.wav"
    # NOTE: legacy single-file TTS path (kept for non-web flows).
    provider = (tts_provider or settings.tts_provider or "stub").strip().lower()
    tts = TTSService(provider=provider, voice=settings.tts_voice)
    tts_start = time.perf_counter()
    audio_path, tts_used, tts_error = tts.synthesize_with_meta(text=final.speech_text, out_path=audio_path)
    tts_end = time.perf_counter()
    _log_phase_timing(
        writer,
        run_id=req_id,
        source="tts",
        phase="tts_synthesize",
        start=tts_start,
        end=tts_end,
        payload={"provider": tts_used or provider},
    )

    # Stable filename for stage
    tts_latest = audio_dir / "tts_latest.wav"
    try:
        if audio_path.exists():
            tts_latest.write_bytes(audio_path.read_bytes())
    except Exception:
        pass

    # Live2D (optional)
    live2d_result: Dict[str, Any] = {"ok": True, "triggered": []}
    try:
        hotkeys_path = Path(appcfg.get("live2d", {}).get("hotkeys_map_path", "config/main/live2d_hotkeys.yaml"))
        vts = VTubeStudioWS(
            ws_url=settings.vtube_ws_url,
            auth_token=settings.vtube_auth_token,
            plugin_name=settings.vtube_plugin_name,
            plugin_developer=settings.vtube_plugin_developer,
        )

        async def _run() -> Dict[str, Any]:
            return await _trigger_live2d_hotkeys(
                tags=list(final.motion_tags or []),
                hotkeys_path=hotkeys_path,
                vts=vts,
            )

        live2d_result = asyncio.run(_run())
    except Exception as e:
        live2d_result = {"ok": False, "error": str(e)}

    state = {
        "updated_at": utc_iso(),
        "last_run_id": run_id,
        "request_id": req_id,
        "overlay_path": str(obs_path.as_posix()),
        "overlay_text": final.overlay_text,
        "audio_path": str(audio_path.as_posix()),
        "tts_path": "/audio/tts_latest.wav",
        "tts_version": int(time.time() * 1000),
        "tts": {"provider": tts_used, "error": tts_error},
        "speech_text": final.speech_text,
        "motion_tags": final.motion_tags,
        "live2d": live2d_result,
    }
    state = _bump_live2d_seq(state, tags=list(final.motion_tags or []), last_tag=None)
    state_start = time.perf_counter()
    write_json(_state_path(data_dir), state)
    state_end = time.perf_counter()
    _log_phase_timing(
        writer,
        run_id=req_id,
        source="server",
        phase="state_write",
        start=state_start,
        end=state_end,
    )

    if _should_store_short_term(notes):
        ShortTermMemory(events_path=events_path).append(role="assistant", text=final.speech_text)

    writer.append(
        {
            "ts": utc_iso(),
            "run_id": req_id,
            "source": "web",
            "type": "decision",
            "message": "applied",
            "payload": {"final": final.model_dump(mode="json"), "notes": notes},
            "pii": {"contains_pii": False, "redacted": True},
        }
    )

    return {"ok": True, "state": state, "final": final.model_dump(mode="json")}


@app.post("/web/submit")
def web_submit(req: WebSubmitIn) -> Dict[str, Any]:
    """Run LLM (and optional VLM from browser camera) and apply outputs immediately.

    This endpoint exists to match the UI requirement: do not show candidates/pending.
    """
    # Providers are intentionally locked for this flow.
    # - LLM: Gemini
    # - TTS: Google Cloud TTS
    event = EventIn(
        source="web",
        text=req.text,
        include_vlm=bool(req.include_vlm),
        vlm_image_base64=req.vlm_image_base64,
        vlm_summary=req.vlm_summary,
        llm_provider="gemini",
        tts_provider="google",
    )

    # Reuse the LLM/VLM pipeline by calling the internal handler but bypass pending.
    # We do not want to write pending.json for the web flow.
    settings = load_settings()
    appcfg = _load_app_yaml(Path("config/main/app.yaml"))

    data_dir = settings.data_dir
    events_path = data_dir / "events.jsonl"
    writer = JsonlWriter(events_path)

    screenshot_path = Path(appcfg.get("vlm", {}).get("screenshot_path", settings.vlm_screenshot_path))
    event.include_vlm = bool(event.include_vlm and settings.vlm_enabled)
    if event.include_vlm and not (event.vlm_summary or "").strip():
        cached = _get_cached_vlm_summary(events_path)
        if cached:
            event.vlm_summary = cached

    request_id = _now_id()
    writer.append(
        {
            "ts": utc_iso(),
            "run_id": request_id,
            "source": event.source,
            "type": "input",
            "message": event.text,
            "payload": {"include_vlm": event.include_vlm},
            "pii": {"contains_pii": False, "redacted": True},
        }
    )

    recv_start = time.perf_counter()

    try:
        st = ShortTermMemory(events_path=events_path)
        st.append(role="user", text=event.text)
        lt = _get_long_term_store(settings=settings, appcfg=appcfg)
        # Locked provider
        llm_provider = "gemini"

        # Use the same LLM pipeline as the main orchestrator so prompts/context apply.
        llm, _vlm = _make_llm_and_vlm(settings=settings, lt=lt, llm_provider=llm_provider)

        # Build RAG context from DB-managed rag_items and short-term turns (separate).
        rag_context = "no_rag"
        try:
            if settings.rag_enabled:
                rag_store = RagItemsStore(db_path=_rag_items_db_path(settings))
                short_text = rag_store.get_concat_text(rag_type="short", limit=50)
                long_text = rag_store.get_concat_text(rag_type="long", limit=200)
                chunks: list[str] = []
                if short_text:
                    chunks.append("[shortRAG]\n" + short_text)
                if long_text:
                    chunks.append("[longRAG]\n" + long_text)
                rag_context = "\n\n".join(chunks).strip() or "no_rag"
        except Exception:
            rag_context = "no_rag"

        turns_context = ""
        try:
            if settings.short_term_enabled and settings.short_term_turns_to_prompt > 0:
                turns_store = TurnsStore(db_path=_turns_db_path(settings))
                turns_context = turns_store.get_prompt_context(turns_to_prompt=settings.short_term_turns_to_prompt)
        except Exception:
            turns_context = ""

        if turns_context:
            rag_context = ("[short_term_turns]\n" + turns_context + "\n\n" + rag_context).strip()

        def _run_stream() -> None:
            writer2 = JsonlWriter(events_path)
            data_dir2 = settings.data_dir
            st_path = _state_path(data_dir2)

            # Full chat log (user)
            _append_chat_log(data_dir=data_dir2, run_id=request_id, role="user", text=event.text, source="web")

            # Initialize state quickly so UI can start polling
            state = {
                "updated_at": utc_iso(),
                "request_id": request_id,
                "last_run_id": f"w_{request_id}",
                "overlay_text": "",
                "speech_text": "",
                "tts_queue": [],
                "tts_queue_version": int(time.time() * 1000),
                "tts_path": "",
                "tts_version": None,
                "vlm_summary": (event.vlm_summary or "").strip(),
            }
            write_json(st_path, state)

            llm_start = time.perf_counter()
            full_text = ""
            try:
                out = llm.generate_full(
                    user_text=event.text,
                    rag_context=rag_context,
                    vlm_summary=(event.vlm_summary or ""),
                )

                full_text = (out.speech_text or "").strip()
                overlay_text = (out.overlay_text or full_text[-120:]).strip()

                st_now = read_json(st_path) or {}
                st_now["speech_text"] = full_text
                st_now["overlay_text"] = overlay_text
                # Reset per-run queue so the UI represents the current utterance's segments.
                st_now["tts_queue"] = []
                st_now["tts_queue_version"] = int(time.time() * 1000)
                st_now["tts_path"] = ""
                st_now["tts_version"] = None
                st_now["updated_at"] = utc_iso()
                write_json(st_path, st_now)

                # Full chat log (assistant)
                _append_chat_log(
                    data_dir=data_dir2,
                    run_id=request_id,
                    role="assistant",
                    text=full_text,
                    source="llm",
                    meta={"provider": llm_provider},
                )

                # Sentence-level TTS (web flow)
                audio_root = settings.data_dir / "audio" / "segments" / request_id
                audio_root.mkdir(parents=True, exist_ok=True)
                tts_provider_used = "google"
                tts = TTSService(provider=tts_provider_used, voice=settings.tts_voice)
                seg_idx = 0
                rem2 = full_text
                while rem2.strip():
                    sents, rem2 = _split_sentences(rem2)
                    if not sents:
                        sents = [rem2.strip()]
                        rem2 = ""
                    for s in sents:
                        # NG word filter
                        if any(w and w in s for w in settings.ng_words_list):
                            st_now = read_json(st_path) or {}
                            st_now["speech_text"] = "content blocked"
                            st_now["overlay_text"] = "content blocked"
                            st_now["updated_at"] = utc_iso()
                            write_json(st_path, st_now)
                            return

                        seg_idx += 1
                        out_wav = audio_root / f"{seg_idx:03d}.wav"
                        t0 = time.perf_counter()
                        err = None
                        try:
                            _p, provider_used, err = tts.synthesize_with_meta(text=s, out_path=out_wav)
                        except Exception as e:
                            provider_used = tts_provider_used
                            err = f"{type(e).__name__}: {e}"[:200]
                        t1 = time.perf_counter()
                        _log_phase_timing(
                            writer2,
                            run_id=request_id,
                            source="tts",
                            phase="tts_segment",
                            start=t0,
                            end=t1,
                            payload={"idx": seg_idx, "provider": provider_used, "error": err},
                        )
                        if err:
                            continue
                        qv = int(time.time() * 1000)
                        st_now = read_json(st_path) or {}
                        q = st_now.get("tts_queue") if isinstance(st_now.get("tts_queue"), list) else []
                        q.append({"idx": seg_idx, "path": f"/audio/segments/{request_id}/{seg_idx:03d}.wav", "text": s})
                        st_now["tts_queue"] = q
                        st_now["tts_queue_version"] = qv
                        st_now["tts_path"] = f"/audio/segments/{request_id}/{seg_idx:03d}.wav"
                        st_now["tts_version"] = qv
                        st_now["tts"] = {"provider": provider_used, "error": err}
                        st_now["updated_at"] = utc_iso()
                        write_json(st_path, st_now)

                # If generation yielded nothing, make it explicit so the UI has something to render.
                if not (full_text or "").strip():
                    st_now = read_json(st_path) or {}
                    st_now["speech_text"] = "（返答生成に失敗しました）"
                    st_now["overlay_text"] = "（返答生成に失敗）"
                    st_now["tts"] = {"provider": "google", "error": "empty_llm_output"}
                    st_now["updated_at"] = utc_iso()
                    write_json(st_path, st_now)

            except Exception as e:
                tb = traceback.format_exc()
                try:
                    writer2.append(
                        {
                            "ts": utc_iso(),
                            "run_id": request_id,
                            "source": "server",
                            "type": "error",
                            "message": f"web_submit_worker_failed: {type(e).__name__}: {e}"[:220],
                            "payload": {"traceback": tb},
                            "pii": {"contains_pii": False, "redacted": True},
                        }
                    )
                except Exception:
                    pass

                try:
                    st_now = read_json(st_path) or {}
                    st_now["speech_text"] = "（内部エラーが発生しました）"
                    st_now["overlay_text"] = "（内部エラー）"
                    st_now["tts"] = {"provider": "google", "error": f"{type(e).__name__}: {e}"[:200]}
                    st_now["updated_at"] = utc_iso()
                    write_json(st_path, st_now)
                except Exception:
                    pass

            finally:
                llm_end = time.perf_counter()
                _log_phase_timing(
                    writer2,
                    run_id=request_id,
                    source="llm",
                    phase="llm_total",
                    start=llm_start,
                    end=llm_end,
                    payload={"provider": llm_provider},
                )

                # Always store conversation log for Console's "Short-Term Turns" table.
                try:
                    turns_store = TurnsStore(db_path=_turns_db_path(settings))
                    turns_store.add_turn(
                        user_text=event.text,
                        assistant_text=(full_text or "").strip() or "(empty)",
                        created_at=utc_iso(),
                        max_keep=settings.short_term_max_events,
                    )
                except Exception:
                    pass

        threading.Thread(target=_run_stream, daemon=True).start()

        recv_end = time.perf_counter()
        _log_phase_timing(
            writer,
            run_id=request_id,
            source="server",
            phase="web_submit_received_to_enqueued",
            start=recv_start,
            end=recv_end,
            payload={"llm_provider": llm_provider, "tts_provider": "google"},
        )
    except Exception as e:
        tb = traceback.format_exc()
        writer.append(
            {
                "ts": utc_iso(),
                "run_id": _now_id(),
                "source": "server",
                "type": "error",
                "message": str(e),
                "payload": {"traceback": tb},
                "pii": {"contains_pii": False, "redacted": True},
            }
        )
        return JSONResponse(status_code=500, content={"ok": False, "error": str(e)})
    finally:
        pass

    return {"ok": True, "enqueued": True, "request_id": request_id}


@app.post("/events")
def post_event(event: EventIn) -> Dict[str, Any]:
    return _handle_event(event)


@app.post("/stt/text")
def stt_text(req: STTIn) -> Dict[str, Any]:
    event = EventIn(source="stt", text=req.text, include_vlm=False)
    return _handle_event(event)


@app.post("/stt/audio")
async def stt_audio(
    file: UploadFile = File(...),
    lang: str = Form(default="ja-JP"),
    vad_enabled: str = Form(default="1"),
    vad_threshold: float = Form(default=0.01),
    vad_aggressiveness: int = Form(default=1),
    vad_padding_ms: int = Form(default=700),
    vad_min_speech_ms: int = Form(default=350),
    vad_frame_ms: int = Form(default=30),
    stt_provider: str = Form(default=""),
    stt_enabled: str = Form(default="1"),
    vlm_force: str = Form(default="0"),
) -> Dict[str, Any]:
    """Transcribe microphone audio into text using local Whisper or Google.

    Expected input: WAV (PCM) from the browser.
    """
    settings = load_settings()
    appcfg = _load_app_yaml(Path("config/main/app.yaml"))
    data_dir = settings.data_dir
    events_path = data_dir / "events.jsonl"
    writer = JsonlWriter(events_path)
    run_id = _now_id()

    stt_on = _parse_bool_flag(stt_enabled, default=True)
    if not settings.stt_enabled or not stt_on:
        return STTAudioOut(ok=False, text="", error="stt_disabled").model_dump(mode="json")

    audio_bytes = await file.read()
    if not audio_bytes:
        return STTAudioOut(ok=False, text="", error="empty_audio").model_dump(mode="json")

    # Parse WAV -> float32 mono
    try:
        import io
        import wave
        import numpy as np

        with wave.open(io.BytesIO(audio_bytes), "rb") as wf:
            n_channels = wf.getnchannels()
            sampwidth = wf.getsampwidth()
            framerate = wf.getframerate()
            n_frames = wf.getnframes()
            pcm = wf.readframes(n_frames)

        if sampwidth != 2:
            return STTAudioOut(ok=False, text="", error=f"unsupported_sampwidth:{sampwidth}").model_dump(mode="json")

        audio_i16 = np.frombuffer(pcm, dtype=np.int16)
        if n_channels > 1:
            audio_i16 = audio_i16.reshape(-1, n_channels).mean(axis=1).astype(np.int16)
        audio = (audio_i16.astype(np.float32) / 32768.0).clip(-1.0, 1.0)
        sr = int(framerate)
    except Exception as e:
        return STTAudioOut(ok=False, text="", error=f"invalid_wav:{type(e).__name__}"[:200]).model_dump(mode="json")

    # Optional VAD (skip Whisper on silence)
    vad_on = _parse_bool_flag(vad_enabled, default=True)
    try:
        vad_thr = float(vad_threshold)
    except Exception:
        vad_thr = 0.01
    vad_thr = max(0.0, min(1.0, vad_thr))
    if vad_on:
        # Fast gate (kept for compatibility): if it's extremely quiet, skip early.
        try:
            max_amp = float(np.max(np.abs(audio))) if audio.size else 0.0
        except Exception:
            max_amp = 0.0
        if max_amp < vad_thr:
            return STTAudioOut(ok=False, text="", error="no_voice").model_dump(mode="json")

        # WebRTC VAD pre-filter: feed ONLY voiced audio to STT.
        # If webrtcvad isn't installed, we fall back to the max_amp gate above.
        try:
            # Clamp inputs to safe ranges.
            vad_aggr = int(max(0, min(3, int(vad_aggressiveness))))
            vad_pad = int(max(0, min(2000, int(vad_padding_ms))))
            vad_min_ms = int(max(0, min(3000, int(vad_min_speech_ms))))
            vad_frame = int(vad_frame_ms)
            if vad_frame not in (10, 20, 30):
                vad_frame = 30

            vad_res = webrtc_vad_filter(
                audio_f32=audio,
                sample_rate=sr,
                aggressiveness=vad_aggr,
                frame_ms=vad_frame,
                padding_ms=vad_pad,
                min_speech_ms=vad_min_ms,
            )
        except Exception as e:
            return STTAudioOut(ok=False, text="", error=f"vad_error:{type(e).__name__}").model_dump(mode="json")

        if not vad_res.ok:
            if vad_res.reason == "missing_dep:webrtcvad":
                # Dependency missing: keep going with original audio.
                pass
            else:
                # no_voice / empty_audio
                return STTAudioOut(ok=False, text="", error=vad_res.reason).model_dump(mode="json")
        else:
            audio = vad_res.audio_f32
            sr = int(vad_res.sample_rate)
            # Re-encode filtered audio for providers expecting WAV bytes.
            try:
                import io
                import wave

                pcm16 = (audio * 32767.0).clip(-32768.0, 32767.0).astype(np.int16).tobytes(order="C")
                buf = io.BytesIO()
                with wave.open(buf, "wb") as wf:
                    wf.setnchannels(1)
                    wf.setsampwidth(2)
                    wf.setframerate(sr)
                    wf.writeframes(pcm16)
                audio_bytes = buf.getvalue()
            except Exception:
                # If re-encoding fails, keep original bytes; whisper path still uses float PCM.
                pass

    import os

    provider = (stt_provider or os.getenv("AITUBER_STT_PROVIDER") or settings.stt_provider or "local").strip().lower()
    # Backward compat: old configs may still say 'openai'. We do not support OpenAI STT anymore;
    # fall back to local whisper so web UI keeps working.
    if provider == "openai":
        provider = "local"
    provider_label = "google" if provider == "google" else "whisper"
    language = (lang or "ja-JP").split("-")[0].lower() or "ja"

    force_vlm = _parse_bool_flag(vlm_force, default=False)
    vlm_task = None
    if settings.vlm_enabled and force_vlm:
        try:
            vlm_task = asyncio.create_task(
                asyncio.to_thread(
                    _run_vlm_summary_sync,
                    settings=settings,
                    appcfg=appcfg,
                    reason="stt",
                    force=force_vlm,
                )
            )

            def _swallow(task: asyncio.Task) -> None:
                try:
                    task.exception()
                except Exception:
                    pass

            vlm_task.add_done_callback(_swallow)
        except Exception:
            vlm_task = None

    text = ""
    chunk_count = 0
    chunk_sec = 0.0
    stt_start = time.perf_counter()
    if provider == "google":
        chunk_count = 1
        try:
            text = await asyncio.to_thread(
                transcribe_wav_via_google,
                audio_bytes=audio_bytes,
                cfg=GoogleSTTConfig(language_code=(lang or "ja-JP")),
            )
        except ModuleNotFoundError:
            return STTAudioOut(ok=False, text="", error="missing_dep:google-cloud-speech").model_dump(mode="json")
        except ValueError as e:
            return STTAudioOut(ok=False, text="", error=str(e)[:200]).model_dump(mode="json")
        except Exception as e:
            return STTAudioOut(ok=False, text="", error=f"{type(e).__name__}: {e}"[:200]).model_dump(mode="json")

    elif provider == "openai":
        return STTAudioOut(ok=False, text="", error="stt_provider_unsupported:openai").model_dump(mode="json")
    else:
        model_name = _normalize_whisper_model_name(
            os.getenv("AITUBER_WHISPER_MODEL") or settings.whisper_model
        )
        compute_type = (os.getenv("AITUBER_WHISPER_COMPUTE_TYPE") or settings.whisper_compute_type or "int8").strip() or "int8"
        device = (os.getenv("AITUBER_WHISPER_DEVICE") or settings.whisper_device or "cpu").strip() or "cpu"
        cfg = WhisperConfig(model=model_name, device=device, compute_type=compute_type, language=language)
        chunk_sec = _clamp_chunk_seconds(os.getenv("AITUBER_STT_CHUNK_SECONDS") or settings.stt_chunk_seconds)

        chunks = []
        try:
            chunks = list(_iter_audio_chunks(audio, sr, chunk_sec))
        except Exception:
            chunks = [(0, audio)]

        texts: list[str] = []
        for _idx, chunk in chunks:
            if not chunk.size:
                continue
            if vad_on:
                try:
                    max_amp = float(np.max(np.abs(chunk))) if chunk.size else 0.0
                except Exception:
                    max_amp = 0.0
                if max_amp < vad_thr:
                    continue
            try:
                chunk_count += 1
                part = await asyncio.to_thread(transcribe_pcm, audio=chunk, sample_rate=sr, cfg=cfg)
            except ModuleNotFoundError as e:
                return STTAudioOut(ok=False, text="", error=f"missing_dep:{e.name}").model_dump(mode="json")
            except Exception as e:
                return STTAudioOut(ok=False, text="", error=f"{type(e).__name__}: {e}"[:200]).model_dump(mode="json")
            if part:
                texts.append(str(part).strip())

        text = " ".join([t for t in texts if t]).strip()

    stt_end = time.perf_counter()
    _log_phase_timing(
        writer,
        run_id=run_id,
        source="stt",
        phase="stt_transcribe",
        start=stt_start,
        end=stt_end,
        payload={
            "provider": provider_label,
            "sr": sr,
            "audio_ms": int((audio.size / float(sr)) * 1000.0) if sr else 0,
            "chunk_sec": round(float(chunk_sec), 3) if chunk_sec else None,
            "chunk_count": chunk_count,
        },
    )

    text = _strip_transcript_phrases(text)
    if not text:
        return STTAudioOut(ok=False, text="", error="empty_transcript").model_dump(mode="json")

    reason = _should_filter_transcript(text)
    if reason:
        try:
            writer.append(
                {
                    "ts": utc_iso(),
                    "run_id": run_id,
                    "source": "stt",
                    "type": "filter",
                    "message": f"stt_filtered:{reason}",
                    "payload": {"reason": reason},
                    "pii": {"contains_pii": False, "redacted": True},
                }
            )
        except Exception:
            pass
        return STTAudioOut(ok=False, text="", error=f"filtered:{reason}").model_dump(mode="json")

    # Log STT input (text only)
    try:
        writer.append(
            {
                "ts": utc_iso(),
                "run_id": run_id,
                "source": "stt",
                "type": "input",
                "message": text,
                "payload": {"provider": provider_label, "sr": sr},
                "pii": {"contains_pii": False, "redacted": True},
            }
        )
    except Exception:
        pass

    vlm_summary = ""
    if vlm_task is not None and vlm_task.done():
        try:
            vlm_summary = str(vlm_task.result() or "").strip()
        except Exception:
            vlm_summary = ""

    timing_ms = {"stt_total": int((stt_end - stt_start) * 1000.0)}
    return STTAudioOut(ok=True, text=text, error=None, vlm_summary=vlm_summary or None, timing_ms=timing_ms).model_dump(
        mode="json"
    )


@app.post("/stt/warmup")
def stt_warmup() -> Dict[str, Any]:
    """Warm up STT provider.

    - google: instantiate Speech client (credential check)
    - local/whisper: preload faster-whisper model
    """
    import os

    settings = load_settings()
    provider = (os.getenv("AITUBER_STT_PROVIDER") or settings.stt_provider or "local").strip().lower()
    if provider == "google":
        try:
            from google.cloud import speech

            _ = speech.SpeechClient()
            return {"ok": True, "provider": "google"}
        except Exception as e:
            return {"ok": False, "provider": "google", "error": f"{type(e).__name__}: {e}"[:200]}
    if provider == "openai":
        return {"ok": False, "provider": "openai", "error": "unsupported"}

    if provider not in ("local", "whisper", "faster-whisper"):
        return {"ok": False, "provider": provider, "error": "unknown_provider"}

    model_name = _normalize_whisper_model_name(
        os.getenv("AITUBER_WHISPER_MODEL") or settings.whisper_model
    )
    compute_type = (os.getenv("AITUBER_WHISPER_COMPUTE_TYPE") or settings.whisper_compute_type or "int8").strip() or "int8"
    device = (os.getenv("AITUBER_WHISPER_DEVICE") or settings.whisper_device or "cpu").strip() or "cpu"
    cfg = WhisperConfig(model=model_name, device=device, compute_type=compute_type, language="ja")
    try:
        get_model(cfg)
        return {"ok": True, "model": model_name, "compute_type": compute_type}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"[:200], "model": model_name}


@app.get("/manager/pending")
def manager_pending() -> Dict[str, Any]:
    settings = load_settings()
    p = _load_pending(settings.data_dir)
    return {"ok": True, "items": p.get("items", [])}


@app.post("/manager/reject")
def manager_reject(req: RejectIn) -> Dict[str, Any]:
    settings = load_settings()
    data_dir = settings.data_dir

    updated = _update_pending(data_dir, req.pending_id, {"status": "rejected", "notes": req.notes})
    if updated is None:
        return {"ok": False, "error": "pending_not_found"}

    JsonlWriter(data_dir / "events.jsonl").append(
        {
            "ts": utc_iso(),
            "run_id": req.pending_id,
            "source": "manager",
            "type": "decision",
            "message": "rejected",
            "payload": {"notes": req.notes},
            "pii": {"contains_pii": False, "redacted": True},
        }
    )

    return {"ok": True}


@app.post("/manager/approve")
def manager_approve(req: ApproveIn) -> Dict[str, Any]:
    settings = load_settings()
    appcfg = _load_app_yaml(Path("config/main/app.yaml"))

    data_dir = settings.data_dir
    events_path = data_dir / "events.jsonl"
    writer = JsonlWriter(events_path)

    # Load item
    p = _load_pending(data_dir)
    items = []
    target: Optional[PendingItem] = None
    for raw in p.get("items", []):
        try:
            it = PendingItem.model_validate(raw)
        except Exception:
            continue
        items.append(it)
        if it.pending_id == req.pending_id:
            target = it

    if target is None:
        return {"ok": False, "error": "pending_not_found"}

    final: AssistantOutput = req.edits or target.candidate

    # Outputs
    # OBS
    overlay_path = Path(appcfg.get("paths", {}).get("obs_overlay_path", settings.obs_overlay_path))
    obs_path = OBSOverlayWriter(overlay_path=overlay_path).write(text=final.overlay_text)

    # TTS
    audio_dir = Path(appcfg.get("tts", {}).get("audio_dir", data_dir / "audio"))
    audio_path = audio_dir / f"{req.pending_id}.wav"
    provider = (target.event.tts_provider or settings.tts_provider or "stub").strip().lower()
    tts = TTSService(provider=provider, voice=settings.tts_voice)
    tts_start = time.perf_counter()
    audio_path, tts_used, tts_error = tts.synthesize_with_meta(text=final.speech_text, out_path=audio_path)
    tts_end = time.perf_counter()
    _log_phase_timing(
        writer,
        run_id=req.pending_id,
        source="tts",
        phase="tts_synthesize",
        start=tts_start,
        end=tts_end,
        payload={"provider": tts_used or provider},
    )

    # Stage (web) expects a stable filename.
    tts_latest = audio_dir / "tts_latest.wav"
    try:
        if audio_path.exists():
            tts_latest.write_bytes(audio_path.read_bytes())
    except Exception:
        pass

    # Live2D
    live2d_result: Dict[str, Any] = {"ok": True, "triggered": []}
    try:
        hotkeys_path = Path(appcfg.get("live2d", {}).get("hotkeys_map_path", "config/main/live2d_hotkeys.yaml"))
        vts = VTubeStudioWS(
            ws_url=settings.vtube_ws_url,
            auth_token=settings.vtube_auth_token,
            plugin_name=settings.vtube_plugin_name,
            plugin_developer=settings.vtube_plugin_developer,
        )

        async def _run() -> Dict[str, Any]:
            return await _trigger_live2d_hotkeys(
                tags=list(final.motion_tags or []),
                hotkeys_path=hotkeys_path,
                vts=vts,
            )

        live2d_result = asyncio.run(_run())
    except Exception as e:
        live2d_result = {"ok": False, "error": str(e)}

    # Persist state
    state = {
        "updated_at": utc_iso(),
        "last_pending_id": req.pending_id,
        "overlay_path": str(obs_path.as_posix()),
        "overlay_text": final.overlay_text,
        "audio_path": str(audio_path.as_posix()),
        "tts_path": "/audio/tts_latest.wav",
        "tts_version": int(time.time() * 1000),
        "tts": {"provider": tts_used, "error": tts_error},
        "speech_text": final.speech_text,
        "motion_tags": final.motion_tags,
        "live2d": live2d_result,
    }
    state = _bump_live2d_seq(state, tags=list(final.motion_tags or []), last_tag=None)
    write_json(_state_path(data_dir), state)

    ShortTermMemory(events_path=events_path).append(role="assistant", text=final.speech_text)

    _update_pending(data_dir, req.pending_id, {"status": "approved", "final": final, "notes": req.notes})

    writer.append(
        {
            "ts": utc_iso(),
            "run_id": req.pending_id,
            "source": "manager",
            "type": "decision",
            "message": "approved",
            "payload": {"final": final.model_dump(mode="json"), "notes": req.notes},
            "pii": {"contains_pii": False, "redacted": True},
        }
    )

    return {"ok": True, "state": state}
