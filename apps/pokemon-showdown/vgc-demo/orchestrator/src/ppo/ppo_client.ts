import type { PackedObs } from './obs_types';

export type PpoActRequest = {
  // Optional correlation id (recommended: battle_id + turn).
  request_id?: string;
  battle_id?: string;
  turn?: number;
  side?: 'p1' | 'p2';
  policy_id: string; // learner | snapshot:<id> | baseline
  obs: PackedObs;
  mask_left: number[]; // len A
  mask_right: number[]; // len A
  sample: boolean;
  // Optional: encourage reproducibility.
  seed?: number;
};

export type PpoActResponse = {
  a_left: number;
  a_right: number;
  logp: number; // sum of log-probs (left+right)
  value: number;
};

export type PpoTrainRequest = {
  rollout: {
    obs: PackedObs[];
    mask_left: number[][];
    mask_right: number[][];
    a_left: number[];
    a_right: number[];
    old_logp: number[];
    old_value: number[];
    reward: number[];
    done: number[]; // 0/1
    // bootstrap
    last_obs: PackedObs;
    last_done: number;
  };
};

export type PpoTrainResponse = {
  // Required (new contract)
  update_step: number;
  samples: number;
  policy_loss: number;
  value_loss: number;
  entropy: number;
  approx_kl: number;
  clipfrac: number;
  adv_mean: number;
  adv_std: number;
  grad_norm: number;
  warnings: string[];

  // Back-compat / convenience
  ok?: boolean;
  n_steps?: number;
  metrics?: Record<string, any>;
};

export type SnapshotInfo = { id: string; step: number; path?: string };

export type SnapshotListResponse = { snapshots: SnapshotInfo[] };

export type SnapshotSaveResponse = { id: string };

export type SnapshotLoadResponse = { ok: boolean };

export class PpoHttpError extends Error {
  constructor(
    readonly status: number,
    readonly bodySnippet: string,
    readonly url: string
  ) {
    super(`HTTP ${status}${bodySnippet ? `: ${bodySnippet}` : ''}`);
    this.name = 'PpoHttpError';
  }
}

async function postJson(url: string, body: any, timeoutMs = 30_000): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      let text = '';
      try {
        text = await res.text();
      } catch {
        text = '';
      }
      const detail = text.length > 2000 ? text.slice(0, 2000) + '…' : text;
      throw new PpoHttpError(res.status, detail, url);
    }
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function getJson(url: string, timeoutMs = 10_000): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'GET', signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export class PpoClient {
  constructor(readonly baseUrl: string) {}

  async act(req: PpoActRequest): Promise<PpoActResponse> {
    return (await postJson(`${this.baseUrl}/act`, req, 10_000)) as PpoActResponse;
  }

  async train(body: PpoTrainRequest): Promise<PpoTrainResponse> {
    return (await postJson(`${this.baseUrl}/train`, body, 60_000)) as PpoTrainResponse;
  }

  async listSnapshots(): Promise<SnapshotInfo[]> {
    const j = (await getJson(`${this.baseUrl}/snapshot/list`, 10_000)) as SnapshotListResponse;
    return Array.isArray(j?.snapshots) ? j.snapshots : [];
  }

  async saveSnapshot(tag?: string): Promise<string> {
    const j = (await postJson(`${this.baseUrl}/snapshot/save`, { tag: tag ?? '' }, 10_000)) as SnapshotSaveResponse;
    return String(j?.id ?? '').trim();
  }

  async loadSnapshot(id: string): Promise<boolean> {
    const j = (await postJson(`${this.baseUrl}/snapshot/load`, { id }, 10_000)) as SnapshotLoadResponse;
    return !!j?.ok;
  }
}
