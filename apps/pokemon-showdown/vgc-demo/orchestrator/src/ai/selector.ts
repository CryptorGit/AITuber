import * as TeamsMod from '../../../../../../tools/pokemon-showdown/pokemon-showdown/sim/teams';
import { stableArgMax } from './rng';

const Teams: any = (TeamsMod as any).default?.Teams ?? (TeamsMod as any).Teams ?? (TeamsMod as any).default;

export type SelectorResult = {
  // 0-based indices into the original team6 list
  select4: [number, number, number, number];
  // Desired ordered team4 layout: leads first two, then back two.
  ordered4: [number, number, number, number];
  debug: {
    scores: Array<{ idx: number; name: string; total: number; lead: number; support: number; offense: number }>;
  };
};

function normId(x: unknown): string {
  return String(x ?? '')
    .trim()
    .toLowerCase();
}

function unpackTeamPacked(teamPacked: string): any[] {
  // Returns array of sets (species, moves, ability, item...)
  // Teams.unpack exists in PS sim.
  try {
    const sets = Teams.unpack(teamPacked);
    return Array.isArray(sets) ? sets : [];
  } catch {
    return [];
  }
}

function scoreSetForVgc(set: any): { total: number; lead: number; support: number; offense: number } {
  const moves: string[] = Array.isArray(set?.moves) ? set.moves.map(normId) : [];
  const ability = normId(set?.ability);
  const item = normId(set?.item);
  const species = normId(set?.species);

  let support = 0;
  let offense = 0;
  let lead = 0;

  // Simple VGC-ish tags from moves/ability.
  const has = (m: string) => moves.includes(m);

  // Support
  if (has('tailwind')) support += 3;
  if (has('icywind')) support += 2;
  if (has('electroweb')) support += 2;
  if (has('snarl')) support += 2;
  if (has('helpinghand')) support += 2;
  if (has('spore')) support += 4;
  if (has('ragepowder') || has('followme')) support += 4;
  if (has('wideguard') || has('quickguard')) support += 2;
  if (has('protect') || has('detect') || has('spikyshield') || has('kingsshield')) support += 1;

  // Offense (very rough)
  const spreadMoves = new Set(['rockslide', 'icywind', 'makeitrain', 'bleakwindstorm', 'dazzlinggleam', 'heatwave']);
  for (const m of moves) {
    if (spreadMoves.has(m)) offense += 2;
  }
  if (has('closecombat') || has('wickedblow') || has('surgingstrikes')) offense += 2;
  if (has('swordsdance') || has('nastyplot')) offense += 1;

  // Lead heuristics
  if (has('fakeout')) lead += 4;
  if (has('tailwind')) lead += 2;
  if (has('ragepowder') || has('followme')) lead += 2;
  if (ability === 'intimidate') lead += 2;

  // Species nudges for the demo pool (keeps it deterministic, not “smart”).
  if (species.includes('incineroar')) support += 2;
  if (species.includes('amoonguss')) support += 2;
  if (species.includes('tornadus')) lead += 1;

  // Item nudges
  if (item === 'sitrusberry') support += 1;
  if (item === 'assaultvest') offense += 1;

  const total = support + offense;
  return { total, lead, support, offense };
}

export function select4Local(team6Packed: string): SelectorResult {
  const sets = unpackTeamPacked(team6Packed);

  const scored = sets.map((set, idx) => {
    const s = scoreSetForVgc(set);
    return {
      idx,
      name: String(set?.species ?? `slot${idx + 1}`),
      ...s,
    };
  });

  // Pick best 4 by total score (stable tie-break by index).
  const sortedByTotal = [...scored].sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    return a.idx - b.idx;
  });

  const top4 = sortedByTotal.slice(0, 4).map((x) => x.idx);
  while (top4.length < 4) top4.push(top4.length);

  // Choose leads among selected4 by lead score.
  const selectedScored = scored.filter((s) => top4.includes(s.idx));
  const lead1 = stableArgMax(selectedScored, (s) => s.lead).item.idx;

  const remainingForLead2 = selectedScored.filter((s) => s.idx !== lead1);
  const lead2 = remainingForLead2.length ? stableArgMax(remainingForLead2, (s) => s.lead).item.idx : lead1;

  const backs = top4.filter((i) => i !== lead1 && i !== lead2);
  while (backs.length < 2) backs.push(top4[backs.length] ?? 0);

  const ordered4: [number, number, number, number] = [lead1, lead2, backs[0], backs[1]];
  const select4: [number, number, number, number] = [top4[0], top4[1], top4[2], top4[3]];

  return {
    select4,
    ordered4,
    debug: { scores: scored },
  };
}
