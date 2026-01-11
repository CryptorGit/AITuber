from __future__ import annotations

import json
import os
import time
import hashlib
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

from policies import _extract_candidates_from_request, _target_suffix


def _find_repo_root(start: Path) -> Path:
    # Walk upwards looking for a repo root marker.
    # Prefer .git, otherwise a combo that matches this repo layout.
    for p in [start, *start.parents]:
        try:
            if (p / ".git").exists():
                return p
            if (p / "apps").exists() and (p / "data").exists() and (p / "requirements.txt").exists():
                return p
        except Exception:
            continue
    return start


def _hash_to_index(token: str, dim: int) -> int:
    h = hashlib.sha1(token.encode("utf-8")).digest()
    n = int.from_bytes(h[:8], "big", signed=False)
    return int(n % dim)


def _species_from_details(details: Any) -> str:
    if not details:
        return ""
    s = str(details)
    # Showdown details like: "Tornadus, M, L50" etc.
    return s.split(",", 1)[0].strip().lower()


def _active_species(req: Dict[str, Any]) -> List[str]:
    side = req.get("side") or {}
    pokemon = side.get("pokemon") or []
    out: List[str] = []
    for p in pokemon:
        if not isinstance(p, dict):
            continue
        if not p.get("active"):
            continue
        if p.get("fainted"):
            continue
        cond = str(p.get("condition") or "")
        if cond in ("0 fnt", "0fnt"):
            continue
        out.append(_species_from_details(p.get("details")))
    return out


def _move_ids(req: Dict[str, Any]) -> List[str]:
    out: List[str] = []
    for a in (req.get("active") or []):
        if not isinstance(a, dict):
            continue
        for m in (a.get("moves") or []):
            if not isinstance(m, dict):
                continue
            mid = (m.get("id") or "").strip().lower()
            if mid and not m.get("disabled"):
                out.append(mid)
    return out


@dataclass
class SparseModel:
    dim: int = 1 << 18
    weights: Dict[int, float] = None  # type: ignore
    step: int = 0

    def __post_init__(self) -> None:
        if self.weights is None:
            self.weights = {}

    def score(self, req: Dict[str, Any], turn: int, action: str) -> float:
        idxs = featurize(req, turn, action, dim=self.dim)
        return float(sum(self.weights.get(i, 0.0) for i in idxs))

    def update(self, idxs: Iterable[int], delta: float) -> int:
        n = 0
        for i in idxs:
            self.weights[i] = float(self.weights.get(i, 0.0) + delta)
            n += 1
        return n


def featurize(req: Dict[str, Any], turn: int, action: str, dim: int) -> List[int]:
    tokens: List[str] = []
    tokens.append("bias")
    tokens.append(f"turn_bin:{int(turn)//5}")

    for s in _active_species(req)[:2]:
        if s:
            tokens.append(f"active_species:{s}")

    for mid in _move_ids(req)[:12]:
        tokens.append(f"has_move:{mid}")

    a = " ".join(action.strip().lower().split())
    tokens.append(f"action:{a}")
    for part in a.split(","):
        p = part.strip()
        if p:
            tokens.append(f"action_part:{p}")
            for w in p.split(" "):
                if w:
                    tokens.append(f"action_tok:{w}")

    return [_hash_to_index(t, dim) for t in tokens]


def _softmax_choice(items: List[Tuple[str, float]], rng: random.Random) -> str:
    # Numerically stable softmax sampling.
    mx = max(s for _, s in items)
    exps = [pow(2.718281828, s - mx) for _, s in items]
    total = sum(exps)
    r = rng.random() * total
    for (act, _), e in zip(items, exps):
        r -= e
        if r <= 0:
            return act
    return items[-1][0]


def _active_count(req: Dict[str, Any]) -> int:
    side_pokemon = (req.get("side") or {}).get("pokemon") or []
    active_count_side = 0
    for p in side_pokemon:
        if not isinstance(p, dict):
            continue
        if not p.get("active"):
            continue
        if p.get("fainted"):
            continue
        cond = str(p.get("condition") or "")
        if cond in ("0 fnt", "0fnt"):
            continue
        active_count_side += 1
    active_count_req = sum(1 for a in (req.get("active") or []) if isinstance(a, dict))
    return int(active_count_side or active_count_req or 1)


def learned_policy_choose(req: Dict[str, Any], rng: random.Random, model: SparseModel) -> str:
    # Team preview
    if req.get("teamPreview"):
        pokemon = (req.get("side") or {}).get("pokemon") or []
        order = list(range(1, len(pokemon) + 1))
        rng.shuffle(order)
        return f"team {''.join(str(i) for i in order)}"

    moves, switches = _extract_candidates_from_request(req)

    # Forced switch (keep it simple/deterministic-ish)
    force_switch = req.get("forceSwitch")
    if isinstance(force_switch, list) and any(force_switch):
        available = list(switches)
        picks: List[str] = []
        for need in force_switch:
            if not need:
                continue
            if available:
                s = rng.choice(available)
                available.remove(s)
                picks.append(f"switch {s['slot']}")
            else:
                picks.append("pass")
        return ", ".join(picks) if picks else "default"

    if req.get("forceSwitch") and switches:
        target = rng.choice(switches)
        return f"switch {target['slot']}"

    turn = int(req.get("turn") or 0)
    active_count = _active_count(req)

    # Singles
    if active_count <= 1:
        candidates: List[str] = []
        for m in moves:
            move_slot = int(m["move_index"]) + 1
            candidates.append(f"move {move_slot}{_target_suffix(m.get('target'), m.get('id'), m.get('move'))}")
        for s in switches:
            candidates.append(f"switch {s['slot']}")
        if not candidates:
            return "default"
        scored = [(c, model.score(req, turn, c)) for c in candidates]
        return _softmax_choice(scored, rng)

    # Doubles: independent per-active choice (good enough for first-stage learning infra)
    per_active: List[str] = []
    active_indices = sorted({m["active"] for m in moves})
    if not active_indices:
        active_indices = list(range(active_count))
    for active_index in active_indices[:active_count]:
        candidates: List[str] = []
        moves_ai = [m for m in moves if m["active"] == active_index]
        for m in moves_ai:
            move_slot = int(m["move_index"]) + 1
            candidates.append(f"move {move_slot}{_target_suffix(m.get('target'), m.get('id'), m.get('move'))}")
        for s in switches:
            candidates.append(f"switch {s['slot']}")
        if not candidates:
            per_active.append("default")
            continue
        scored = [(c, model.score(req, turn, f"a{active_index}:{c}")) for c in candidates]
        pick = _softmax_choice(scored, rng)
        per_active.append(pick)

    return ", ".join(per_active)


