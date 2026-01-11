import { makeRng } from './rng';

export type LocalPolicyDebug = {
  mode: 'teamPreview' | 'forceSwitch' | 'regular';
  candidates?: any;
  picked?: any;
};

function parseHpFraction(condition: unknown): number {
  const s = String(condition ?? '').trim();
  if (!s) return 1;
  if (s === '0 fnt' || s === '0fnt') return 0;
  const first = s.split(' ')[0];
  const m = /^(\d+)\/(\d+)$/.exec(first);
  if (!m) return 1;
  const cur = Number(m[1]);
  const max = Number(m[2]);
  if (!Number.isFinite(cur) || !Number.isFinite(max) || max <= 0) return 1;
  return Math.max(0, Math.min(1, cur / max));
}

function isAllyTargetType(target: string | undefined): boolean {
  const t = String(target ?? '');
  return t === 'adjacentAlly' || t === 'ally' || t === 'adjacentAllyOrSelf';
}

function moveTargetArg(target: string | undefined, activeIndex: number, hasPartner: boolean): string {
  if (!target) return '';
  const t = String(target);
  // Common single-target foe moves.
  if (t === 'normal' || t === 'adjacentFoe' || t === 'any' || t === 'anyAdjacentFoe' || t === 'randomNormal') return ' 1';
  // Ally-targeting support moves (e.g. Helping Hand). In doubles, target indices are
  // position-dependent: left active targets partner with -1, right active with -2.
  if (t === 'adjacentAlly' || t === 'ally' || t === 'adjacentAllyOrSelf') {
    if (!hasPartner) return '';
    // Targets are absolute side positions: -1 is left ally slot, -2 is right ally slot.
    // So to target your partner, you need the *other* slot.
    return activeIndex === 0 ? ' -2' : ' -1';
  }
  return '';
}

function isNoTargetMoveId(id: string): boolean {
  const m = id.toLowerCase();
  return (
    m === 'protect' ||
    m === 'detect' ||
    m === 'spikyshield' ||
    m === 'kingsshield' ||
    m === 'banefulbunker' ||
    m === 'silktrap' ||
    m === 'obstruct' ||
    m === 'endure' ||
    m === 'wideguard' ||
    m === 'quickguard' ||
    m === 'craftyshield' ||
    m === 'matblock' ||
    m === 'tailwind' ||
    m === 'followme' ||
    m === 'ragepowder'
  );
}

function scoreMove(id: string, turn: number, hpFrac: number): number {
  const m = id.toLowerCase();
  let s = 0;

  // High-value support
  if (m === 'fakeout') s += turn <= 1 ? 100 : 5;
  if (m === 'spore') s += 80;
  if (m === 'ragepowder' || m === 'followme') s += 70;
  if (m === 'tailwind') s += turn <= 2 ? 60 : 20;

  // Defensive
  if (m === 'protect' || m === 'detect' || m === 'spikyshield' || m === 'kingsshield') {
    s += hpFrac < 0.35 ? 65 : 5;
  }

  // Spread-ish / tempo
  if (m === 'icywind') s += 45;
  if (m === 'rockslide') s += 40;
  if (m === 'makeitrain') s += 45;
  if (m === 'bleakwindstorm') s += 40;

  // Generic damaging moves (fallback)
  if (s === 0) s = 10;

  return s;
}

function legalSwitchSlots(req: any): number[] {
  const side = req?.side ?? {};
  const pokemon = Array.isArray(side?.pokemon) ? side.pokemon : [];
  const out: number[] = [];
  for (let i = 0; i < pokemon.length; i++) {
    const p = pokemon[i];
    const active = !!p?.active;
    const fainted = !!p?.fainted;
    const cond = String(p?.condition ?? '');
    const isFnt = cond === '0 fnt' || cond === '0fnt' || cond.endsWith(' fnt');
    if (!active && !fainted && !isFnt) out.push(i + 1);
  }
  return out;
}

function activeHpFractions(req: any): number[] {
  const side = req?.side ?? {};
  const pokemon = Array.isArray(side?.pokemon) ? side.pokemon : [];
  const actives = pokemon.filter((p: any) => p && p.active);
  return actives.map((p: any) => parseHpFraction(p?.condition));
}

type MoveCand = { slot: number; id: string; target?: string; disabled: boolean };

