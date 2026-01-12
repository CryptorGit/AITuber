from __future__ import annotations

import os
import time
from dataclasses import dataclass
from pathlib import Path
from threading import Lock
from typing import Any, Dict, List, Optional, Tuple

import torch
import torch.nn as nn
import torch.nn.functional as F


ACTIONS_PER_ACTIVE = 34


@dataclass
class PpoHparams:
    gamma: float = float(os.getenv("PPO_GAMMA", "0.99"))
    gae_lambda: float = float(os.getenv("PPO_LAMBDA", "0.95"))
    clip_eps: float = float(os.getenv("PPO_CLIP", "0.2"))
    lr: float = float(os.getenv("PPO_LR", "3e-4"))
    ent_coef: float = float(os.getenv("PPO_ENT_COEF", "0.01"))
    vf_coef: float = float(os.getenv("PPO_VF_COEF", "0.5"))
    max_grad_norm: float = float(os.getenv("PPO_MAX_GRAD_NORM", "1.0"))
    epochs: int = int(os.getenv("PPO_EPOCHS", "4"))
    minibatch: int = int(os.getenv("PPO_MINIBATCH", "64"))


def _repo_root_from_here(here: Path) -> Path:
    # .../AITuber/apps/pokemon-showdown/vgc-demo/agent/ppo_rl.py
    # parents: agent -> vgc-demo -> pokemon-showdown -> apps -> AITuber
    try:
        return here.resolve().parents[4]
    except Exception:
        return Path.cwd()


def default_snapshot_dir() -> Path:
    env = os.getenv("PPO_SNAPSHOT_DIR", "").strip()
    if env:
        return Path(env)
    root = _repo_root_from_here(Path(__file__))
    return root / "data" / "pokemon-showdown" / "vgc-demo" / "ppo_snapshots"


def masked_categorical_sample(logits: torch.Tensor, mask: torch.Tensor, sample: bool, seed: Optional[int] = None) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    """Return (action, logp, entropy) for a single batch of logits.

    logits: [B,A]
    mask: [B,A] with 0/1
    """
    if mask.dtype != torch.float32:
        mask = mask.float()

    # Ensure at least one legal action per row.
    legal = mask.sum(dim=-1)
    if bool((legal <= 0).any().item()):
        raise ValueError("mask_all_zero")

    big_neg = torch.tensor(-1e9, device=logits.device, dtype=logits.dtype)
    masked_logits = torch.where(mask > 0, logits, big_neg)
    if not bool(torch.isfinite(masked_logits).all().item()):
        raise RuntimeError("masked_logits_non_finite")
    dist = torch.distributions.Categorical(logits=masked_logits)

    if sample:
        if seed is not None:
            # torch.distributions.Categorical.sample() does not accept a Generator
            # in some torch builds. Use torch.multinomial for reproducible sampling.
            g = torch.Generator(device=logits.device)
            g.manual_seed(int(seed) & 0x7FFFFFFF)
            a = torch.multinomial(dist.probs, num_samples=1, generator=g).squeeze(-1)
        else:
            a = dist.sample()
    else:
        a = torch.argmax(masked_logits, dim=-1)

    logp = dist.log_prob(a)
    entropy = dist.entropy()
    return a, logp, entropy


