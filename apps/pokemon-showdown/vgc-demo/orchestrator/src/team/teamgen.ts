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

function sample<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

export function generatePackedTeam(data: TeamGenData, seed: number): { packed: string; team: PokemonSet[] } {
  // simple LCG RNG
  let state = (seed >>> 0) || 1;
  const rng = () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xffffffff;
  };

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
