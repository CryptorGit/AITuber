from __future__ import annotations

import argparse
import json
from typing import Any, Dict

import httpx


def _print(obj: Any) -> None:
    print(json.dumps(obj, ensure_ascii=False, indent=2))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="AITuber Manager Console (CLI)")
    ap.add_argument("--base-url", default="http://127.0.0.1:8000")

    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("pending")
    sub.add_parser("state")

    ap_approve = sub.add_parser("approve")
    ap_approve.add_argument("pending_id")
    ap_approve.add_argument("--notes", default="")
    ap_approve.add_argument(
        "--edits-json",
        default=None,
        help="Path to AssistantOutput JSON to approve with edits",
    )

    ap_reject = sub.add_parser("reject")
    ap_reject.add_argument("pending_id")
    ap_reject.add_argument("--notes", default="")

    args = ap.parse_args(argv)

    with httpx.Client(timeout=15.0) as client:
        if args.cmd == "pending":
            r = client.get(f"{args.base_url}/manager/pending")
            r.raise_for_status()
            _print(r.json())
            return 0

        if args.cmd == "state":
            r = client.get(f"{args.base_url}/state")
            r.raise_for_status()
            _print(r.json())
            return 0

        if args.cmd == "approve":
            payload: Dict[str, Any] = {"pending_id": args.pending_id, "notes": args.notes}
            if args.edits_json:
                edits = json.loads(open(args.edits_json, "r", encoding="utf-8").read())
                payload["edits"] = edits
            r = client.post(f"{args.base_url}/manager/approve", json=payload)
            r.raise_for_status()
            _print(r.json())
            return 0

        if args.cmd == "reject":
            payload = {"pending_id": args.pending_id, "notes": args.notes}
            r = client.post(f"{args.base_url}/manager/reject", json=payload)
            r.raise_for_status()
            _print(r.json())
            return 0

    return 2


if __name__ == "__main__":
    raise SystemExit(main())
