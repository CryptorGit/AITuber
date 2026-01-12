from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import random
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from ppo_rl import PpoService

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
PPO = PpoService()

app = FastAPI(title="vgc-demo-agent")

logger = logging.getLogger("vgc_demo_agent")


class PpoActRequest(BaseModel):
    # Optional correlation id (recommended: battle_id + turn).
    request_id: Optional[str] = None
    battle_id: Optional[str] = None
    turn: Optional[int] = None
    side: Optional[str] = None
    policy_id: str = Field(..., description="learner | baseline | snapshot:<id>")
    obs: Dict[str, Any]
    mask_left: List[int]
    mask_right: List[int]
    sample: bool = True
    seed: Optional[int] = None


class PpoActResponse(BaseModel):
    a_left: int
    a_right: int
    logp: float
    value: float


class PpoRollout(BaseModel):
    obs: List[Dict[str, Any]]
    mask_left: List[List[int]]
    mask_right: List[List[int]]
    a_left: List[int]
    a_right: List[int]
    old_logp: List[float]
    old_value: List[float]
    reward: List[float]
    done: List[int]
    last_obs: Dict[str, Any]
    last_done: int


class PpoTrainRequest(BaseModel):
    rollout: PpoRollout


class PpoTrainResponse(BaseModel):
    ok: bool
    update_step: int
    samples: int
    policy_loss: float
    value_loss: float
    entropy: float
    approx_kl: float
    clipfrac: float
    adv_mean: float
    adv_std: float
    grad_norm: float
    warnings: List[str]
    # Back-compat: also return a metrics map for TS convenience.
    metrics: Dict[str, float]


class SnapshotListResponse(BaseModel):
    snapshots: List[Dict[str, Any]]


class SnapshotSaveRequest(BaseModel):
    tag: str = ""


class SnapshotSaveResponse(BaseModel):
    id: str


class SnapshotLoadRequest(BaseModel):
    id: str


class SnapshotLoadResponse(BaseModel):
    ok: bool


@app.post("/act", response_model=PpoActResponse)
def ppo_act(body: PpoActRequest) -> PpoActResponse:
    def _shape(v: Any) -> Any:
        if not isinstance(v, list):
            return None
        if len(v) == 0:
            return [0]
        if isinstance(v[0], list):
            return [len(v), len(v[0])]
        return [len(v)]

    def _obs_shapes(o: Dict[str, Any]) -> Dict[str, Any]:
        out: Dict[str, Any] = {}
        for k in ["entity_int", "entity_float", "global_int", "global_float", "history_int", "history_float"]:
            out[k] = _shape(o.get(k))
        return out

    def _mask_sum(xs: List[int]) -> int:
        try:
            return int(sum(1 for x in xs if int(x) != 0))
        except Exception:
            return -1

    # Minimal request diagnostics we always include in logs/errors.
    req_id = (body.request_id or "").strip() or None
    details = {
        "request_id": req_id,
        "battle_id": (body.battle_id or "").strip() or None,
        "turn": body.turn,
        "side": (body.side or "").strip() or None,
        "policy_id": (body.policy_id or "").strip(),
        "mask_left_len": len(body.mask_left) if isinstance(body.mask_left, list) else None,
        "mask_right_len": len(body.mask_right) if isinstance(body.mask_right, list) else None,
        "mask_left_sum": _mask_sum(body.mask_left) if isinstance(body.mask_left, list) else None,
        "mask_right_sum": _mask_sum(body.mask_right) if isinstance(body.mask_right, list) else None,
        "obs_shapes": _obs_shapes(body.obs or {}),
    }

    # Strict input validation: never turn these into 500s.
    try:
        if not isinstance(body.obs, dict):
            raise HTTPException(status_code=400, detail={"error": "ACT_FAILED", "message": "missing_or_invalid_obs", "details": details})

        # Expected shapes (must match TS PackedObs).
        expected = {
            "entity_int": [12, 11],
            "entity_float": [12, 11],
            "global_int": [10],
            "global_float": [1],
            "history_int": [4, 4],
            "history_float": [4, 2],
        }
        for k, shp in expected.items():
            if k not in body.obs:
                raise HTTPException(status_code=400, detail={"error": "ACT_FAILED", "message": f"missing_obs_key:{k}", "details": details})
            got = _shape(body.obs.get(k))
            if got != shp:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "error": "ACT_FAILED",
                        "message": "obs_shape_mismatch",
                        "details": {**details, "bad_key": k, "expected": shp, "got": got},
                    },
                )

        # Masks
        if not isinstance(body.mask_left, list) or not isinstance(body.mask_right, list):
            raise HTTPException(status_code=400, detail={"error": "ACT_FAILED", "message": "missing_or_invalid_mask", "details": details})
        if len(body.mask_left) != 34 or len(body.mask_right) != 34:
            raise HTTPException(status_code=400, detail={"error": "ACT_FAILED", "message": "mask_shape_mismatch", "details": details})
        if details["mask_left_sum"] is not None and int(details["mask_left_sum"]) <= 0:
            raise HTTPException(status_code=400, detail={"error": "ACT_FAILED", "message": "mask_all_zero_left", "details": details})
        if details["mask_right_sum"] is not None and int(details["mask_right_sum"]) <= 0:
            raise HTTPException(status_code=400, detail={"error": "ACT_FAILED", "message": "mask_all_zero_right", "details": details})
    except HTTPException:
        # Surface 4xx without converting to 500.
        raise

    # Execute PPO act with guaranteed traceback on failure.
    try:
        res = PPO.act(
            policy_id=body.policy_id,
            obs=body.obs,
            mask_left=body.mask_left,
            mask_right=body.mask_right,
            sample=body.sample,
            seed=body.seed,
        )
        return PpoActResponse(a_left=int(res["a_left"]), a_right=int(res["a_right"]), logp=float(res["logp"]), value=float(res["value"]))
    except ValueError as e:
        # Treat PPO validation as 400 so TS can fail-fast.
        logger.exception("ACT_FAILED", extra={"details": details, "kind": "value_error"})
        raise HTTPException(status_code=400, detail={"error": "ACT_FAILED", "message": str(e), "details": details})
    except Exception as e:
        # Always log traceback.
        logger.exception("ACT_FAILED", extra={"details": details, "kind": "exception"})
        dev = os.getenv("PPO_DEV_ERRORS", "1").strip() not in ("0", "false", "False")
        msg = str(e) if dev else "internal_error"
        raise HTTPException(status_code=500, detail={"error": "ACT_FAILED", "message": msg, "details": details})


