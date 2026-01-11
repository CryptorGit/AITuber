from __future__ import annotations

import json
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.request import Request, urlopen


def _wait_port(host: str, port: int, timeout_s: float) -> None:
    deadline = time.time() + timeout_s
    last_err: Exception | None = None
    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), timeout=0.2):
                return
        except Exception as e:  # noqa: BLE001
            last_err = e
            time.sleep(0.05)
    raise RuntimeError(f"Timed out waiting for {host}:{port} ({last_err})")


def _post_json(url: str, payload: object, timeout_s: float = 2.0) -> object:
    data = json.dumps(payload).encode("utf-8")
    req = Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    with urlopen(req, timeout=timeout_s) as resp:
        body = resp.read().decode("utf-8")
        return json.loads(body)


def main() -> int:
    agent_dir = Path(__file__).resolve().parent
    host = "127.0.0.1"
    port = 9877

    cmd = [
        sys.executable,
        "-m",
        "uvicorn",
        "agent_server:app",
        "--app-dir",
        str(agent_dir),
        "--host",
        host,
        "--port",
        str(port),
        "--log-level",
        "warning",
    ]

    proc = subprocess.Popen(cmd, cwd=str(agent_dir))
    try:
        _wait_port(host, port, timeout_s=5.0)

        choose_payload = {
            "request": {
                "active": [
                    {
                        "moves": [
                            {"id": "protect", "move": "Protect", "target": "self", "disabled": False},
                            {"id": "tackle", "move": "Tackle", "target": "normal", "disabled": False},
                        ]
                    },
                    {
                        "moves": [
                            {"id": "protect", "move": "Protect", "target": "self", "disabled": False},
                            {"id": "tackle", "move": "Tackle", "target": "normal", "disabled": False},
                        ]
                    },
                ],
                "side": {
                    "pokemon": [
                        {
                            "active": True,
                            "condition": "100/100",
                            "ident": "p1a: Pikachu",
                            "details": "Pikachu, L50, M",
                        },
                        {
                            "active": True,
                            "condition": "100/100",
                            "ident": "p1b: Charizard",
                            "details": "Charizard, L50, M",
                        },
                        {
                            "active": False,
                            "condition": "100/100",
                            "ident": "p1c: Gengar",
                            "details": "Gengar, L50, M",
                        },
                    ]
                },
                "canSwitch": True,
                "forceSwitch": False,
            },
            "format": "gen9vgc2026regf",
            "turn": 1,
            "policy": "heuristic",
            "seed": 123,
        }

        select4_payload = {
            "team6": ["A", "B", "C", "D", "E", "F"],
            "format": "gen9vgc2026regf",
            "turn": 0,
            "policy": "random",
            "seed": 42,
        }

        choose_resp = _post_json(f"http://{host}:{port}/choose", choose_payload)
        select4_resp = _post_json(f"http://{host}:{port}/select4", select4_payload)

        print(json.dumps({"choose": choose_resp, "select4": select4_resp}, indent=2))
        return 0
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=2.0)
        except Exception:  # noqa: BLE001
            proc.kill()


if __name__ == "__main__":
    raise SystemExit(main())
