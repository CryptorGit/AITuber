import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { appendJsonl } from '../io/jsonl';
import { repoRoot } from '../shared';

type TrainMetrics = {
  policy_loss: number;
  value_loss: number;
  entropy: number;
  approx_kl: number;
  clipfrac: number;
  adv_mean: number;
  adv_std: number;
  grad_norm: number;
};

type TrainRecord = {
  run_id: string;
  timestamp: string;
  battle_count: number;
  train_calls: number;
  update_step: number;
  rollout_steps_sent: number;
  rollout_len: number;
  rollout_len_source: string;
  rollout_buffer_len: number;
  episodes_finished: number;
  mean_reward: number;
  mean_ep_return: number;
  invalid_choice_count: number;
  ppo_act_http_error_count: number;
  mask_zero_count: number;
  samples: number;
  warnings: string[];
  metrics: TrainMetrics;
};

function isoNow() {
  return new Date().toISOString();
}

function makeFallbackRunId(): string {
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, '');
  const rand = Math.random().toString(16).slice(2, 8);
  return `${ts}_${rand}`;
}

class RingBuffer {
  private buf: number[] = [];
  private idx = 0;

  constructor(readonly capacity: number) {}

  push(v: number): void {
    if (this.capacity <= 0) return;
    if (this.buf.length < this.capacity) {
      this.buf.push(v);
      return;
    }
    this.buf[this.idx] = v;
    this.idx = (this.idx + 1) % this.capacity;
  }

  mean(): number {
    if (this.buf.length === 0) return 0;
    let s = 0;
    for (const v of this.buf) s += v;
    return s / this.buf.length;
  }

  get size(): number {
    return this.buf.length;
  }
}

export class PpoRunStats {
  readonly run_id: string;

  // Counters
  battle_count = 0;
  train_calls = 0;
  rollout_steps_sent = 0;
  episodes_finished = 0;
  invalid_choice_count = 0;
  ppo_act_http_error_count = 0;
  mask_zero_count = 0;
  last_update_step = 0;

  // Applied PPO config (captured from runtime resolution)
  applied_rollout_len = 0;
  applied_rollout_len_source = 'unknown';

  // Collector state
  rollout_buffer_len = 0;

  // Rolling stats
  private recentStepRewards = new RingBuffer(1000);
  private recentEpisodeReturns = new RingBuffer(100);

  // Last train metrics
  lastTrain: { update_step: number; samples: number; warnings: string[]; metrics: TrainMetrics } | null = null;

  // Log throttling
  private lastLogMs = 0;
  private lastLogTrainCalls = 0;

  readonly metricsPath: string;
  readonly dumpsDir: string;

  constructor(run_id?: string, opts?: { metricsPath?: string; dumpsDir?: string }) {
    const root = repoRoot();
    this.run_id = String(run_id || '').trim() || makeFallbackRunId();

    const baseDir = join(root, 'logs', 'runs', this.run_id);
    this.metricsPath = opts?.metricsPath ?? join(baseDir, 'ppo_train_metrics.jsonl');
    this.dumpsDir = opts?.dumpsDir ?? join(baseDir, 'dumps');

    mkdirSync(dirname(this.metricsPath), { recursive: true });
    mkdirSync(this.dumpsDir, { recursive: true });
  }

  forceLogProgress(tag: 'final' | 'start' = 'final'): void {
    const lt = this.lastTrain;
    const u = lt?.update_step ?? this.last_update_step;
    const m = lt?.metrics;
    console.log(
      `[ppo][${tag}] run_id=${this.run_id} battles_done=${this.battle_count} train_calls=${this.train_calls} update_step=${u} invalid_choice=${this.invalid_choice_count} ppo_act_http_error=${this.ppo_act_http_error_count} mask_zero=${this.mask_zero_count} rollout_steps_sent=${this.rollout_steps_sent} rollout_len=${this.applied_rollout_len || 'na'} rollout_len_source=${this.applied_rollout_len_source} rollout_buffer_len=${this.rollout_buffer_len} episodes_finished=${this.episodes_finished} mean_reward=${this.recentStepRewards.mean().toFixed(4)} mean_ep_return=${this.recentEpisodeReturns.mean().toFixed(4)} entropy=${m ? m.entropy.toFixed(4) : 'na'} kl=${m ? m.approx_kl.toFixed(4) : 'na'} clipfrac=${m ? m.clipfrac.toFixed(4) : 'na'}`
    );
  }

  setAppliedConfig(cfg: { rollout_len: number; rollout_len_source: string }): void {
    this.applied_rollout_len = Math.max(0, Math.trunc(Number(cfg.rollout_len) || 0));
    this.applied_rollout_len_source = String(cfg.rollout_len_source || 'unknown');
  }

