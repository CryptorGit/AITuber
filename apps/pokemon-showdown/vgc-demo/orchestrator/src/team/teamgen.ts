import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as TeamsMod from '../../../../../../tools/pokemon-showdown/pokemon-showdown/sim/teams';

const Teams: any = (TeamsMod as any).default?.Teams ?? (TeamsMod as any).Teams ?? (TeamsMod as any).default;
type PokemonSet = any;

type SpeciesPool = { format: string; species: string[] };
type TeamGenRules = { team_size: number; battle_size: number; resample_limit: number };

export type TeamGenData = {
  speciesPool: SpeciesPool;
  setsMin: Record<string, PokemonSet[]>;
  rules: TeamGenRules;
};

type PoolConfigV1 = {
  version: 1;
  updated_at?: string;
  team6?: string[];
  pool: Array<{ id: string; species: string; setText?: string }>;
};

function repoRoot(): string {
  // apps/pokemon-showdown/vgc-demo/orchestrator/src/team/teamgen.ts -> repo root
  const here = fileURLToPath(new URL('.', import.meta.url));
  return join(here, '../../../../../..');
}

export function loadTeamGenData(): TeamGenData {
  const root = repoRoot();
  const base = join(root, 'data/pokemon-showdown/vgc-demo');
  const speciesPool = JSON.parse(readFileSync(join(base, 'species_pool.json'), 'utf8')) as SpeciesPool;
  const setsMin = JSON.parse(readFileSync(join(base, 'sets_min.json'), 'utf8')) as Record<string, PokemonSet[]>;
  const rules = JSON.parse(readFileSync(join(base, 'teamgen_rules.json'), 'utf8')) as TeamGenRules;
  return { speciesPool, setsMin, rules };
}

function loadPoolConfig(): PoolConfigV1 | null {
  const root = repoRoot();
  const poolPath = join(root, 'config/pokemon-showdown/vgc-demo/pool.json');
  try {
    const cfg = JSON.parse(readFileSync(poolPath, 'utf8')) as PoolConfigV1;
    if (!cfg || cfg.version !== 1 || !Array.isArray(cfg.pool)) return null;
    return cfg;
  } catch {
    return null;
  }
}

function lcg(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function parsePoolEntrySet(entry: { id: string; species: string; setText?: string }): PokemonSet {
  const text = String(entry.setText ?? '').trim();
  if (text) {
    const sets = Teams.import(text);
    if (sets && Array.isArray(sets) && sets.length) {
      const set = sets[0] as PokemonSet;
      if (!String(set.species ?? '').trim()) {
        set.species = String(entry.species ?? '').trim();
      }
      return set;
    }
  }
  const species = String(entry.species ?? '').trim();
  if (!species) {
    throw new Error(`Pool entry ${String(entry.id ?? '')} is missing species and setText`);
  }
  return { species, name: '', item: '', ability: '', gender: '', nature: '', evs: {}, ivs: {}, level: 100, moves: [] };
}

export function tryGeneratePackedTeamFromPool(
  seed: number,
  opts: { mode: 'team6' | 'random' }
): { packed: string; team: PokemonSet[]; entryIds: string[] } | null {
  const cfg = loadPoolConfig();
  if (!cfg) return null;
  const pool = (cfg.pool ?? []).map((p) => ({
    id: String((p as any).id ?? '').trim(),
    species: String((p as any).species ?? '').trim(),
    setText: typeof (p as any).setText === 'string' ? (p as any).setText : '',
  })).filter((p) => p.id);

  if (pool.length < 6) return null;

  let chosen: Array<{ id: string; species: string; setText?: string }> = [];
  if (opts.mode === 'team6') {
    const want = Array.isArray(cfg.team6) ? cfg.team6.map((id) => String(id ?? '').trim()).filter(Boolean) : [];
    const byId = new Map(pool.map((p) => [p.id, p] as const));
    const picked = want.map((id) => byId.get(id)).filter(Boolean) as typeof pool;
    const fallback = pool.slice(0, 6);
    chosen = (picked.length === 6 ? picked : fallback).slice(0, 6);
  } else {
    const rng = lcg(seed);
    const pickedIds = new Set<string>();
    let attempts = 0;
    while (chosen.length < 6 && attempts < 5000) {
      attempts++;
      const p = pool[Math.floor(rng() * pool.length)];
      if (!p) continue;
      if (pickedIds.has(p.id)) continue;
      try {
        // Ensure parsable before committing.
        void parsePoolEntrySet(p);
      } catch {
        continue;
      }
      pickedIds.add(p.id);
      chosen.push(p);
    }
    if (chosen.length < 6) return null;
  }

  const team = chosen.map(parsePoolEntrySet);
  const packed = Teams.pack(team);
  return { packed, team, entryIds: chosen.map((p) => p.id) };
}

function sample<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

export function generatePackedTeam(data: TeamGenData, seed: number): { packed: string; team: PokemonSet[] } {
  const rng = lcg(seed);

  const { team_size, resample_limit } = data.rules;
  const picked: PokemonSet[] = [];

  for (let attempts = 0; attempts < resample_limit && picked.length < team_size; attempts++) {
    const sp = sample(data.speciesPool.species, rng);
    const sets = data.setsMin[sp];
    if (!sets || sets.length === 0) continue;
    if (picked.some((p) => (p.species ?? '').toLowerCase() === sp.toLowerCase())) continue;
    picked.push(sample(sets, rng));
  }

  if (picked.length < team_size) {
    throw new Error(`Failed to generate team of size ${team_size} from sets_min.json`);
  }

  const packed = Teams.pack(picked);
  return { packed, team: picked };
}

export function select4FromTeam(team: PokemonSet[], select4: number[]): PokemonSet[] {
  const out: PokemonSet[] = [];
  for (const idx of select4) {
    const p = team[idx];
    if (p) out.push(p);
  }
  if (out.length !== 4) {
    throw new Error(`select4 invalid; expected 4 got ${out.length}`);
  }
  return out;
}
