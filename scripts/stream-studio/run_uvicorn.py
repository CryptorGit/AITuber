from __future__ import annotations

import argparse
import sys
from pathlib import Path

import uvicorn


def main(argv: list[str] | None = None) -> int:
    # When launched as a script, sys.path[0] becomes the script's folder.
    # Add the stream-studio app dir so top-level module imports resolve.
    repo_root = Path(__file__).resolve().parents[2]
    app_dir = repo_root / "apps" / "stream-studio"
    app_dir_str = str(app_dir)
    if app_dir_str not in sys.path:
        sys.path.insert(0, app_dir_str)

    parser = argparse.ArgumentParser(description="Run AITuber FastAPI server via uvicorn")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--reload", action="store_true")
    parser.add_argument("--access-log", action="store_true")
    parser.add_argument("--log-level", default="info")

    args = parser.parse_args(argv)

    try:
        uvicorn.run(
            "server.main:app",
            host=args.host,
            port=args.port,
            reload=bool(args.reload),
            access_log=bool(args.access_log),
            log_level=str(args.log_level),
        )
        return 0
    except KeyboardInterrupt:
        # Avoid noisy tracebacks on Ctrl+C (especially on Windows/Python 3.13).
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