class PpoNet(nn.Module):
    def __init__(self):
        super().__init__()

        # Vocab sizes aligned to TS hash vocabs (+1 for 0=unknown)
        self.emb_species = nn.Embedding(4096 + 1, 16)
        self.emb_status = nn.Embedding(7 + 1, 4)
        self.emb_type = nn.Embedding(18 + 1, 4)
        self.emb_item = nn.Embedding(1024 + 1, 8)
        self.emb_ability = nn.Embedding(1024 + 1, 8)
        self.emb_tera = nn.Embedding(32 + 1, 4)
        self.emb_move = nn.Embedding(2048 + 1, 8)

        self.emb_side = nn.Embedding(2, 2)
        self.emb_slot = nn.Embedding(6, 4)

        self.emb_action = nn.Embedding(ACTIONS_PER_ACTIVE + 1, 8)

        # Per-entity encoder
        per_entity_in = (
            16  # species
            + 4  # status
            + 4 * 2  # type1,type2
            + 8  # item
            + 8  # ability
            + 4  # tera
            + 8 * 4  # moves
            + 2  # side
            + 4  # slot
            + 11  # entity_float
        )
        self.entity_mlp = nn.Sequential(
            nn.Linear(per_entity_in, 128),
            nn.ReLU(),
            nn.Linear(128, 64),
            nn.ReLU(),
        )

        # Global encoder
        global_in = 10 + 1  # global_int as floats + global_float
        hist_in = 4 * 8 + 2  # 4 action embeddings + 2 floats
        self.hist_mlp = nn.Sequential(
            nn.Linear(hist_in, 64),
            nn.ReLU(),
        )

        trunk_in = 64 + global_in + 64  # entities pooled + global + history pooled
        self.trunk = nn.Sequential(
            nn.Linear(trunk_in, 256),
            nn.ReLU(),
            nn.Linear(256, 256),
            nn.ReLU(),
        )

        self.pi_left = nn.Linear(256, ACTIONS_PER_ACTIVE)
        self.pi_right = nn.Linear(256, ACTIONS_PER_ACTIVE)
        self.v = nn.Linear(256, 1)

    def forward(self, obs: Dict[str, torch.Tensor]) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        # entity_int: [B,12,11]
        ei = obs["entity_int"].long()
        ef = obs["entity_float"].float()

        bsz = ei.size(0)

        species = ei[:, :, 0].clamp_(0, 4096)
        status = ei[:, :, 1].clamp_(0, 7)
        type1 = ei[:, :, 2].clamp_(0, 18)
        type2 = ei[:, :, 3].clamp_(0, 18)
        item = ei[:, :, 4].clamp_(0, 1024)
        ability = ei[:, :, 5].clamp_(0, 1024)
        tera = ei[:, :, 6].clamp_(0, 32)
        moves = ei[:, :, 7:11].clamp_(0, 2048)

        # side/slot
        side = torch.cat([
            torch.zeros((bsz, 6), device=ei.device, dtype=torch.long),
            torch.ones((bsz, 6), device=ei.device, dtype=torch.long),
        ], dim=1)
        slot = torch.cat([
            torch.arange(6, device=ei.device).unsqueeze(0).repeat(bsz, 1),
            torch.arange(6, device=ei.device).unsqueeze(0).repeat(bsz, 1),
        ], dim=1)

        x = torch.cat(
            [
                self.emb_species(species),
                self.emb_status(status),
                self.emb_type(type1),
                self.emb_type(type2),
                self.emb_item(item),
                self.emb_ability(ability),
                self.emb_tera(tera),
                self.emb_move(moves).flatten(2),
                self.emb_side(side),
                self.emb_slot(slot),
                ef,
            ],
            dim=-1,
        )

        ent = self.entity_mlp(x)  # [B,12,64]
        ent_pooled = ent.mean(dim=1)  # [B,64]

        gi = obs["global_int"].float()
        gf = obs["global_float"].float()
        g = torch.cat([gi, gf], dim=-1)

        # history
        hi = obs["history_int"].long().clamp_(0, ACTIONS_PER_ACTIVE)
        hf = obs["history_float"].float()
        # embed 4 actions: [B,K,4,8]
        ha = self.emb_action(hi)
        # concat per-step: [B,K,(4*8 + 2)]
        h = torch.cat([ha.flatten(2), hf], dim=-1)
        h = self.hist_mlp(h)  # [B,K,64]
        h_pooled = h.mean(dim=1)

        z = self.trunk(torch.cat([ent_pooled, g, h_pooled], dim=-1))
        logits_l = self.pi_left(z)
        logits_r = self.pi_right(z)
        v = self.v(z).squeeze(-1)
        return logits_l, logits_r, v


def _obs_to_tensors(obs_list: List[Dict[str, Any]], device: torch.device) -> Dict[str, torch.Tensor]:
    # Batch tensors with minimal validation; TS guarantees shapes.
    def stack2d(key: str) -> torch.Tensor:
        return torch.tensor([o[key] for o in obs_list], device=device)

    return {
        "entity_int": torch.tensor([o["entity_int"] for o in obs_list], device=device, dtype=torch.long),
        "entity_float": torch.tensor([o["entity_float"] for o in obs_list], device=device, dtype=torch.float32),
        "global_int": torch.tensor([o["global_int"] for o in obs_list], device=device, dtype=torch.long),
        "global_float": torch.tensor([o["global_float"] for o in obs_list], device=device, dtype=torch.float32),
        "history_int": torch.tensor([o["history_int"] for o in obs_list], device=device, dtype=torch.long),
        "history_float": torch.tensor([o["history_float"] for o in obs_list], device=device, dtype=torch.float32),
    }


