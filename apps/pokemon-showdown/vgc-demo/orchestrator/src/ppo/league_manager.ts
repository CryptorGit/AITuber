import { PpoClient, type SnapshotInfo } from './ppo_client';

export type LeagueSample =
  | { policy_id: 'learner' }
  | { policy_id: `snapshot:${string}`; snapshot_id: string }
  | { policy_id: 'baseline' };

function makeRng(seed: number) {
  // xorshift32
  let x = (seed >>> 0) || 0x12345678;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 0x1_0000_0000) / 0x1_0000_0000;
  };
}

function stratifiedPick(snapshots: SnapshotInfo[], rng: () => number): SnapshotInfo | null {
  if (!snapshots.length) return null;
  const n = snapshots.length;
  const thirds = Math.max(1, Math.floor(n / 3));
  const buckets: SnapshotInfo[][] = [
    snapshots.slice(Math.max(0, n - thirds)), // recent
    snapshots.slice(Math.max(0, n - 2 * thirds), Math.max(0, n - thirds)), // mid
    snapshots.slice(0, Math.max(0, n - 2 * thirds)), // old
  ].filter((b) => b.length > 0);

  const bucket = buckets[Math.floor(rng() * buckets.length)] ?? snapshots;
  return bucket[Math.floor(rng() * bucket.length)] ?? snapshots[n - 1];
}

export class LeagueManager {
  private cached: SnapshotInfo[] = [];
  private lastFetchMs = 0;

  constructor(readonly client: PpoClient) {}

  async refreshSnapshots(minIntervalMs = 5_000): Promise<void> {
    const now = Date.now();
    if (now - this.lastFetchMs < minIntervalMs) return;
    this.lastFetchMs = now;
    try {
      const snaps = await this.client.listSnapshots();
      // sort by step then id
      this.cached = snaps
        .slice()
        .sort((a, b) => {
          const da = Number(a.step ?? 0);
          const db = Number(b.step ?? 0);
          if (da !== db) return da - db;
          return String(a.id).localeCompare(String(b.id));
        })
        .filter((s) => String(s.id ?? '').trim().length > 0);
    } catch {
      // keep old cache
    }
  }

  sampleOpponent(seed: number): LeagueSample {
    // Ratio:
    // 50% latest (mirror)
    // 40% stratified snapshots
    // 10% baseline
    const rng = makeRng(seed);
    const r = rng();

    if (r < 0.5) return { policy_id: 'learner' };

    if (r < 0.9) {
      const snap = stratifiedPick(this.cached, rng);
      if (snap) return { policy_id: `snapshot:${snap.id}`, snapshot_id: snap.id };
      return { policy_id: 'learner' };
    }

    return { policy_id: 'baseline' };
  }
}
