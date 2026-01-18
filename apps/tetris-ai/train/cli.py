from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Dict, List

import numpy as np
import torch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from agent.ppo import PPOAgent, StepSample
from common.config import load_config
from common.logger import setup_logger
from common.paths import checkpoints_dir, ensure_dirs, metrics_dir
from common.seed import get_seed, set_seed
from env.tetris_env import TetrisEnv
from eval.cli import run_eval


def _save_json(path: Path, payload: Dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _append_jsonl(path: Path, payload: Dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(payload, ensure_ascii=False) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Train Tetris PPO agent")
    parser.add_argument("--config", type=str, default=str(Path("config/tetris-ai/config.yaml")))
    parser.add_argument("--run-id", type=str, default="")
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--total-steps", type=int, default=None)
    parser.add_argument("--eval-interval", type=int, default=None)
    parser.add_argument("--eval-episodes", type=int, default=None)
    parser.add_argument("--device", type=str, default="cpu")
    args = parser.parse_args()

    cfg = load_config(Path(args.config))
    train_cfg = cfg.get("train", {})
    eval_cfg = cfg.get("eval", {})

    seed = args.seed if args.seed is not None else get_seed(train_cfg.get("seed", 0))
    set_seed(seed)

    run_id = args.run_id or train_cfg.get("run_id") or time.strftime("run_%Y%m%d_%H%M%S")
    total_steps = args.total_steps or int(train_cfg.get("total_steps", 2000))
    eval_interval = args.eval_interval or int(train_cfg.get("eval_interval", 500))
    eval_episodes = args.eval_episodes or int(eval_cfg.get("episodes", 3))
    device = args.device or str(train_cfg.get("device", "cpu"))

    ensure_dirs()
    log_path = Path("data/tetris-ai/logs") / run_id / "train.log"
    logger = setup_logger("tetris-train", log_path)

    env = TetrisEnv(seed=seed, next_size=int(cfg.get("rules", {}).get("next", 5)), max_steps=int(train_cfg.get("max_steps_per_episode", 1000)))
    state = env.reset()

    state_dim = int(state["features"].shape[0])
    action_dim = 5  # from ActionCandidate.action_features

    agent = PPOAgent(
        state_dim=state_dim,
        action_dim=action_dim,
        hidden_dim=int(train_cfg.get("hidden_dim", 256)),
        lr=float(train_cfg.get("lr", 3e-4)),
        gamma=float(train_cfg.get("gamma", 0.99)),
        gae_lambda=float(train_cfg.get("gae_lambda", 0.95)),
        clip_eps=float(train_cfg.get("clip_eps", 0.2)),
        device=device,
    )

    run_meta = {
        "run_id": run_id,
        "seed": seed,
        "config": cfg,
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    _save_json(Path("data/tetris-ai/runs") / run_id / "run.json", run_meta)

    metrics_path = metrics_dir(run_id) / "events.jsonl"
    buffer: List[StepSample] = []

    global_step = 0
    episodes = 0
    episode_reward = 0.0
    episode_steps = 0

    while global_step < total_steps:
        actions = env.legal_actions()
        action_features = np.stack([a.action_features() for a in actions]) if actions else np.zeros((0, action_dim), dtype=np.float32)
        action_idx, log_prob, value, _ = agent.act(state["features"], action_features)
        next_state, reward, done, info = env.step(action_idx)

        buffer.append(
            StepSample(
                state_features=state["features"],
                action_features=action_features,
                action_index=action_idx,
                log_prob=log_prob,
                value=value,
                reward=reward,
                done=done,
            )
        )

        episode_reward += reward
        episode_steps += 1
        global_step += 1
        state = next_state

        if done:
            episodes += 1
            _append_jsonl(
                metrics_path,
                {
                    "type": "episode",
                    "run_id": run_id,
                    "step": global_step,
                    "episode": episodes,
                    "reward": episode_reward,
                    "steps": episode_steps,
                    "lines": info.get("total_lines", 0),
                    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                },
            )
            state = env.reset()
            episode_reward = 0.0
            episode_steps = 0

        # Update policy
        if len(buffer) >= int(train_cfg.get("update_interval", 128)):
            losses = agent.update(buffer)
            buffer.clear()
            _append_jsonl(
                metrics_path,
                {
                    "type": "train",
                    "run_id": run_id,
                    "step": global_step,
                    "loss": losses.get("loss", 0.0),
                    "policy_loss": losses.get("policy_loss", 0.0),
                    "value_loss": losses.get("value_loss", 0.0),
                    "entropy": losses.get("entropy", 0.0),
                    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                },
            )

        if global_step % eval_interval == 0 or global_step == total_steps:
            checkpoint_id = f"step_{global_step:07d}"
            ckpt_dir = checkpoints_dir(run_id)
            ckpt_dir.mkdir(parents=True, exist_ok=True)
            ckpt_path = ckpt_dir / f"{checkpoint_id}.pt"
            torch.save({"policy": agent.policy.state_dict(), "value": agent.value.state_dict(), "step": global_step}, ckpt_path)

            summary = run_eval(
                agent=agent,
                config=cfg,
                run_id=run_id,
                checkpoint_id=checkpoint_id,
                episodes=eval_episodes,
                device=device,
                seed=seed,
            )

            meta = {
                "id": f"{run_id}/{checkpoint_id}",
                "run_id": run_id,
                "checkpoint_id": checkpoint_id,
                "step": global_step,
                "summary": summary,
                "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "path": str(ckpt_path).replace("\\", "/"),
            }
            _save_json(ckpt_dir / f"{checkpoint_id}.json", meta)
            _append_jsonl(
                metrics_path,
                {
                    "type": "eval",
                    "run_id": run_id,
                    "step": global_step,
                    "checkpoint_id": checkpoint_id,
                    **summary,
                    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                },
            )

            logger.info("Eval %s: mean_reward=%.3f mean_lines=%.3f", checkpoint_id, summary.get("mean_reward", 0.0), summary.get("mean_lines", 0.0))

    logger.info("Training done. total_steps=%d", total_steps)


if __name__ == "__main__":
    main()