function legalMoveCandidatesForActive(activeReq: any): MoveCand[] {
  const moves = Array.isArray(activeReq?.moves) ? activeReq.moves : [];
  return moves.map((m: any, idx: number) => ({
    slot: idx + 1,
    id: String(m?.id ?? ''),
    target: m?.target,
    disabled: !!m?.disabled,
  }));
}

export function chooseLocal(req: any, seed: number, turn: number): { choice: string; debug: LocalPolicyDebug } {
  const rng = makeRng(seed);

  // Team preview: keep team order as-is (leads are first 2 in packed team order).
  if (req?.teamPreview) {
    const n = Array.isArray(req?.side?.pokemon) ? req.side.pokemon.length : 0;
    const order = Array.from({ length: n }, (_, i) => i + 1).join('');
    return { choice: `team ${order}`, debug: { mode: 'teamPreview', picked: { order } } };
  }

  // Forced switch phase
  if (Array.isArray(req?.forceSwitch)) {
    const forced = req.forceSwitch as boolean[];
    const sw = legalSwitchSlots(req);
    const available = [...sw];
    const parts: string[] = [];
    for (let i = 0; i < forced.length; i++) {
      if (!forced[i]) continue;
      if (available.length > 0) {
        const j = rng.nextIntExclusive(available.length);
        const slot = available.splice(j, 1)[0];
        parts.push(`switch ${slot}`);
      } else {
        parts.push('pass');
      }
    }
    return { choice: parts.join(', '), debug: { mode: 'forceSwitch', picked: { parts } } };
  }

  const activesReq = Array.isArray(req?.active) ? req.active.filter((a: any) => a && typeof a === 'object') : [];
  const hpFracs = activeHpFractions(req);

  // In doubles, the request can still include two entries even if only one active is alive.
  // Showdown will reject receiving 2 choice parts when only 1 Pokémon can act.
  const sideMons = Array.isArray(req?.side?.pokemon) ? (req.side.pokemon as any[]) : [];
  const aliveActiveCount = sideMons.filter((p: any) => {
    if (!p?.active) return false;
    if (p?.fainted) return false;
    const cond = String(p?.condition ?? '');
    if (cond === '0 fnt' || cond === '0fnt') return false;
    if (cond.endsWith(' fnt')) return false;
    return true;
  }).length;

  const hasPartner = aliveActiveCount >= 2;

  const choices: string[] = [];
  const picked: any[] = [];

  // In doubles, request may include only one actionable active.
  const actionable = activesReq.filter((a: any) => Array.isArray(a?.moves) && a.moves.length > 0);
  const activesToChoose = actionable.length ? actionable : activesReq;

  const expectedChoices = aliveActiveCount > 0 ? aliveActiveCount : activesToChoose.length;

  for (let i = 0; i < activesToChoose.length; i++) {
    const a = activesToChoose[i];
    const hp = hpFracs[i] ?? 1;

    const moveCands = legalMoveCandidatesForActive(a).filter((m) => !m.disabled && m.id && (hasPartner || !isAllyTargetType(m.target)));

    // Prefer moves; switch only if no moves.
    if (moveCands.length > 0) {
      const scored = moveCands
        .map((m) => {
          const sc = scoreMove(m.id, turn, hp);
          return { ...m, score: sc };
        })
        .sort((x, y) => {
          if (y.score !== x.score) return y.score - x.score;
          return x.slot - y.slot;
        });

      const best = scored[0];
      const needsTarget = !!best.target && !isNoTargetMoveId(best.id);
      const targetArg = needsTarget ? moveTargetArg(best.target, i, hasPartner) : '';
      choices.push(`move ${best.slot}${targetArg}`.trim());
      picked.push({ kind: 'move', best });
      continue;
    }

    const sw = legalSwitchSlots(req);
    if (sw.length > 0) {
      const slot = sw[rng.nextIntExclusive(sw.length)];
      choices.push(`switch ${slot}`);
      picked.push({ kind: 'switch', slot });
      continue;
    }

    choices.push('default');
    picked.push({ kind: 'default' });

    if (choices.length >= expectedChoices) break;
  }

  while (choices.length > expectedChoices) {
    choices.pop();
    picked.pop();
  }

  const choice = choices.join(', ');
  return {
    choice,
    debug: {
      mode: 'regular',
      candidates: { actives: activesToChoose.length },
      picked,
    },
  };
}