class LearnedModelStore:
    def __init__(self) -> None:
        base = Path(__file__).resolve().parent
        repo_root = _find_repo_root(base)
        default_dir = repo_root / "data" / "pokemon-showdown" / "vgc-demo" / "models"
        self.model_dir = Path(os.getenv("VGC_LEARN_MODEL_DIR", str(default_dir)))
        self.model_dir.mkdir(parents=True, exist_ok=True)
        (self.model_dir / "snapshots").mkdir(parents=True, exist_ok=True)
        self.latest_path = self.model_dir / "latest.json"
        self.model = self._load_latest()

    def _load_latest(self) -> SparseModel:
        if not self.latest_path.exists():
            m = SparseModel()
            self._save_model(m, self.latest_path)
            return m
        try:
            j = json.loads(self.latest_path.read_text(encoding="utf-8"))
            dim = int(j.get("dim") or (1 << 18))
            step = int(j.get("step") or 0)
            wj = j.get("weights") or {}
            weights = {int(k): float(v) for k, v in wj.items()}
            return SparseModel(dim=dim, weights=weights, step=step)
        except Exception:
            m = SparseModel()
            self._save_model(m, self.latest_path)
            return m

    def _save_model(self, model: SparseModel, path: Path) -> None:
        payload = {
            "dim": model.dim,
            "step": model.step,
            "weights": {str(k): v for k, v in model.weights.items()},
        }
        path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    def resolve_snapshot(self, snapshot_id: str) -> Optional[SparseModel]:
        snap_path = self.model_dir / "snapshots" / f"{snapshot_id}.json"
        if not snap_path.exists():
            return None
        try:
            j = json.loads(snap_path.read_text(encoding="utf-8"))
            dim = int(j.get("dim") or (1 << 18))
            step = int(j.get("step") or 0)
            wj = j.get("weights") or {}
            weights = {int(k): float(v) for k, v in wj.items()}
            return SparseModel(dim=dim, weights=weights, step=step)
        except Exception:
            return None

    def list_snapshots(self) -> List[str]:
        snap_dir = self.model_dir / "snapshots"
        ids: List[str] = []
        for p in sorted(snap_dir.glob("*.json")):
            ids.append(p.stem)
        return ids

    def save_snapshot(self, tag: str = "") -> str:
        sid = f"{int(time.time())}_{self.model.step}"
        if tag:
            safe = "".join(c for c in tag if c.isalnum() or c in ("-", "_"))
            if safe:
                sid = f"{sid}_{safe}"
        snap_path = self.model_dir / "snapshots" / f"{sid}.json"
        self._save_model(self.model, snap_path)
        return sid

    def train_from_trajectories(self, rows: List[Dict[str, Any]], lr: float = 0.01) -> Tuple[int, int, float]:
        # Group per battle, find terminal return, and apply it to all steps.
        by_episode: Dict[Tuple[str, str], List[Dict[str, Any]]] = {}
        for r in rows:
            bid = str(r.get("battle_id") or "")
            player = str(r.get("player") or "")
            if not bid or not player:
                continue
            by_episode.setdefault((bid, player), []).append(r)

        total_return = 0.0
        n_ep = 0
        n_updates = 0

        for (bid, player), steps in by_episode.items():
            # Find terminal reward
            ep_ret = 0.0
            for s in steps:
                if bool(s.get("done")):
                    try:
                        ep_ret = float(s.get("reward") or 0.0)
                    except Exception:
                        ep_ret = 0.0
            total_return += ep_ret
            n_ep += 1

            if ep_ret == 0.0:
                continue

            for s in steps:
                obs = s.get("obs")
                if not isinstance(obs, dict):
                    # We require obs_mode=full; otherwise skip.
                    continue
                turn = int(s.get("turn") or 0)
                choice = str(s.get("choice") or "")
                if not choice:
                    continue
                idxs = featurize(obs, turn, choice, dim=self.model.dim)
                n_updates += self.model.update(idxs, delta=lr * ep_ret)

        self.model.step += 1
        self._save_model(self.model, self.latest_path)

        mean_ret = (total_return / n_ep) if n_ep else 0.0
        return self.model.step, n_updates, mean_ret


def resolve_policy_model(policy: str, store: LearnedModelStore) -> Optional[SparseModel]:
    p = (policy or "").strip()
    if p == "learned":
        return store.model
    if p.startswith("snapshot:"):
        sid = p.split(":", 1)[1].strip()
        if not sid:
            return None
        return store.resolve_snapshot(sid)
    return None
