from __future__ import annotations

import argparse
import sys
from pathlib import Path

import uvicorn


def main(argv: list[str] | None = None) -> int:
    # When launched as a script (python scripts/run_uvicorn.py), sys.path[0] becomes
    # the scripts/ folder. Add repo root so `apps.*` imports resolve.
    repo_root = Path(__file__).resolve().parents[1]
    repo_root_str = str(repo_root)
    if repo_root_str not in sys.path:
        sys.path.insert(0, repo_root_str)

    parser = argparse.ArgumentParser(description="Run AITuber FastAPI server via uvicorn")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--reload", action="store_true")
    parser.add_argument("--access-log", action="store_true")
    parser.add_argument("--log-level", default="info")

    args = parser.parse_args(argv)

    try:
        uvicorn.run(
            "apps.main.server.main:app",
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
