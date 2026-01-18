from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Tuple

import numpy as np
import torch
from torch import nn

from agent.policy import PolicyNetwork, ValueNetwork


@dataclass
class StepSample:
    state_features: np.ndarray
    action_features: np.ndarray
    action_index: int
    log_prob: float
    value: float
    reward: float
    done: bool


class PPOAgent:
    def __init__(
        self,
        *,
        state_dim: int,
        action_dim: int,
        hidden_dim: int = 256,
        lr: float = 3e-4,
        gamma: float = 0.99,
        gae_lambda: float = 0.95,
        clip_eps: float = 0.2,
        value_coef: float = 0.5,
        entropy_coef: float = 0.01,
        device: str = "cpu",
    ) -> None:
        self.device = device
        self.gamma = gamma
        self.gae_lambda = gae_lambda
        self.clip_eps = clip_eps
        self.value_coef = value_coef
        self.entropy_coef = entropy_coef

        self.policy = PolicyNetwork(state_dim + action_dim, hidden_dim=hidden_dim).to(device)
        self.value = ValueNetwork(state_dim, hidden_dim=hidden_dim).to(device)
        self.optimizer = torch.optim.Adam(list(self.policy.parameters()) + list(self.value.parameters()), lr=lr)

    def act(self, state_features: np.ndarray, action_features: np.ndarray) -> Tuple[int, float, float, np.ndarray]:
        if action_features.shape[0] == 0:
            return 0, 0.0, 0.0, np.array([], dtype=np.float32)
        state_t = torch.from_numpy(state_features).float().to(self.device)
        action_t = torch.from_numpy(action_features).float().to(self.device)

        # Expand state for each action
        state_expand = state_t.unsqueeze(0).repeat(action_t.shape[0], 1)
        logits = self.policy(torch.cat([state_expand, action_t], dim=1))
        probs = torch.softmax(logits, dim=0)
        dist = torch.distributions.Categorical(probs=probs)
        action_idx = int(dist.sample().item())
        log_prob = float(dist.log_prob(torch.tensor(action_idx, device=self.device)).item())
        value = float(self.value(state_t).item())
        return action_idx, log_prob, value, probs.detach().cpu().numpy()

    def evaluate(self, state_features: np.ndarray, action_features: np.ndarray, action_index: int) -> Tuple[float, float, float]:
        state_t = torch.from_numpy(state_features).float().to(self.device)
        action_t = torch.from_numpy(action_features).float().to(self.device)
        if action_t.shape[0] == 0:
            return 0.0, 0.0, 0.0
        state_expand = state_t.unsqueeze(0).repeat(action_t.shape[0], 1)
        logits = self.policy(torch.cat([state_expand, action_t], dim=1))
        probs = torch.softmax(logits, dim=0)
        dist = torch.distributions.Categorical(probs=probs)
        log_prob = dist.log_prob(torch.tensor(action_index, device=self.device))
        entropy = dist.entropy()
        value = self.value(state_t)
        return float(log_prob.item()), float(entropy.item()), float(value.item())

    def update(self, batch: List[StepSample]) -> Dict[str, float]:
        if not batch:
            return {"loss": 0.0}

        # Compute advantages and returns using GAE
        rewards = [s.reward for s in batch]
        dones = [s.done for s in batch]
        values = [s.value for s in batch]
        advantages = []
        gae = 0.0
        for i in reversed(range(len(batch))):
            mask = 0.0 if dones[i] else 1.0
            next_value = values[i + 1] if i + 1 < len(values) else 0.0
            delta = rewards[i] + self.gamma * next_value * mask - values[i]
            gae = delta + self.gamma * self.gae_lambda * mask * gae
            advantages.insert(0, gae)
        returns = [adv + v for adv, v in zip(advantages, values)]

        # Normalize advantages
        adv_t = torch.tensor(advantages, dtype=torch.float32, device=self.device)
        adv_t = (adv_t - adv_t.mean()) / (adv_t.std() + 1e-8)

        policy_losses: List[torch.Tensor] = []
        value_losses: List[torch.Tensor] = []
        entropies: List[torch.Tensor] = []

        for i, sample in enumerate(batch):
            state_f = sample.state_features
            action_f = sample.action_features
            action_idx = sample.action_index
            old_log_prob = sample.log_prob

            if action_f.shape[0] == 0:
                continue

            state_t = torch.from_numpy(state_f).float().to(self.device)
            action_t = torch.from_numpy(action_f).float().to(self.device)
            state_expand = state_t.unsqueeze(0).repeat(action_t.shape[0], 1)
            logits = self.policy(torch.cat([state_expand, action_t], dim=1))
            probs = torch.softmax(logits, dim=0)
            dist = torch.distributions.Categorical(probs=probs)

            new_log_prob = dist.log_prob(torch.tensor(action_idx, device=self.device))
            entropy = dist.entropy()
            value = self.value(state_t)

            ratio = torch.exp(new_log_prob - torch.tensor(old_log_prob, device=self.device))
            surr1 = ratio * adv_t[i]
            surr2 = torch.clamp(ratio, 1 - self.clip_eps, 1 + self.clip_eps) * adv_t[i]
            policy_losses.append(-torch.min(surr1, surr2))

            ret = torch.tensor(returns[i], device=self.device)
            value_losses.append((ret - value) ** 2)
            entropies.append(entropy)

        if not policy_losses:
            return {"loss": 0.0}

        loss_policy = torch.mean(torch.stack(policy_losses))
        loss_value = torch.mean(torch.stack(value_losses))
        entropy_mean = torch.mean(torch.stack(entropies))
        loss = loss_policy + self.value_coef * loss_value - self.entropy_coef * entropy_mean

        self.optimizer.zero_grad()
        loss.backward()
        nn.utils.clip_grad_norm_(list(self.policy.parameters()) + list(self.value.parameters()), 0.5)
        self.optimizer.step()

        return {
            "loss": float(loss.item()),
            "policy_loss": float(loss_policy.item()),
            "value_loss": float(loss_value.item()),
            "entropy": float(entropy_mean.item()),
        }