class PpoService:
    def __init__(self, device: Optional[str] = None, hparams: Optional[PpoHparams] = None):
        self.device = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
        self.h = hparams or PpoHparams()

        self.net = PpoNet().to(self.device)
        self.opt = torch.optim.Adam(self.net.parameters(), lr=self.h.lr)

        self.update_step = 0
        self.lock = Lock()

        # Snapshot-opponent inference cache.
        # IMPORTANT: Snapshot policies must not mutate the learner net or update_step.
        self._snapshot_cache_sid = None
        self._snapshot_cache_net = None

        self.snapshot_dir = default_snapshot_dir()
        self.snapshot_dir.mkdir(parents=True, exist_ok=True)

    def _get_snapshot_net(self, sid: str) -> Optional[PpoNet]:
        # Cache 1 snapshot net to avoid repeated disk loads.
        if self._snapshot_cache_sid == sid and self._snapshot_cache_net is not None:
            return self._snapshot_cache_net

        path = self.snapshot_dir / f"{sid}.pt"
        if not path.exists():
            return None

        try:
            j = torch.load(path, map_location=self.device)
            net = PpoNet().to(self.device)
            net.load_state_dict(j["state_dict"], strict=True)
            net.eval()
            self._snapshot_cache_sid = sid
            self._snapshot_cache_net = net
            return net
        except Exception:
            return None

    @torch.no_grad()
    def act(self, *, policy_id: str, obs: Dict[str, Any], mask_left: List[int], mask_right: List[int], sample: bool, seed: Optional[int]) -> Dict[str, Any]:
        if len(mask_left) != ACTIONS_PER_ACTIVE:
            raise ValueError(f"mask_left_len_invalid:{len(mask_left)}")
        if len(mask_right) != ACTIONS_PER_ACTIVE:
            raise ValueError(f"mask_right_len_invalid:{len(mask_right)}")
        if sum(1 for x in mask_left if int(x) != 0) <= 0:
            raise ValueError("mask_all_zero_left")
        if sum(1 for x in mask_right if int(x) != 0) <= 0:
            raise ValueError("mask_all_zero_right")

        # Baseline: uniform random over legal actions.
        if policy_id == "baseline":
            ml = torch.tensor([mask_left], device=self.device)
            mr = torch.tensor([mask_right], device=self.device)
            # logits all zeros -> uniform over masked
            zeros = torch.zeros((1, ACTIONS_PER_ACTIVE), device=self.device)
            a_l, logp_l, _ = masked_categorical_sample(zeros, ml, sample=True, seed=seed)
            a_r, logp_r, _ = masked_categorical_sample(zeros, mr, sample=True, seed=None if seed is None else seed + 1)
            return {
                "a_left": int(a_l.item()),
                "a_right": int(a_r.item()),
                "logp": float((logp_l + logp_r).item()),
                "value": 0.0,
            }

        # Snapshot opponents: run inference on a separate net so we don't mutate learner state.
        net = self.net
        if policy_id.startswith("snapshot:"):
            sid = policy_id.split(":", 1)[1]
            with self.lock:
                snap = self._get_snapshot_net(sid)
            if snap is None:
                raise ValueError(f"snapshot_not_found:{sid}")
            net = snap

        t = _obs_to_tensors([obs], self.device)
        logits_l, logits_r, v = net(t)
        if not bool(torch.isfinite(logits_l).all().item()) or not bool(torch.isfinite(logits_r).all().item()) or not bool(torch.isfinite(v).all().item()):
            raise RuntimeError("non_finite_logits_or_value")
        ml = torch.tensor([mask_left], device=self.device)
        mr = torch.tensor([mask_right], device=self.device)

        a_l, logp_l, ent_l = masked_categorical_sample(logits_l, ml, sample=sample, seed=seed)
        a_r, logp_r, ent_r = masked_categorical_sample(logits_r, mr, sample=sample, seed=None if seed is None else seed + 1)

        return {
            "a_left": int(a_l.item()),
            "a_right": int(a_r.item()),
            "logp": float((logp_l + logp_r).item()),
            "value": float(v.item()),
            "entropy": float((ent_l + ent_r).item()),
        }

    def train(self, rollout: Dict[str, Any]) -> Dict[str, Any]:
        with self.lock:
            return self._train_locked(rollout)

    def _train_locked(self, rollout: Dict[str, Any]) -> Dict[str, Any]:
        t0 = time.time()
        h = self.h

        warnings: List[str] = []

        def _isfinite_tensor(x: torch.Tensor) -> bool:
            try:
                return bool(torch.isfinite(x).all().item())
            except Exception:
                return False

        def _warn_or_raise(msg: str, fatal: bool) -> None:
            warnings.append(msg)
            if fatal:
                raise ValueError(msg)

        obs_list = rollout["obs"]
        T = len(obs_list)
        if T <= 0:
            return {
                "ok": False,
                "update_step": self.update_step,
                "n_steps": 0,
                "samples": 0,
                "policy_loss": 0.0,
                "value_loss": 0.0,
                "entropy": 0.0,
                "approx_kl": 0.0,
                "clipfrac": 0.0,
                "adv_mean": 0.0,
                "adv_std": 0.0,
                "grad_norm": 0.0,
                "warnings": ["empty_rollout"],
                "metrics": {"error": 1.0},
            }

        device = self.device
        obs_t = _obs_to_tensors(obs_list, device)

        mask_left = torch.tensor(rollout["mask_left"], device=device)
        mask_right = torch.tensor(rollout["mask_right"], device=device)
        a_left = torch.tensor(rollout["a_left"], device=device, dtype=torch.long)
        a_right = torch.tensor(rollout["a_right"], device=device, dtype=torch.long)
        old_logp = torch.tensor(rollout["old_logp"], device=device, dtype=torch.float32)

        reward = torch.tensor(rollout["reward"], device=device, dtype=torch.float32)
        done = torch.tensor(rollout["done"], device=device, dtype=torch.float32)

        # Basic rollout validity checks.
        if mask_left.ndim != 2 or mask_left.shape[0] != T or mask_left.shape[1] != ACTIONS_PER_ACTIVE:
            _warn_or_raise(f"mask_left_shape_invalid: {tuple(mask_left.shape)}", fatal=True)
        if mask_right.ndim != 2 or mask_right.shape[0] != T or mask_right.shape[1] != ACTIONS_PER_ACTIVE:
            _warn_or_raise(f"mask_right_shape_invalid: {tuple(mask_right.shape)}", fatal=True)

        ml_sum = mask_left.float().sum(dim=-1)
        mr_sum = mask_right.float().sum(dim=-1)
        if int((ml_sum <= 0).sum().item()) > 0 or int((mr_sum <= 0).sum().item()) > 0:
            _warn_or_raise(
                f"mask_zero_in_rollout: left_zero={int((ml_sum <= 0).sum().item())} right_zero={int((mr_sum <= 0).sum().item())}",
                fatal=True,
            )

        if not _isfinite_tensor(reward):
            _warn_or_raise("nonfinite_reward", fatal=True)
        if not _isfinite_tensor(done):
            _warn_or_raise("nonfinite_done", fatal=True)

        # Bootstrap
        last_obs = rollout["last_obs"]
        last_done = float(rollout.get("last_done", 0) or 0)

        with torch.no_grad():
            logits_l, logits_r, v = self.net(obs_t)
            if not _isfinite_tensor(logits_l) or not _isfinite_tensor(logits_r):
                _warn_or_raise("nonfinite_logits", fatal=True)
            if not _isfinite_tensor(v):
                _warn_or_raise("nonfinite_value", fatal=True)
            # current logp under current net for actions in batch
            big_neg = torch.tensor(-1e9, device=device)
            ml = torch.where(mask_left > 0, logits_l, big_neg)
            mr = torch.where(mask_right > 0, logits_r, big_neg)
            dist_l = torch.distributions.Categorical(logits=ml)
            dist_r = torch.distributions.Categorical(logits=mr)
            logp = dist_l.log_prob(a_left) + dist_r.log_prob(a_right)
            ent = dist_l.entropy() + dist_r.entropy()
            if not _isfinite_tensor(logp) or not _isfinite_tensor(ent):
                _warn_or_raise("nonfinite_logp_or_entropy", fatal=True)

            # value
            values = v

            last_v = 0.0
            if last_done < 0.5:
                last_t = _obs_to_tensors([last_obs], device)
                _, _, last_val = self.net(last_t)
                last_v = float(last_val.item())

        # GAE
        next_values = torch.cat([values[1:], torch.tensor([last_v], device=device)])
        next_nonterminal = 1.0 - torch.cat([done[1:], torch.tensor([last_done], device=device)])
        deltas = reward + h.gamma * next_values * next_nonterminal - values

        if not _isfinite_tensor(deltas):
            _warn_or_raise("nonfinite_deltas", fatal=True)

        adv = torch.zeros_like(values)
        gae = 0.0
        for t in reversed(range(T)):
            gae = float(deltas[t].item()) + h.gamma * h.gae_lambda * float(next_nonterminal[t].item()) * gae
            adv[t] = gae
        ret = adv + values

        if not _isfinite_tensor(adv) or not _isfinite_tensor(ret):
            _warn_or_raise("nonfinite_adv_or_returns", fatal=True)

        adv_abs_max = float(adv.abs().max().item())
        if adv_abs_max > 100.0:
            _warn_or_raise(f"adv_scale_large: max_abs={adv_abs_max:.3f}", fatal=True)

        adv_mean = float(adv.mean().item())
        adv_std = float(adv.std(unbiased=False).item())

        # Normalize advantages
        adv = (adv - adv.mean()) / (adv.std(unbiased=False) + 1e-8)

        # Flatten for minibatching
        idx = torch.randperm(T, device=device)

        clip_eps = h.clip_eps
        total_loss_v = 0.0
        total_loss_pi = 0.0
        total_ent = 0.0
        total_kl = 0.0
        total_clipfrac = 0.0
        total_grad_norm = 0.0
        n_mb = 0

        for _epoch in range(max(1, h.epochs)):
            for start in range(0, T, max(1, h.minibatch)):
                mb = idx[start : start + h.minibatch]

                mb_obs = {k: v[mb] for k, v in obs_t.items()}
                mb_ml = mask_left[mb]
                mb_mr = mask_right[mb]
                mb_al = a_left[mb]
                mb_ar = a_right[mb]
                mb_old_logp = old_logp[mb]
                mb_adv = adv[mb]
                mb_ret = ret[mb]

                logits_l, logits_r, vpred = self.net(mb_obs)
                big_neg = torch.tensor(-1e9, device=device)
                logits_l = torch.where(mb_ml > 0, logits_l, big_neg)
                logits_r = torch.where(mb_mr > 0, logits_r, big_neg)
                dist_l = torch.distributions.Categorical(logits=logits_l)
                dist_r = torch.distributions.Categorical(logits=logits_r)

                new_logp = dist_l.log_prob(mb_al) + dist_r.log_prob(mb_ar)
                entropy = (dist_l.entropy() + dist_r.entropy()).mean()

                ratio = torch.exp(new_logp - mb_old_logp)
                clipfrac = (torch.abs(ratio - 1.0) > clip_eps).float().mean()
                surr1 = ratio * mb_adv
                surr2 = torch.clamp(ratio, 1.0 - clip_eps, 1.0 + clip_eps) * mb_adv
                loss_pi = -(torch.min(surr1, surr2)).mean()

                loss_v = 0.5 * F.mse_loss(vpred, mb_ret)

                loss = loss_pi + h.vf_coef * loss_v - h.ent_coef * entropy

                self.opt.zero_grad(set_to_none=True)
                loss.backward()
                grad_norm = nn.utils.clip_grad_norm_(self.net.parameters(), h.max_grad_norm)
                self.opt.step()

                with torch.no_grad():
                    approx_kl = (mb_old_logp - new_logp).mean()

                total_loss_pi += float(loss_pi.item())
                total_loss_v += float(loss_v.item())
                total_ent += float(entropy.item())
                total_kl += float(approx_kl.item())
                total_clipfrac += float(clipfrac.item())
                total_grad_norm += float(grad_norm.item()) if torch.is_tensor(grad_norm) else float(grad_norm)
                n_mb += 1

        self.update_step += 1

        dt = time.time() - t0
        mb_denom = float(max(1, n_mb))
        policy_loss = total_loss_pi / mb_denom
        value_loss = total_loss_v / mb_denom
        entropy = total_ent / mb_denom
        approx_kl = total_kl / mb_denom
        clipfrac = total_clipfrac / mb_denom
        grad_norm = total_grad_norm / mb_denom

        if not all(map(lambda x: isinstance(x, float) and (x == x) and abs(x) < 1e9, [policy_loss, value_loss, entropy, approx_kl, clipfrac, grad_norm])):
            _warn_or_raise("nonfinite_or_huge_metrics", fatal=True)

        metrics = {
            "policy_loss": float(policy_loss),
            "value_loss": float(value_loss),
            "entropy": float(entropy),
            "approx_kl": float(approx_kl),
            "clipfrac": float(clipfrac),
            "adv_mean": float(adv_mean),
            "adv_std": float(adv_std),
            "grad_norm": float(grad_norm),
            "samples": float(T),
            "sec": float(dt),
        }

        return {
            "ok": True,
            "update_step": int(self.update_step),
            "n_steps": int(T),
            "samples": int(T),
            "policy_loss": float(policy_loss),
            "value_loss": float(value_loss),
            "entropy": float(entropy),
            "approx_kl": float(approx_kl),
            "clipfrac": float(clipfrac),
            "adv_mean": float(adv_mean),
            "adv_std": float(adv_std),
            "grad_norm": float(grad_norm),
            "warnings": warnings,
            "metrics": metrics,
        }

    def list_snapshots(self) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        for p in sorted(self.snapshot_dir.glob("*.pt")):
            sid = p.stem
            try:
                j = torch.load(p, map_location="cpu")
                step = int(j.get("update_step", 0))
            except Exception:
                step = 0
            out.append({"id": sid, "step": step, "path": str(p)})
        return out

    def save_snapshot(self, tag: str = "") -> str:
        with self.lock:
            sid = f"s{self.update_step:07d}"
            if tag:
                safe = "".join(ch for ch in tag if ch.isalnum() or ch in ("-", "_"))[:32]
                if safe:
                    sid = f"{sid}_{safe}"
            path = self.snapshot_dir / f"{sid}.pt"
            payload = {
                "update_step": self.update_step,
                "state_dict": self.net.state_dict(),
                "opt_state": self.opt.state_dict(),
            }
            torch.save(payload, path)

            # Retention: keep only the most recent MAX_SNAPSHOTS.
            try:
                max_keep = int(os.getenv("MAX_SNAPSHOTS", "30") or "30")
            except Exception:
                max_keep = 30
            if max_keep > 0:
                def _snap_step(stem: str) -> int:
                    # stem like: s0000123_tag
                    if not stem.startswith("s"):
                        return -1
                    digits = []
                    for ch in stem[1:]:
                        if ch.isdigit():
                            digits.append(ch)
                        else:
                            break
                    try:
                        return int("".join(digits)) if digits else -1
                    except Exception:
                        return -1

                snaps = sorted(
                    self.snapshot_dir.glob("*.pt"),
                    key=lambda p: (_snap_step(p.stem), p.stem),
                )
                extra = len(snaps) - max_keep
                if extra > 0:
                    for old in snaps[:extra]:
                        try:
                            old.unlink()
                        except Exception:
                            pass
            return sid

    def load_snapshot(self, sid: str) -> bool:
        with self.lock:
            return self._load_snapshot_into_net(sid, also_opt=True)

    def _load_snapshot_into_net(self, sid: str, also_opt: bool = False) -> bool:
        path = self.snapshot_dir / f"{sid}.pt"
        if not path.exists():
            return False
        try:
            j = torch.load(path, map_location=self.device)
            self.net.load_state_dict(j["state_dict"], strict=True)
            if also_opt and "opt_state" in j:
                self.opt.load_state_dict(j["opt_state"])
            if "update_step" in j:
                self.update_step = int(j["update_step"])
            return True
        except Exception:
            return False