@app.post("/train", response_model=PpoTrainResponse)
def ppo_train(body: PpoTrainRequest) -> PpoTrainResponse:
    rollout = body.rollout
    payload = rollout.model_dump() if hasattr(rollout, "model_dump") else rollout.dict()
    try:
        # Learner update_step must be monotonic and must not be affected by snapshot inference.
        before = int(getattr(PPO, "update_step", 0) or 0)
        res = PPO.train(payload)
        after = int(getattr(PPO, "update_step", 0) or 0)
        if logger.isEnabledFor(logging.DEBUG):
            logger.debug(
                "TRAIN_OK",
                extra={
                    "learner_update_step_before": before,
                    "learner_update_step_after": after,
                    "res_update_step": int(res.get("update_step", 0)),
                    "samples": int(res.get("samples", res.get("n_steps", 0) or 0)),
                },
            )
    except ValueError as e:
        # Treat PPO validation issues as a 400 so TS can fail fast.
        raise HTTPException(status_code=400, detail={"error": str(e)})
    except Exception as e:
        raise HTTPException(status_code=500, detail={"error": str(e)})

    metrics = res.get("metrics") or {}
    metrics_f = {str(k): float(v) for k, v in metrics.items() if isinstance(v, (int, float))}
    warnings = res.get("warnings") or []
    if not isinstance(warnings, list):
        warnings = [str(warnings)]

    return PpoTrainResponse(
        ok=bool(res.get("ok")),
        update_step=int(res.get("update_step", 0)),
        samples=int(res.get("samples", res.get("n_steps", 0) or 0)),
        policy_loss=float(res.get("policy_loss", metrics_f.get("policy_loss", 0.0))),
        value_loss=float(res.get("value_loss", metrics_f.get("value_loss", 0.0))),
        entropy=float(res.get("entropy", metrics_f.get("entropy", 0.0))),
        approx_kl=float(res.get("approx_kl", metrics_f.get("approx_kl", 0.0))),
        clipfrac=float(res.get("clipfrac", metrics_f.get("clipfrac", 0.0))),
        adv_mean=float(res.get("adv_mean", metrics_f.get("adv_mean", 0.0))),
        adv_std=float(res.get("adv_std", metrics_f.get("adv_std", 0.0))),
        grad_norm=float(res.get("grad_norm", metrics_f.get("grad_norm", 0.0))),
        warnings=[str(w) for w in warnings],
        metrics=metrics_f,
    )


@app.get("/snapshot/list", response_model=SnapshotListResponse)
def snapshot_list() -> SnapshotListResponse:
    return SnapshotListResponse(snapshots=PPO.list_snapshots())


@app.post("/snapshot/save", response_model=SnapshotSaveResponse)
def snapshot_save(body: SnapshotSaveRequest) -> SnapshotSaveResponse:
    sid = PPO.save_snapshot(tag=body.tag)
    return SnapshotSaveResponse(id=sid)


@app.post("/snapshot/load", response_model=SnapshotLoadResponse)
def snapshot_load(body: SnapshotLoadRequest) -> SnapshotLoadResponse:
    ok = PPO.load_snapshot(body.id)
    return SnapshotLoadResponse(ok=bool(ok))


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
    parser.add_argument(
        "--log-level",
        default=(os.getenv("PPO_LOG_LEVEL") or os.getenv("LOG_LEVEL") or "info"),
        help="Uvicorn log level (env: PPO_LOG_LEVEL, LOG_LEVEL)",
    )
    args = parser.parse_args()

    import uvicorn

    uvicorn.run("agent_server:app", host=args.host, port=args.port, log_level=str(args.log_level))


if __name__ == "__main__":
    main()
