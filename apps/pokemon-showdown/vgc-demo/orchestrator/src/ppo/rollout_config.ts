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

  // Keep existing behavior default.
  const DEFAULT = 256;

  const srcHint = String(process.env.PPO_ROLLOUT_LEN_SOURCE ?? '').trim().toLowerCase();
  const hinted = srcHint === 'cli' ? 'cli' : srcHint ? 'unknown' : null;

  if (!has) {
    return { value: DEFAULT, source: 'default' };
  }

  const parsed = Number(raw);
  const v = clampInt(parsed, 8, 4096);

  // If a hint exists (e.g., set by PowerShell runner), respect it.
  if (hinted) return { value: v, source: hinted, raw };
  return { value: v, source: 'env', raw };
}
