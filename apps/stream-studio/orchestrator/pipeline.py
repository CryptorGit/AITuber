from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

from core.config import AppConfig
from core.logger import setup_logger
from core.types import DirectorOutput, ReplyTo
from live2d.motion_router import default_router
from live2d.vtube_studio import VTubeStudioClient
from llm.director import Director
from orchestrator.safety import SafetyFilter
from tts.engine import TTSEngine

JsonDict = Dict[str, Any]


def _run_id() -> str:
    return time.strftime("%Y%m%d_%H%M%S")


@dataclass
class PipelineResult:
    director: DirectorOutput
    audio_path: Path
    live2d_actions: List[str]
    run_dir: Path


def run_pipeline_once(
    *,
    user_text: str,
    config: AppConfig,
    reply_to: Optional[ReplyTo] = None,
) -> PipelineResult:
    run_id = _run_id()
    run_dir = config.logs_dir / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    logger = setup_logger(logs_dir=config.logs_dir, run_id=run_id)
    logger.info("run_id=%s", run_id)

    director = Director(templates_dir=Path("apps/llm/prompt_templates"))
    out = director.run(user_text=user_text, reply_to=reply_to)

    safety = SafetyFilter(ng_words=config.ng_words)
    out2, blocked = safety.apply(out)
    if blocked:
        logger.warning("director output blocked by safety filter")

    tts = TTSEngine(voice=config.tts_voice)
    audio_path = tts.synthesize(text=out2.text, out_wav_path=run_dir / "tts.wav")

    router = default_router()
    actions = router.route(out2.motion_tags)

    vtube = VTubeStudioClient(ws_url=config.vtube_ws_url)
    vtube.send_actions(actions=actions, logger=logger)

    # Persist artifacts
    (run_dir / "director.json").write_text(
        json.dumps(out2.to_json_dict(), ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (run_dir / "result.json").write_text(
        json.dumps(
            {
                "user_text": user_text,
                "director": out2.to_json_dict(),
                "audio_path": str(audio_path.as_posix()),
                "live2d_actions": actions,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    logger.info("director.emotion=%s", out2.emotion)
    logger.info("audio_path=%s", audio_path)
    logger.info("live2d_actions=%s", actions)

    return PipelineResult(director=out2, audio_path=audio_path, live2d_actions=actions, run_dir=run_dir)
