export type ReplayListItem = {
  battle_id: string;
  run_id: string | null;
  format: string | null;
  winner: string | null;
  turns: number | null;
  seed: number | null;
  opponent_id: string | null;
  opponent_type: string | null;
  error_rate: number | null;
  timestamp: string | null;
  train_dir: string;
};

export type DexListItem = {
  id: string;
  name: string;
  icon_url?: string;
  icon?: { kind: 'sheet'; url: string; size: number; x: number; y: number };
};

export type DexListResponse = {
  items: DexListItem[];
};

export type DexMoveDetail = {
  id: string;
  name: string;
  type: string;
  category?: string;
  basePower: number;
  accuracy: number; // 0 means "--" (always hits)
  pp: number;
  desc: string;
};

export type DexMoveSearchResponse = {
  items: DexMoveDetail[];
};

export type SpeciesDetail = {
  id: string;
  name: string;
  types: string[];
  baseStats: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
  abilities: string[];
  icon_url?: string;
};

export async function apiGet<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return (await r.json()) as T;
}

export async function apiPut<T>(url: string, body: any): Promise<T> {
  const r = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`${r.status} ${r.statusText}: ${t}`);
  }
  return (await r.json()) as T;
}

export async function apiPost<T>(url: string, body: any): Promise<T> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`${r.status} ${r.statusText}: ${t}`);
  }
  return (await r.json()) as T;
}

export type DexListQuery = { q?: string; only?: string };

export async function apiDexList(
  kind: 'species' | 'items' | 'moves' | 'abilities' | 'natures' | 'formats' | 'types',
  qOrOpts?: string | DexListQuery,
  onlyMaybe?: string,
) {
  const q = typeof qOrOpts === 'string' ? qOrOpts : qOrOpts?.q;
  const only = typeof qOrOpts === 'string' ? onlyMaybe : qOrOpts?.only;
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (only) params.set('only', only);
  // Keep payloads reasonable; UI does client-side filtering on the fetched set.
  params.set(
    'limit',
    kind === 'species' ? '2000' :
    kind === 'items' ? '2000' :
    kind === 'moves' ? '4000' :
    kind === 'formats' ? '1200' :
    kind === 'types' ? '50' :
    '2000'
  );
  return apiGet<DexListResponse>(`/api/dex/${kind}?${params.toString()}`);
}

export async function apiSpeciesDetail(idOrName: string) {
  return apiGet<SpeciesDetail>(`/api/dex/species/${encodeURIComponent(idOrName)}`);
}

export async function apiMoveSearch(q: string, limit = 120) {
  const params = new URLSearchParams();
  params.set('q', q);
  params.set('detail', '1');
  params.set('limit', String(limit));
  return apiGet<DexMoveSearchResponse>(`/api/dex/moves?${params.toString()}`);
}
