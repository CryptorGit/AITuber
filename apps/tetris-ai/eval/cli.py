from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
import torch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from agent.ppo import PPOAgent
from common.config import load_config
from common.logger import setup_logger
from common.paths import replays_dir, videos_dir, thumbs_dir
from common.seed import set_seed
from env.tetris_env import TetrisEnv
from record.replay import ReplayMeta, ReplayWriter, encode_board
from render.video import render_replay_to_video


def _save_json(path: Path, payload: Dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def run_eval(
    *,
    agent: PPOAgent,
    config: Dict,
    run_id: str,
    checkpoint_id: str,
    episodes: int,
    device: str,
    seed: int,
) -> Dict[str, float]:
    eval_cfg = config.get("eval", {})
    rules_cfg = config.get("rules", {})
    max_steps = int(eval_cfg.get("max_steps_per_episode", 1000))

    env = TetrisEnv(seed=seed + 13, next_size=int(rules_cfg.get("next", 5)), max_steps=max_steps)
    logger = setup_logger("tetris-eval", Path("data/tetris-ai/logs") / run_id / "eval.log")
    agent.policy.eval()
    agent.value.eval()

    rewards: List[float] = []
    lines: List[float] = []
    episode_infos: List[Dict] = []

    for ep in range(episodes):
        state = env.reset()
        done = False
        ep_reward = 0.0
        ep_steps = 0
        meta = ReplayMeta(
            ruleset_version=str(config.get("ruleset_version", "v1")),
            seed=seed,
            policy_id=checkpoint_id,
            timestamp=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        )

        replay_path = replays_dir(run_id, checkpoint_id) / f"episode_{ep:03d}.jsonl"
        writer = ReplayWriter(replay_path, meta)

        while not done:
            actions = env.legal_actions()
            action_features = np.stack([a.action_features() for a in actions]) if actions else np.zeros((0, 5), dtype=np.float32)
            # Greedy action
            if action_features.shape[0] == 0:
                action_idx = 0
            else:
                state_t = torch.from_numpy(state["features"]).float().to(device)
                action_t = torch.from_numpy(action_features).float().to(device)
                state_expand = state_t.unsqueeze(0).repeat(action_t.shape[0], 1)
                logits = agent.policy(torch.cat([state_expand, action_t], dim=1))
                action_idx = int(torch.argmax(logits).item())

            next_state, reward, done, info = env.step(action_idx)

            act = actions[action_idx] if actions else None
            writer.append_step(
                {
                    "step_idx": ep_steps,
                    "piece_id": act.piece if act else "",
                    "rotation": act.rotation if act else 0,
                    "x": act.x if act else 0,
                    "y": act.y if act else 0,
                    "drop_mode": "hard",
                    "board": encode_board(env.board[2:]),
                    "lines_cleared": info.get("lines", 0),
                    "reward": reward,
                    "done": done,
                }
            )

            ep_reward += reward
            ep_steps += 1
            state = next_state

        rewards.append(ep_reward)
        lines.append(float(env.total_lines))

        # Render video best-effort
        video_path = videos_dir(run_id, checkpoint_id) / f"episode_{ep:03d}.mp4"
        thumb_path = thumbs_dir(run_id, checkpoint_id) / f"episode_{ep:03d}.png"
        ok = render_replay_to_video(
            replay_path=replay_path,
            video_path=video_path,
            thumb_path=thumb_path,
            fps=int(eval_cfg.get("fps", 30)),
            cell=int(eval_cfg.get("cell", 24)),
            repo_root=Path(__file__).resolve().parents[3],
        )

        episode_infos.append(
            {
                "id": f"{run_id}/{checkpoint_id}/episode_{ep:03d}.jsonl",
                "episode": ep,
                "reward": ep_reward,
                "lines": float(env.total_lines),
                "steps": ep_steps,
                "video": f"{run_id}/{checkpoint_id}/episode_{ep:03d}.mp4" if ok else "",
                "thumb": f"{run_id}/{checkpoint_id}/episode_{ep:03d}.png" if ok else "",
            }
        )

    index = {
        "checkpoint_id": checkpoint_id,
        "run_id": run_id,
        "episodes": episode_infos,
    }
    _save_json(replays_dir(run_id, checkpoint_id) / "index.json", index)

    summary = {
        "mean_reward": float(np.mean(rewards)) if rewards else 0.0,
        "mean_lines": float(np.mean(lines)) if lines else 0.0,
        "episodes": episodes,
    }
    logger.info("Eval done: %s", summary)
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate a Tetris PPO checkpoint")
    parser.add_argument("--config", type=str, default=str(Path("config/tetris-ai/config.yaml")))
    parser.add_argument("--run-id", type=str, required=True)
    parser.add_argument("--checkpoint-id", type=str, required=True)
    parser.add_argument("--device", type=str, default="cpu")
    parser.add_argument("--episodes", type=int, default=3)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--checkpoint-path", type=str, default="")
    args = parser.parse_args()

    cfg = load_config(Path(args.config))
    state = torch.load(args.checkpoint_path, map_location=args.device)
    # Build a dummy env to get dims
    env = TetrisEnv(seed=args.seed, next_size=int(cfg.get("rules", {}).get("next", 5)))
    state_dim = int(env.get_state()["features"].shape[0])
    action_dim = 5
    agent = PPOAgent(state_dim=state_dim, action_dim=action_dim, device=args.device)
    agent.policy.load_state_dict(state.get("policy"))
    agent.value.load_state_dict(state.get("value"))

    run_eval(
        agent=agent,
        config=cfg,
        run_id=args.run_id,
        checkpoint_id=args.checkpoint_id,
        episodes=args.episodes,
        device=args.device,
        seed=args.seed,
    )


if __name__ == "__main__":
    main()
