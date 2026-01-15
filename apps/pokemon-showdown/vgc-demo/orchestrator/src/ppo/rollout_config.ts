export type PpoRolloutLenConfig = {
  value: number;
  source: 'cli' | 'env' | 'default' | 'unknown';
  raw?: string;
};

function clampInt(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}

export function resolvePpoRolloutLen(): PpoRolloutLenConfig {
  const raw = String(process.env.PPO_ROLLOUT_LEN ?? '').trim();
  const has = raw.length > 0;

  // Default PPO update frequency for the vgc-demo trainer.
  // This is in *decision steps* (not turns): we train after collecting this many
  // action selections from the learner.
  const DEFAULT = 5048;

  const srcHint = String(process.env.PPO_ROLLOUT_LEN_SOURCE ?? '').trim().toLowerCase();
  const hinted = srcHint === 'cli' ? 'cli' : srcHint ? 'unknown' : null;

  if (!has) {
    return { value: DEFAULT, source: 'default' };
  }

  const parsed = Number(raw);
  // Allow the configured value to exceed the old 4096 cap.
  const v = clampInt(parsed, 8, 8192);

  // If a hint exists (e.g., set by PowerShell runner), respect it.
  if (hinted) return { value: v, source: hinted, raw };
  return { value: v, source: 'env', raw };
}