  setCollectorState(s: { rollout_buffer_len: number }): void {
    this.rollout_buffer_len = Math.max(0, Math.trunc(Number(s.rollout_buffer_len) || 0));
  }

  onBattleFinished(): void {
    this.battle_count++;
  }

  recordEpisodeReturn(v: number): void {
    this.episodes_finished++;
    this.recentEpisodeReturns.push(v);
  }

  recordTrainedBatch(stepRewards: number[]): void {
    for (const r of stepRewards) this.recentStepRewards.push(Number(r) || 0);
  }

  recordTrainResponse(res: {
    update_step: number;
    samples: number;
    warnings: string[];
    metrics: Partial<TrainMetrics>;
  }): void {
    this.train_calls++;
    this.last_update_step = Math.max(this.last_update_step, Number(res.update_step) || 0);
    this.rollout_steps_sent += Math.max(0, Number(res.samples) || 0);

    const m: TrainMetrics = {
      policy_loss: Number(res.metrics.policy_loss ?? 0),
      value_loss: Number(res.metrics.value_loss ?? 0),
      entropy: Number(res.metrics.entropy ?? 0),
      approx_kl: Number(res.metrics.approx_kl ?? 0),
      clipfrac: Number(res.metrics.clipfrac ?? 0),
      adv_mean: Number(res.metrics.adv_mean ?? 0),
      adv_std: Number(res.metrics.adv_std ?? 0),
      grad_norm: Number(res.metrics.grad_norm ?? 0),
    };

    this.lastTrain = {
      update_step: Number(res.update_step) || 0,
      samples: Number(res.samples) || 0,
      warnings: Array.isArray(res.warnings) ? res.warnings.map(String) : [],
      metrics: m,
    };

    const rec: TrainRecord = {
      run_id: this.run_id,
      timestamp: isoNow(),
      battle_count: this.battle_count,
      train_calls: this.train_calls,
      update_step: this.lastTrain.update_step,
      rollout_steps_sent: this.rollout_steps_sent,
      rollout_len: this.applied_rollout_len,
      rollout_len_source: this.applied_rollout_len_source,
      rollout_buffer_len: this.rollout_buffer_len,
      episodes_finished: this.episodes_finished,
      mean_reward: this.recentStepRewards.mean(),
      mean_ep_return: this.recentEpisodeReturns.mean(),
      invalid_choice_count: this.invalid_choice_count,
      ppo_act_http_error_count: this.ppo_act_http_error_count,
      mask_zero_count: this.mask_zero_count,
      samples: this.lastTrain.samples,
      warnings: this.lastTrain.warnings,
      metrics: this.lastTrain.metrics,
    };

    appendJsonl(this.metricsPath, rec as any);
    this.maybeLogProgress();
  }

  maybeLogProgress(): void {
    const now = Date.now();
    const dueByTime = now - this.lastLogMs >= 30_000;
    const dueByCalls = this.train_calls - this.lastLogTrainCalls >= 5;
    if (!dueByTime && !dueByCalls) return;

    this.lastLogMs = now;
    this.lastLogTrainCalls = this.train_calls;

    const lt = this.lastTrain;
    const u = lt?.update_step ?? this.last_update_step;
    const m = lt?.metrics;
    console.log(
      `[ppo][progress] run_id=${this.run_id} battles_done=${this.battle_count} train_calls=${this.train_calls} update_step=${u} invalid_choice=${this.invalid_choice_count} ppo_act_http_error=${this.ppo_act_http_error_count} mask_zero=${this.mask_zero_count} rollout_steps_sent=${this.rollout_steps_sent} rollout_len=${this.applied_rollout_len || 'na'} rollout_len_source=${this.applied_rollout_len_source} rollout_buffer_len=${this.rollout_buffer_len} episodes_finished=${this.episodes_finished} mean_reward=${this.recentStepRewards.mean().toFixed(4)} mean_ep_return=${this.recentEpisodeReturns.mean().toFixed(4)} entropy=${m ? m.entropy.toFixed(4) : 'na'} kl=${m ? m.approx_kl.toFixed(4) : 'na'} clipfrac=${m ? m.clipfrac.toFixed(4) : 'na'}`
    );
  }

  incInvalidChoice(): void {
    this.invalid_choice_count++;
  }

  incPpoActHttpError(): void {
    this.ppo_act_http_error_count++;
  }

  incMaskZero(): void {
    this.mask_zero_count++;
  }

  writeDump(fileBase: string, payload: any): string {
    mkdirSync(this.dumpsDir, { recursive: true });
    const path = join(this.dumpsDir, fileBase);
    writeFileSync(path, JSON.stringify(payload, null, 2), 'utf8');
    return path;
  }
}
