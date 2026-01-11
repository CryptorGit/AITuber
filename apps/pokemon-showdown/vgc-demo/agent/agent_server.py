from __future__ import annotations

import argparse
import hashlib
import json
import random
from typing import Any, Dict, List, Optional

from fastapi import FastAPI
from pydantic import BaseModel, Field

from policies import (
    heuristic_policy_choose,
    heuristic_policy_select4,
    random_policy_choose,
    random_policy_select4,
)

from learned_model import (
    LearnedModelStore,
    learned_policy_choose,
    resolve_policy_model,
)


MODEL_STORE = LearnedModelStore()

app = FastAPI(title="vgc-demo-agent")


def _stable_seed_from_obj(obj: Any) -> int:
    """Derive a deterministic seed from request-derived objects.

    This avoids sending simulator-internal RNG seeds to the agent while keeping
    behavior stable for the same observable inputs.
    """
    try:
        s = json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    except TypeError:
        s = repr(obj)
    h = hashlib.sha256(s.encode("utf-8")).digest()
    return int.from_bytes(h[:8], "big", signed=False)


class Select4Request(BaseModel):
    team6: Any = Field(..., description="Team info derived from request JSON (visible-only)")
    format: str
    turn: int = 0
    policy: str = "heuristic"
    seed: Optional[int] = None


class Select4Response(BaseModel):
    select4: List[int]


class ChooseRequest(BaseModel):
    request: Dict[str, Any]
    format: str
    turn: int
    policy: str = "heuristic"
    seed: Optional[int] = None


class ChooseResponse(BaseModel):
    choice: str


@app.post("/select4", response_model=Select4Response)
def select4(body: Select4Request) -> Select4Response:
    seed = body.seed
    if seed is None:
        seed = _stable_seed_from_obj({"team6": body.team6, "format": body.format, "turn": body.turn, "policy": body.policy})
    rng = random.Random(seed)

    # We intentionally do not inspect any hidden info.
    if body.policy == "random":
        # Assume team size is 6 unless input suggests otherwise.
        team_size = 6
        if isinstance(body.team6, list):
            team_size = len(body.team6)
        pick = random_policy_select4(team_size=team_size, battle_size=4, rng=rng)
        return Select4Response(select4=pick)

    # Keep select4 deterministic and simple for learned policies (team preview learning is optional).
    pick = heuristic_policy_select4(body.team6, rng=rng)
    return Select4Response(select4=pick)


@app.post("/choose", response_model=ChooseResponse)
def choose(body: ChooseRequest) -> ChooseResponse:
    seed = body.seed
    if seed is None:
        seed = _stable_seed_from_obj({"request": body.request, "format": body.format, "turn": body.turn, "policy": body.policy})
    rng = random.Random(seed)

    # Use only request JSON.
    if body.policy == "random":
        choice = random_policy_choose(body.request, rng=rng)
        return ChooseResponse(choice=choice)
    if body.policy == "heuristic":
        choice = heuristic_policy_choose(body.request, rng=rng)
        return ChooseResponse(choice=choice)

    model = resolve_policy_model(body.policy, MODEL_STORE)
    if model is None:
        choice = heuristic_policy_choose(body.request, rng=rng)
        return ChooseResponse(choice=choice)

    choice = learned_policy_choose(body.request, rng=rng, model=model)

    return ChooseResponse(choice=choice)


class TrainBatchRequest(BaseModel):
    trajectories: List[Dict[str, Any]]
    lr: float = 0.01


class TrainBatchResponse(BaseModel):
    ok: bool
    step: int
    n_rows: int
    n_updates: int
    mean_return: float


@app.post("/train_batch", response_model=TrainBatchResponse)
def train_batch(body: TrainBatchRequest) -> TrainBatchResponse:
    # Expect obs_mode=full so obs is the request JSON.
    step, n_updates, mean_return = MODEL_STORE.train_from_trajectories(body.trajectories, lr=body.lr)
    return TrainBatchResponse(ok=True, step=step, n_rows=len(body.trajectories), n_updates=n_updates, mean_return=mean_return)


class SaveSnapshotRequest(BaseModel):
    tag: str = ""


class SaveSnapshotResponse(BaseModel):
    snapshot_id: str


@app.post("/save_snapshot", response_model=SaveSnapshotResponse)
def save_snapshot(body: SaveSnapshotRequest) -> SaveSnapshotResponse:
    sid = MODEL_STORE.save_snapshot(tag=body.tag)
    return SaveSnapshotResponse(snapshot_id=sid)


class ListSnapshotsResponse(BaseModel):
    snapshot_ids: List[str]


@app.get("/list_snapshots", response_model=ListSnapshotsResponse)
def list_snapshots() -> ListSnapshotsResponse:
    return ListSnapshotsResponse(snapshot_ids=MODEL_STORE.list_snapshots())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8099)
    args = parser.parse_args()

    import uvicorn

    uvicorn.run("agent_server:app", host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
