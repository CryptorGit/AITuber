import type { PackedObs } from './obs_types';
import { PpoClient } from './ppo_client';
import type { PpoRunStats } from './ppo_observability';

export type RolloutStep = {
  obs: PackedObs;
  mask_left: number[];
  mask_right: number[];
  a_left: number;
  a_right: number;
  old_logp: number;
  old_value: number;
  reward: number;
  done: number;
};

export class RolloutCollector {
  private steps: RolloutStep[] = [];
  private pendingIndex: number | null = null;
  private lastObs: PackedObs | null = null;
  private lastDone = 0;

  private readonly saveReplayEveryUpdates: number;

  // Latch that becomes true when we successfully trained, and should be consumed
  // by the *next* battle to decide whether to persist a replay.
  private saveNextReplayCount = 0;

  updateStepCount = 0;

  constructor(readonly client: PpoClient, readonly rolloutLen: number, readonly stats?: PpoRunStats) {
    const rawEvery = String(process.env.VGC_SAVE_REPLAY_EVERY_N_UPDATES ?? '').trim();
    const parsed = Math.trunc(Number(rawEvery || '1'));
    this.saveReplayEveryUpdates = Number.isFinite(parsed) ? Math.max(1, parsed) : 1;
  }

  get size(): number {
    return this.steps.length;
  }

  peekSaveNextReplay(): boolean {
    return this.saveNextReplayCount > 0;
  }

  consumeSaveNextReplay(): boolean {
    if (this.saveNextReplayCount <= 0) return false;
    this.saveNextReplayCount -= 1;
    return true;
  }

  restoreSaveNextReplay(): void {
    this.saveNextReplayCount += 1;
  }

  // Called when we are about to choose an action for learner.
  // The shaping reward computed since last decision gets assigned to previous step.
  applyRewardToPrevious(reward: number): void {
    if (this.pendingIndex === null) return;
    const i = this.pendingIndex;
    const prev = this.steps[i];
    this.steps[i] = { ...prev, reward: prev.reward + reward };
    this.pendingIndex = null;
  }

  // Record a decision step (reward/done will be filled later).
  pushDecision(step: Omit<RolloutStep, 'reward' | 'done'>): void {
    const row: RolloutStep = { ...step, reward: 0, done: 0 };
    this.steps.push(row);
    this.pendingIndex = this.steps.length - 1;
    this.lastObs = step.obs;
    this.lastDone = 0;
  }

  // Called at terminal.
  finalizeTerminal(terminalReward: number): void {
    if (this.pendingIndex !== null) {
      const i = this.pendingIndex;
      const prev = this.steps[i];
      this.steps[i] = { ...prev, reward: prev.reward + terminalReward, done: 1 };
      this.pendingIndex = null;
    } else if (this.steps.length > 0) {
      const i = this.steps.length - 1;
      const prev = this.steps[i];
      this.steps[i] = { ...prev, reward: prev.reward + terminalReward, done: 1 };
    }
    this.lastDone = 1;
  }

  // Set bootstrap obs at the end of rollout chunk.
  setBootstrapObs(obs: PackedObs, done: number): void {
    this.lastObs = obs;
    this.lastDone = done ? 1 : 0;
  }

  async maybeTrain(): Promise<{ trained: boolean; metrics?: any }>{
    // Never train while the most recent step is still pending reward assignment.
    if (this.pendingIndex !== null) return { trained: false };
    if (this.steps.length < this.rolloutLen) return { trained: false };
    if (!this.lastObs) return { trained: false };

    const batch = this.steps.slice(0, this.rolloutLen);
    this.steps = this.steps.slice(this.rolloutLen);

    // Observability: record step rewards that are actually sent to the learner.
    try {
      this.stats?.recordTrainedBatch(batch.map((s) => s.reward));
    } catch {
      // ignore
    }

    const body = {
      rollout: {
        obs: batch.map((s) => s.obs),
        mask_left: batch.map((s) => s.mask_left),
        mask_right: batch.map((s) => s.mask_right),
        a_left: batch.map((s) => s.a_left),
        a_right: batch.map((s) => s.a_right),
        old_logp: batch.map((s) => s.old_logp),
        old_value: batch.map((s) => s.old_value),
        reward: batch.map((s) => s.reward),
        done: batch.map((s) => s.done),
        last_obs: this.lastObs,
        last_done: this.lastDone,
      },
    };

    let res: any;
    try {
      res = await this.client.train(body);
    } catch (e: any) {
      const payload = {
        reason: 'train_error',
        error: {
          message: String(e?.message ?? e),
          stack: String(e?.stack ?? ''),
          name: String(e?.name ?? ''),
        },
        update_step_before: this.updateStepCount,
        rollout_len: this.rolloutLen,
        batch_len: batch.length,
        body,
      };
      try {
        const base = `train_error_${Date.now()}.json`;
        this.stats?.writeDump(base, payload);
      } catch {
        // ignore
      }
      throw e;
    }

    const prevUpdateStep = this.updateStepCount;
    this.updateStepCount = res.update_step;

    const k = this.saveReplayEveryUpdates;
    const prevBucket = Math.floor(Math.max(0, prevUpdateStep) / k);
    const nextBucket = Math.floor(Math.max(0, this.updateStepCount) / k);
    const crossed = Math.max(0, nextBucket - prevBucket);
    this.saveNextReplayCount += crossed;
    return { trained: true, metrics: res };
  }
}
