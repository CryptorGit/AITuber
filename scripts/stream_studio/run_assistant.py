from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from apps.stream_studio.core.config import load_config
from apps.stream_studio.core.types import ReplyTo
from apps.stream_studio.orchestrator.pipeline import run_pipeline_once


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description="AITuber Streaming Assistant (LLM→TTS→VTube Studio) - minimal CLI"
    )
    ap.add_argument("--env-file", type=Path, default=None, help="Optional .env file")
    ap.add_argument(
        "--reply-type",
        type=str,
        default="system",
        choices=["chat", "system", "manager"],
        help="reply_to.type",
    )
    ap.add_argument("--reply-id", type=str, default=None, help="reply_to.id")
    args = ap.parse_args(argv)

    cfg = load_config(env_file=args.env_file)

    try:
        user_text = input("input> ").rstrip("\n")
    except (EOFError, KeyboardInterrupt):
        return 0

    reply_to = ReplyTo(type=args.reply_type, id=args.reply_id)
    result = run_pipeline_once(user_text=user_text, config=cfg, reply_to=reply_to)

    print("director:", result.director.to_json_dict())
    print("audio_path:", str(result.audio_path))
    print("live2d_actions:", result.live2d_actions)
    print("run_dir:", str(result.run_dir))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
