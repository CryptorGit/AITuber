import * as BattleStreamMod from '../../../../../../tools/pokemon-showdown/pokemon-showdown/sim/battle-stream';
import type { ChoiceRequest } from '../../../../../../tools/pokemon-showdown/pokemon-showdown/sim/side';

import { appendJsonl } from '../io/jsonl';
import { chooseLocal, type LocalPolicyDebug } from '../ai/battle_policy';
import type { PpoBattleCoordinator } from '../ppo/ppo_battle_coordinator';

const DEBUG = process.env.VGC_DEMO_DEBUG === '1';

type DebugCtx = {
  logPath: string;
  runId: string;
  battleId: string;
};

function summarizeRequest(req: any) {
  const forced = Array.isArray(req?.forceSwitch) ? req.forceSwitch.filter(Boolean).length : 0;
  const active = Array.isArray(req?.active) ? req.active : [];

  const activeSummary = active
    .filter((a: any) => a && typeof a === 'object')
    .slice(0, 2)
    .map((a: any) => {
      const moves = Array.isArray(a?.moves) ? a.moves : [];
      return {
        canDynamax: !!a?.canDynamax,
        moves: moves.slice(0, 4).map((m: any) => ({
          id: String(m?.id ?? ''),
          target: m?.target,
          disabled: !!m?.disabled,
        })),
      };
    });

  return {
    teamPreview: !!req?.teamPreview,
    wait: !!req?.wait,
    forceSwitchCount: forced,
    canSwitch: !!req?.canSwitch,
    activeCount: active.length,
    active: activeSummary,
  };
}

function debugEmit(ctx: DebugCtx | undefined, evt: Record<string, unknown>) {
  if (!DEBUG || !ctx) return;
  appendJsonl(ctx.logPath, {
    t_ms: Date.now(),
    run_id: ctx.runId,
    battle_id: ctx.battleId,
    ...evt,
  });
}

export type BattleResult = {
  winner: string | null;
  turns: number;
  log: string[];
  ms: number;
  formatId: string;
  p1: { name: string; policy: string };
  p2: { name: string; policy: string };
  error?: string;
};

type PolicyMode = 'fallback' | 'python' | 'local' | 'ppo';

type PythonClient = {
  baseUrl: string;
  policy: 'random' | 'heuristic';
};

export type TraceDecisionEvent = {
  type: 'decision';
  player: 'p1' | 'p2';
  turn: number;
  request: any;
  legal: any;
  choice_raw: string;
  choice_norm: string;
  choice_source: 'python' | 'fallback' | 'python_error' | 'local' | 'ppo';
  policy_debug?: LocalPolicyDebug;
};

type TraceFn = (evt: TraceDecisionEvent) => void;

function extractLegal(req: any) {
  const side = req?.side ?? {};
  const pokemon = Array.isArray(side?.pokemon) ? side.pokemon : [];
  const switchSlots = pokemon
    .map((p: any, i: number) => ({
      slot: i + 1,
      active: !!p?.active,
      fainted: !!p?.fainted,
      condition: String(p?.condition ?? ''),
      ident: String(p?.ident ?? ''),
    }))
    .filter((p: any) => !p.active && !p.fainted && p.condition !== '0 fnt' && p.condition !== '0fnt');

  const active = Array.isArray(req?.active) ? req.active : [];
  const actives = active
    .map((a: any) => {
      const moves = Array.isArray(a?.moves) ? a.moves : [];
      return {
        moves: moves.map((m: any, idx: number) => ({
          slot: idx + 1,
          id: String(m?.id ?? ''),
          target: m?.target,
          disabled: !!m?.disabled,
        })),
      };
    })
    .slice(0, 2);

  return {
    teamPreview: !!req?.teamPreview,
    wait: !!req?.wait,
    forceSwitch: req?.forceSwitch,
    canSwitch: !!req?.canSwitch,
    switchSlots,
    actives,
  };
}

function splitFirst(str: string, delimiter: string, limit = 1) {
  const splitStr: string[] = [];
  while (splitStr.length < limit) {
    const delimiterIndex = str.indexOf(delimiter);
    if (delimiterIndex >= 0) {
      splitStr.push(str.slice(0, delimiterIndex));
      str = str.slice(delimiterIndex + delimiter.length);
    } else {
      splitStr.push(str);
      str = '';
    }
  }
  splitStr.push(str);
  return splitStr;
}

class OrchestratorPlayer {
  readonly name: string;
  readonly stream: any;
  readonly debugCtx?: DebugCtx;
  lastRequest: ChoiceRequest | null = null;
  latestTurn = 0;
  lastError: string | null = null;
  requestCount = 0;
  choiceCount = 0;
  lastChoice: string | null = null;
  lastRequestSummary: string | null = null;

  constructor(name: string, playerStream: any, debugCtx?: DebugCtx) {
    this.name = name;
    this.stream = playerStream;
    this.debugCtx = debugCtx;
  }

  async start() {
    for await (const chunk of this.stream) {
      this.receive(chunk);
    }
  }

  receive(chunk: string) {
    for (const line of chunk.split('\n')) {
      this.receiveLine(line);
    }
  }

  receiveLine(line: string) {
    if (!line.startsWith('|')) return;
    const [cmd, rest] = splitFirst(line.slice(1), '|');
    if (cmd === 'request') {
      try {
        this.lastRequest = JSON.parse(rest);
        this.requestCount++;
        const r: any = this.lastRequest;
        const fs = Array.isArray(r?.forceSwitch) ? r.forceSwitch.filter(Boolean).length : 0;
        const act = Array.isArray(r?.active) ? r.active.length : 0;
        this.lastRequestSummary = `teamPreview=${!!r?.teamPreview} wait=${!!r?.wait} forced=${fs} active=${act}`;
        if (DEBUG) {
          console.log(`[vgc-demo][${this.name}] got |request| ${this.lastRequestSummary}`);
        }
        debugEmit(this.debugCtx, {
          type: 'request',
          player: this.name,
          summary: summarizeRequest(r),
        });
      } catch {
        // ignore
      }
      return;
    }
    if (cmd === 'error') {
      this.lastError = rest;
      return;
    }
  }

  choose(choice: string) {
    this.choiceCount++;
    this.lastChoice = choice;
    // IMPORTANT: player streams prefix commands with ">p1 "/">p2 ".
    // Do NOT include a trailing newline here because getPlayerStreams() will
    // also prefix after each '\n', which can create an extra empty command.
    void this.stream.write(choice);
  }
}

function nowMs() {
  return Date.now();
}

function isAllyTargetType(target: string | undefined): boolean {
  const t = String(target ?? '');
  return t === 'adjacentAlly' || t === 'ally' || t === 'adjacentAllyOrSelf';
}

function moveTargetArg(target: string | undefined, activeIndex: number, hasPartner: boolean): string {
  // Default targets for common doubles single-target moves.
  // NOTE: only use this when the request target indicates target selection.
  if (!target) return '';
  const t = String(target);
  // Many single-target moves use these target types.
  // Some moves (e.g. Aura Sphere) may report broader target types like "any".
  // When we know a move requires a target, defaulting to the primary foe ("1")
  // is safer than emitting an invalid choice that can stall the battle.
  if (t === 'normal' || t === 'adjacentFoe' || t === 'any' || t === 'anyAdjacentFoe' || t === 'randomNormal') return ' 1';

  // Ally-targeting support moves (e.g. Helping Hand).
  // In doubles, targetLoc is negative for allies and positive for foes.
  // Self is -1 (left) / -2 (right). Partner is the opposite.
  if (t === 'adjacentAllyOrSelf') {
    // Prefer partner when available; otherwise self.
    if (hasPartner) return activeIndex === 0 ? ' -2' : ' -1';
    return activeIndex === 0 ? ' -1' : ' -2';
  }
  if (t === 'adjacentAlly' || t === 'ally') {
    if (!hasPartner) return '';
    return activeIndex === 0 ? ' -2' : ' -1';
  }

  // Unknown target types: pick a safe foe target.
  return ' 1';
}

function normalizeChoiceForRequest(choice: string, req: any): string {
  const raw = String(choice ?? '').trim();
  if (!raw) return raw;
  if (raw.startsWith('team ')) return raw;

  const parts = raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return raw;

  const allActives = (req?.active ?? []).filter((a: any) => a && typeof a === 'object');
  if (allActives.length === 0) return raw;
  // In doubles, when only one slot can act, Showdown expects only one choice.
  // Map choice parts to the *actionable* actives (those with moves).
  const actionableActives = allActives.filter((a: any) => Array.isArray(a?.moves) && a.moves.length > 0);
  let actives = actionableActives.length > 0 ? actionableActives : allActives;

  const sideMons = Array.isArray(req?.side?.pokemon) ? (req.side.pokemon as any[]) : [];
  const activesFromSide = sideMons.filter((p) => p && typeof p === 'object' && p.active);
  const aliveActivesFromSide = activesFromSide.filter((p) => {
    if (p?.fainted) return false;
    const cond = String(p?.condition ?? '');
    if (cond === '0 fnt' || cond === '0fnt') return false;
    return true;
  });
  const hasPartner = aliveActivesFromSide.length >= 2;

  const forceNeedsTargetMoveIds = new Set<string>([
    'aurasphere',
    'shadowball',
    'darkpulse',
    'thunderbolt',
    'icebeam',
    'flamethrower',
    'energyball',
  ]);

  const pickFirstLegalMovePart = (active: any, activeIndex: number): string | null => {
    const moves = Array.isArray(active?.moves) ? active.moves : [];
    for (let j = 0; j < moves.length; j++) {
      const m = moves[j];
      if (!m || typeof m !== 'object') continue;
      if (m.disabled) continue;
      const targetType = m?.target as string | undefined;
      // Avoid ally-only targets when there is no partner alive.
      if (!hasPartner && (targetType === 'adjacentAlly' || targetType === 'ally')) continue;

      const slot = j + 1;
      const id = String(m?.id ?? '').toLowerCase();
      if (!targetType) {
        if (forceNeedsTargetMoveIds.has(id)) return `move ${slot} 1`;
        return `move ${slot}`;
      }
      const arg = moveTargetArg(targetType, activeIndex, hasPartner);
      const needsTarget =
        targetType === 'normal' ||
        targetType === 'adjacentFoe' ||
        targetType === 'any' ||
        targetType === 'anyAdjacentFoe' ||
        targetType === 'randomNormal' ||
        targetType === 'adjacentAlly' ||
        targetType === 'ally' ||
        targetType === 'adjacentAllyOrSelf';
      if (needsTarget) {
        if (arg) return `move ${slot}${arg}`;
        // No valid target available for this move.
        continue;
      }
      return `move ${slot}`;
    }
    return null;
  };

  // Special case: only one choice part in doubles.
  // If only one active is actually alive, use that position's request entry.
  if (parts.length === 1 && allActives.length === 2) {
    if (activesFromSide.length === 2 && aliveActivesFromSide.length === 1) {
      const aliveIndex = activesFromSide.indexOf(aliveActivesFromSide[0]);
      if (aliveIndex === 0 || aliveIndex === 1) {
        actives = [allActives[aliveIndex]];
      }
    }
  }

  const normalized: string[] = [];
  let debugNormalized = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const active = actives[i];
    if (!active || typeof active !== 'object') {
      normalized.push(part);
      continue;
    }
    if (!part.startsWith('move ')) {
      normalized.push(part);
      continue;
    }

    // Accept: "move <slot>" or "move <slot> <target>".
    const m = /^move\s+(\d+)(?:\s+(-?\d+))?\s*$/i.exec(part);
    if (!m) {
      normalized.push(part);
      continue;
    }
    const moveSlot = Number(m[1]);
    const hadTarget = typeof m[2] === 'string' && m[2].length > 0;
    const moveObj = Array.isArray(active?.moves) ? active.moves[moveSlot - 1] : null;
    const targetType = moveObj?.target as string | undefined;
    const actualActiveIndex = allActives.length === 2 ? Math.max(0, allActives.indexOf(active)) : 0;
    const moveId = String(moveObj?.id ?? '').toLowerCase();
    const moveName = String(moveObj?.move ?? '').toLowerCase();

    // Hard guarantee: never emit a disabled move.
    if (moveObj?.disabled) {
      const repl = pickFirstLegalMovePart(active, actualActiveIndex);
      normalized.push(repl ?? 'default');
      continue;
    }

    // Some request payloads have unreliable `target` metadata for a subset of moves.
    // Patch up obvious no-target moves using only request-visible identifiers.
    const neverTargetMoveIds = new Set<string>([
      // Protect family
      'protect',
      'detect',
      'spikyshield',
      'kingsshield',
      'banefulbunker',
      'silktrap',
      'obstruct',
      'endure',
      // Guards
      'wideguard',
      'quickguard',
      'craftyshield',
      'matblock',
      // Common VGC spread / no-target moves in our demo set pool
      'rockslide',
      'icywind',
      'makeitrain',
      'bleakwindstorm',
      // Redirection
      'followme',
      'ragepowder',
      // Side / self setup
      'tailwind',
      'nastyplot',
    ]);
    const forceNoTarget =
      neverTargetMoveIds.has(moveId) ||
      moveName === 'protect' ||
      moveName === 'spiky shield' ||
      moveName === 'rock slide' ||
      moveName === 'icy wind' ||
      moveName === 'make it rain' ||
      moveName === 'bleakwind storm' ||
      moveName === 'follow me' ||
      moveName === 'rage powder' ||
      moveName === 'tailwind' ||
      moveName === 'nasty plot';

    // Some single-target moves occasionally arrive without target metadata.
    // If the user doesn't provide an explicit target, default it.
    const forceNeedsTarget = forceNeedsTargetMoveIds.has(moveId);

    if (DEBUG && debugNormalized < 6 && hadTarget && (moveSlot === 3 || moveSlot === 4)) {
      debugNormalized++;
      console.log(
        `[vgc-demo][normalize] part="${part}" slot=${moveSlot} id="${moveId}" name="${moveName}" targetType="${String(
          targetType ?? ''
        )}" forceNoTarget=${forceNoTarget}`
      );
    }

    // If we already have a target arg but the move is obviously no-target, strip it
    // even if `targetType` is missing/unreliable.
    if (forceNoTarget && hadTarget) {
      normalized.push(`move ${moveSlot}`);
      continue;
    }

    if (!targetType) {
      // Some moves arrive without reliable target metadata even though Showdown
      // requires an explicit target (e.g. Aura Sphere in doubles).
      // If the move is not in our known no-target list and a target wasn't
      // provided, default to the primary foe ("1"). This is safer than emitting
      // an invalid choice that can stall the battle.
      if ((!forceNoTarget && forceNeedsTarget && !hadTarget) || (!forceNoTarget && !hadTarget && part.startsWith('move '))) {
        normalized.push(`move ${moveSlot} 1`);
        continue;
      }
      normalized.push(part);
      continue;
    }

    // Repair ally-targeting moves so we don't emit invalid target choices.
    // This is especially important for external policies that might keep
    // choosing Helping Hand even after the partner faints.
    if (isAllyTargetType(targetType)) {
      // adjacentAlly/ally requires a living partner.
      if ((targetType === 'adjacentAlly' || targetType === 'ally') && !hasPartner) {
        const repl = pickFirstLegalMovePart(active, actualActiveIndex);
        normalized.push(repl ?? 'default');
        continue;
      }
      // Otherwise, force a valid ally/self target.
      const arg = moveTargetArg(targetType, actualActiveIndex, hasPartner);
      if (arg) {
        normalized.push(`move ${moveSlot}${arg}`);
        continue;
      }
      const repl = pickFirstLegalMovePart(active, actualActiveIndex);
      normalized.push(repl ?? 'default');
      continue;
    }

    const needsTarget =
      !forceNoTarget &&
      (forceNeedsTarget ||
        targetType === 'normal' ||
        targetType === 'adjacentFoe' ||
        targetType === 'any' ||
        targetType === 'anyAdjacentFoe' ||
        targetType === 'randomNormal' ||
        targetType === 'adjacentAlly' ||
        targetType === 'ally' ||
        targetType === 'adjacentAllyOrSelf');

    if (needsTarget && !hadTarget) {
      normalized.push(`move ${moveSlot}${moveTargetArg(targetType, actualActiveIndex, hasPartner)}`);
      continue;
    }
    if (!needsTarget && hadTarget) {
      normalized.push(`move ${moveSlot}`);
      continue;
    }

    normalized.push(part);
  }

  return normalized.join(', ');
}

async function postJson(url: string, body: any, timeoutMs = 1500): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function pickRandomChoiceFromRequest(req: any, seed: number): string {
  // Minimal fallback: "default" usually works, but we try to pick a legal move slot.
  let state = (seed >>> 0) || 1;
  const rng = () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xffffffff;
  };

  const active = (req?.active ?? []) as any[];
  const side = req?.side ?? {};

  const sideMons = (side?.pokemon ?? []) as any[];
  const aliveActiveCount = Array.isArray(sideMons)
    ? sideMons.filter((p: any) => {
        if (!p?.active) return false;
        if (p?.fainted) return false;
        const cond = String(p?.condition ?? '');
        if (cond === '0 fnt' || cond === '0fnt') return false;
        return true;
      }).length
    : 0;
  const hasPartner = aliveActiveCount >= 2;

  // Team preview: pick an order for the visible team (first two are leads in doubles).
  if (req?.teamPreview) {
    const n = Array.isArray(side?.pokemon) ? side.pokemon.length : 0;
    const order = Array.from({ length: n }, (_, i) => i + 1);
    // Fisher–Yates shuffle using our tiny RNG
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = order[i];
      order[i] = order[j];
      order[j] = tmp;
    }
    return `team ${order.join('')}`;
  }
  const canSwitch = !!req?.canSwitch || !!req?.forceSwitch;
  const pokemon = (side?.pokemon ?? []) as any[];
  const switchSlots = pokemon
    .map((p, i) => ({ p, slot: i + 1 }))
    .filter((x) => !x.p?.active && !x.p?.fainted && x.p?.condition !== '0 fnt');

  const pickForActive = (a: any, activeIndex: number) => {
    const moves = (a?.moves ?? [])
      .map((m: any, i: number) => ({ ...m, __slot: i + 1 }))
      .filter((m: any) => !m?.disabled)
      .filter((m: any) => (hasPartner ? true : !isAllyTargetType(m?.target)));
    if (moves.length > 0) {
      const m = moves[Math.floor(rng() * moves.length)];
      const moveSlot = Number(m.__slot);
      return `move ${moveSlot}${moveTargetArg(m?.target, activeIndex, hasPartner)}`;
    }
    if (canSwitch && switchSlots.length > 0) {
      const s = switchSlots[Math.floor(rng() * switchSlots.length)];
      return `switch ${s.slot}`;
    }
    return 'default';
  };

  // Forced switch phase (no "active" field; forceSwitch is an array).
  // We must provide one choice per active slot that needs switching.
  if (Array.isArray(req?.forceSwitch)) {
    const forced = req.forceSwitch as boolean[];
    const available = [...switchSlots];
    const choices: string[] = [];
    for (let i = 0; i < forced.length; i++) {
      if (!forced[i]) continue;
      if (canSwitch && available.length > 0) {
        const idx = Math.floor(rng() * available.length);
        const s = available.splice(idx, 1)[0];
        choices.push(`switch ${s.slot}`);
      } else {
        choices.push('pass');
      }
    }
    if (choices.length > 0) return choices.join(', ');
  }

  if (active.length <= 1) {
    return pickForActive(active[0], 0);
  }

  // In doubles, the request may include null/empty entries for slots that can't act.
  // If we send a choice for those, the sim can reject it as "more choices than unfainted Pokémon".
  const activeCountFromSide = Array.isArray(side?.pokemon)
    ? side.pokemon.filter((p: any) => {
        if (!p?.active) return false;
        if (p?.fainted) return false;
        const cond = String(p?.condition ?? '');
        if (cond === '0 fnt' || cond === '0fnt') return false;
        return true;
      }).length
    : 0;
  const expectedChoices = activeCountFromSide > 0 ? activeCountFromSide : active.length;

  const choices: string[] = [];
  for (let i = 0; i < active.length; i++) {
    const a = active[i];
    if (!a) continue;
    choices.push(pickForActive(a, i));
    if (choices.length >= expectedChoices) break;
  }

  // If we still don't have enough, fill with defaults to keep the sim moving.
  while (choices.length < expectedChoices) choices.push('default');

  return choices.length ? choices.join(', ') : 'default';
}

function isInvalidChoiceError(err: string | null | undefined): boolean {
  if (!err) return false;
  const s = String(err);
  return s.includes('[Invalid choice]') || s.includes('[Unavailable choice]');
}

function choiceLooksDisabledInRequest(choice: string, req: any): boolean {
  const raw = String(choice ?? '').trim();
  if (!raw || raw.startsWith('team ')) return false;

  const parts = raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return false;

  const allActives = (req?.active ?? []).filter((a: any) => a && typeof a === 'object');
  if (allActives.length === 0) return false;
  const actionableActives = allActives.filter((a: any) => Array.isArray(a?.moves) && a.moves.length > 0);
  const actives = actionableActives.length > 0 ? actionableActives : allActives;

  for (let i = 0; i < parts.length && i < actives.length; i++) {
    const part = parts[i];
    if (!part.startsWith('move ')) continue;
    const m = /^move\s+(\d+)/i.exec(part);
    if (!m) continue;
    const moveSlot = Number(m[1]);
    const active = actives[i];
    const moveObj = Array.isArray(active?.moves) ? active.moves[moveSlot - 1] : null;
    if (!moveObj) continue;
    if (moveObj?.disabled) return true;
  }
  return false;
}

export async function runOneBattle(opts: {
  formatId: string;
  seed: number;
  p1: { name: string; team: string; policyMode: PolicyMode; python?: PythonClient; teamPreviewChoice?: string };
  p2: { name: string; team: string; policyMode: PolicyMode; python?: PythonClient; teamPreviewChoice?: string };
  ppo?: PpoBattleCoordinator;
  debug?: DebugCtx;
  trace?: TraceFn;
}): Promise<BattleResult> {
  const started = nowMs();
  const debug = process.env.VGC_DEMO_DEBUG === '1';
  const BS: any = (BattleStreamMod as any).BattleStream ? (BattleStreamMod as any) : (BattleStreamMod as any).default;
  if (!BS?.BattleStream || !BS?.getPlayerStreams) {
    throw new Error('Failed to load Pokemon Showdown BattleStream exports');
  }

  const stream = new BS.BattleStream({ debug: false });
  const players = BS.getPlayerStreams(stream);

  const p1 = new OrchestratorPlayer('p1', players.p1, opts.debug);
  const p2 = new OrchestratorPlayer('p2', players.p2, opts.debug);

  const log: string[] = [];
  let winner: string | null = null;
  let ended = false;
  let turns = 0;

  // Read spectator logs to capture |win| and |turn|
  (async () => {
    for await (const chunk of players.spectator) {
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('|')) continue;
        log.push(line);
        try {
          opts.ppo?.ingestSpectatorLine(line);
        } catch {
          // ignore
        }
        const parts = line.split('|');
        if (parts[1] === 'turn') turns = Number(parts[2] ?? turns);
        if (parts[1] === 'win') {
          winner = parts[2] ?? null;
          ended = true;
        }
        if (parts[1] === 'tie') {
          winner = null;
          ended = true;
        }
      }
    }
    ended = true;
  })().catch(() => {});

  // Start player listeners
  void p1.start();
  void p2.start();

  // Start battle
  const startOptions = {
    formatid: opts.formatId,
    seed: `${opts.seed},${opts.seed + 1},${opts.seed + 2},${opts.seed + 3}`,
  };

  await stream.write(`>start ${JSON.stringify(startOptions)}\n`);
  await stream.write(`>player p1 ${JSON.stringify({ name: opts.p1.name, team: opts.p1.team })}\n`);
  await stream.write(`>player p2 ${JSON.stringify({ name: opts.p2.name, team: opts.p2.team })}\n`);

  debugEmit(opts.debug, {
    type: 'battle_start',
    format: opts.formatId,
    seed: opts.seed,
  });

  // Main loop: whenever a player has a request, send a choice.
  // Avoid setTimeout(1) polling: Windows timer resolution can turn this into ~15ms,
  // causing false 70s+ "timeouts". Use setImmediate + a wall-clock deadline instead.
  const deadlineMs = started + 30_000;
  let debugLines = 0;
  while (!ended) {
    if (nowMs() > deadlineMs) {
      const extra = {
        turns,
        p1_req: p1.requestCount,
        p2_req: p2.requestCount,
        p1_choice: p1.choiceCount,
        p2_choice: p2.choiceCount,
        p1_last: p1.lastRequestSummary,
        p2_last: p2.lastRequestSummary,
        p1_choice_last: p1.lastChoice,
        p2_choice_last: p2.lastChoice,
        p1_err: p1.lastError,
        p2_err: p2.lastError,
      };
      throw new Error(`Battle timed out waiting for completion: ${JSON.stringify(extra)}`);
    }

    // Hygiene: if the engine reports an invalid choice for either side, fail-fast immediately.
    // This must run even if the latest request is `wait`/null; otherwise we can hang until timeout.
    const p1ErrNow = p1.lastError;
    if (isInvalidChoiceError(p1ErrNow)) {
      const r1Now = p1.lastRequest as any;
      if (opts.p1.policyMode === 'ppo' && opts.ppo) {
        opts.ppo.dumpInvalidChoice({
          player: 'p1',
          turn: turns,
          req: r1Now,
          note: { last_error: p1ErrNow, last_choice: p1.lastChoice },
        });
      }
      throw new Error(`Invalid choice detected for p1: ${String(p1ErrNow ?? '')}`);
    }
    const p2ErrNow = p2.lastError;
    if (isInvalidChoiceError(p2ErrNow)) {
      const r2Now = p2.lastRequest as any;
      if (opts.p2.policyMode === 'ppo' && opts.ppo) {
        opts.ppo.dumpInvalidChoice({
          player: 'p2',
          turn: turns,
          req: r2Now,
          note: { last_error: p2ErrNow, last_choice: p2.lastChoice },
        });
      }
      throw new Error(`Invalid choice detected for p2: ${String(p2ErrNow ?? '')}`);
    }

    const r1 = p1.lastRequest as any;
    const r2 = p2.lastRequest as any;

    // "wait" requests mean this side has nothing to choose right now.
    // Do not block the other side from choosing.
    if (r1?.wait) p1.lastRequest = null;
    if (r2?.wait) p2.lastRequest = null;

    // If requests exist, respond.
    if (r1 && !r1.wait) {
      if (debug && debugLines++ < 20) {
        console.log(`[vgc-demo][p1] req teamPreview=${!!r1.teamPreview} wait=${!!r1.wait} forceSwitch=${!!r1.forceSwitch} active=${(r1.active ?? []).length}`);
      }
      const p1Err = p1.lastError;
      const hadInvalid = isInvalidChoiceError(p1Err);
      if (hadInvalid) {
        // Strict hygiene in PPO mode: dump + stop immediately.
        if (opts.p1.policyMode === 'ppo' && opts.ppo) {
          opts.ppo.dumpInvalidChoice({
            player: 'p1',
            turn: turns,
            req: r1,
            note: { last_error: p1Err, last_choice: p1.lastChoice },
          });
        }
        throw new Error(`Invalid choice detected for p1: ${String(p1Err ?? '')}`);
      }

      const choiceAttempt = p1.choiceCount;
      let d = await getChoiceForPlayer({
        req: r1,
        seed: opts.seed + turns * 17 + 1 + choiceAttempt * 997,
        formatId: opts.formatId,
        policyMode: opts.p1.policyMode,
        python: opts.p1.python,
        teamPreviewChoice: opts.p1.teamPreviewChoice,
        turn: turns,
        player: 'p1',
        debug: opts.debug,
        ppo: opts.ppo,
      });

      if (choiceLooksDisabledInRequest(d.choice_norm, r1)) {
        if (opts.p1.policyMode === 'ppo' && opts.ppo) {
          opts.ppo.dumpPpoDisabledChoice({
            player: 'p1',
            turn: turns,
            req: r1,
            attempted_choice: d.choice_norm,
            source: d.choice_source,
          });
          throw new Error(`PPO produced disabled choice for p1: ${d.choice_norm}`);
        }
        const fallback = pickRandomChoiceFromRequest(r1, opts.seed + turns * 17 + 1 + choiceAttempt * 997 + 123);
        d = { choice_raw: d.choice_raw, choice_norm: fallback, choice_source: 'fallback' };
      }
      if (opts.trace) {
        opts.trace({
          type: 'decision',
          player: 'p1',
          turn: turns,
          request: r1,
          legal: extractLegal(r1),
          choice_raw: d.choice_raw,
          choice_norm: d.choice_norm,
          choice_source: d.choice_source,
          policy_debug: d.policy_debug,
        });
      }
      p1.lastRequest = null;
      if (debug && debugLines++ < 20) console.log(`[vgc-demo][p1] choose: ${d.choice_norm}`);
      p1.choose(d.choice_norm);
    }

    if (r2 && !r2.wait) {
      if (debug && debugLines++ < 20) {
        console.log(`[vgc-demo][p2] req teamPreview=${!!r2.teamPreview} wait=${!!r2.wait} forceSwitch=${!!r2.forceSwitch} active=${(r2.active ?? []).length}`);
      }
      const p2Err = p2.lastError;
      const hadInvalid = isInvalidChoiceError(p2Err);
      if (hadInvalid) {
        if (opts.p2.policyMode === 'ppo' && opts.ppo) {
          opts.ppo.dumpInvalidChoice({
            player: 'p2',
            turn: turns,
            req: r2,
            note: { last_error: p2Err, last_choice: p2.lastChoice },
          });
        }
        throw new Error(`Invalid choice detected for p2: ${String(p2Err ?? '')}`);
      }

      const choiceAttempt = p2.choiceCount;
      let d = await getChoiceForPlayer({
        req: r2,
        seed: opts.seed + turns * 17 + 2 + choiceAttempt * 997,
        formatId: opts.formatId,
        policyMode: opts.p2.policyMode,
        python: opts.p2.python,
        teamPreviewChoice: opts.p2.teamPreviewChoice,
        turn: turns,
        player: 'p2',
        debug: opts.debug,
        ppo: opts.ppo,
      });

      if (choiceLooksDisabledInRequest(d.choice_norm, r2)) {
        if (opts.p2.policyMode === 'ppo' && opts.ppo) {
          opts.ppo.dumpPpoDisabledChoice({
            player: 'p2',
            turn: turns,
            req: r2,
            attempted_choice: d.choice_norm,
            source: d.choice_source,
          });
          throw new Error(`PPO produced disabled choice for p2: ${d.choice_norm}`);
        }
        const fallback = pickRandomChoiceFromRequest(r2, opts.seed + turns * 17 + 2 + choiceAttempt * 997 + 456);
        d = { choice_raw: d.choice_raw, choice_norm: fallback, choice_source: 'fallback' };
      }
      if (opts.trace) {
        opts.trace({
          type: 'decision',
          player: 'p2',
          turn: turns,
          request: r2,
          legal: extractLegal(r2),
          choice_raw: d.choice_raw,
          choice_norm: d.choice_norm,
          choice_source: d.choice_source,
          policy_debug: d.policy_debug,
        });
      }
      p2.lastRequest = null;
      if (debug && debugLines++ < 20) console.log(`[vgc-demo][p2] choose: ${d.choice_norm}`);
      p2.choose(d.choice_norm);
    }

  // Yield without coarse timer delays.
  await new Promise<void>((resolve) => setImmediate(resolve));

    // if spectator stream ended, break
    if ((players.spectator as any).atEOF) {
      ended = true;
      break;
    }
  }

  const ms = nowMs() - started;

  // PPO terminal reward assignment.
  if (opts.ppo) {
    const winnerTag = winner === opts.p1.name ? 'p1' : winner === opts.p2.name ? 'p2' : null;
    try {
      opts.ppo.finalizeBattle(winnerTag);
    } catch {
      // ignore
    }
  }

  debugEmit(opts.debug, {
    type: 'battle_end',
    winner,
    turns,
    sim_ms: ms,
  });
  return {
    winner,
    turns,
    log,
    ms,
    formatId: opts.formatId,
    p1: {
      name: opts.p1.name,
      policy:
        opts.p1.policyMode === 'python'
          ? `python:${opts.p1.python?.policy}`
          : opts.p1.policyMode === 'ppo'
            ? 'ppo'
          : opts.p1.policyMode === 'local'
            ? 'local:battle_policy'
            : 'fallback',
    },
    p2: {
      name: opts.p2.name,
      policy:
        opts.p2.policyMode === 'python'
          ? `python:${opts.p2.python?.policy}`
          : opts.p2.policyMode === 'ppo'
            ? 'ppo'
          : opts.p2.policyMode === 'local'
            ? 'local:battle_policy'
            : 'fallback',
    },
  };
}

async function getChoiceForPlayer(args: {
  req: any;
  seed: number;
  formatId: string;
  policyMode: PolicyMode;
  python?: PythonClient;
  teamPreviewChoice?: string;
  turn: number;
  player: string;
  debug?: DebugCtx;
  ppo?: PpoBattleCoordinator;
}): Promise<{
  choice_raw: string;
  choice_norm: string;
  choice_source: 'python' | 'fallback' | 'python_error' | 'local' | 'ppo';
  policy_debug?: LocalPolicyDebug;
}> {
  if (args.req?.teamPreview && args.teamPreviewChoice) {
    const raw = String(args.teamPreviewChoice).trim();
    const normalized = normalizeChoiceForRequest(raw, args.req);
    debugEmit(args.debug, {
      type: 'choice',
      player: args.player,
      turn: args.turn,
      source: 'local',
      choice_raw: raw,
      choice: normalized,
      changed: normalized !== raw,
    });
    return { choice_raw: raw, choice_norm: normalized, choice_source: 'local' };
  }

  if (args.policyMode === 'python' && args.python) {
    try {
      const res = await postJson(`${args.python.baseUrl}/choose`, {
        request: args.req,
        format: args.formatId,
        turn: args.turn,
        policy: args.python.policy,
      });
      const raw = String(res?.choice ?? '').trim();
      if (raw) {
        const normalized = normalizeChoiceForRequest(raw, args.req);
        debugEmit(args.debug, {
          type: 'choice',
          player: args.player,
          turn: args.turn,
          source: 'python',
          choice_raw: raw,
          choice: normalized,
          changed: normalized !== raw,
        });
        return { choice_raw: raw, choice_norm: normalized, choice_source: 'python' };
      }
    } catch (e: any) {
      debugEmit(args.debug, {
        type: 'choice',
        player: args.player,
        turn: args.turn,
        source: 'python_error',
        error: String(e?.message ?? e),
      });
      // fall through
      const raw = pickRandomChoiceFromRequest(args.req, args.seed);
      const normalized = normalizeChoiceForRequest(raw, args.req);
      debugEmit(args.debug, {
        type: 'choice',
        player: args.player,
        turn: args.turn,
        source: 'fallback',
        choice_raw: raw,
        choice: normalized,
        changed: normalized !== raw,
      });
      return { choice_raw: raw, choice_norm: normalized, choice_source: 'python_error' };
    }
  }

  if (args.policyMode === 'ppo' && args.ppo) {
    try {
      const raw = String(
        await args.ppo.chooseForRequest({
          player: args.player === 'p2' ? 'p2' : 'p1',
          req: args.req,
          turn: args.turn,
          seed: args.seed,
        })
      ).trim();
      const normalized = normalizeChoiceForRequest(raw, args.req);
      debugEmit(args.debug, {
        type: 'choice',
        player: args.player,
        turn: args.turn,
        source: 'ppo',
        choice_raw: raw,
        choice: normalized,
        changed: normalized !== raw,
      });
      return { choice_raw: raw, choice_norm: normalized, choice_source: 'ppo' };
    } catch (e: any) {
      debugEmit(args.debug, {
        type: 'choice',
        player: args.player,
        turn: args.turn,
        source: 'ppo_error',
        error: String(e?.message ?? e),
      });
      throw e;
    }
  }

  if (args.policyMode === 'local') {
    const local = chooseLocal(args.req, args.seed, args.turn);
    const raw = String(local.choice ?? '').trim();
    const normalized = normalizeChoiceForRequest(raw, args.req);
    debugEmit(args.debug, {
      type: 'choice',
      player: args.player,
      turn: args.turn,
      source: 'local',
      choice_raw: raw,
      choice: normalized,
      changed: normalized !== raw,
    });
    return { choice_raw: raw, choice_norm: normalized, choice_source: 'local', policy_debug: local.debug };
  }

  const raw = pickRandomChoiceFromRequest(args.req, args.seed);
  const normalized = normalizeChoiceForRequest(raw, args.req);
  debugEmit(args.debug, {
    type: 'choice',
    player: args.player,
    turn: args.turn,
    source: 'fallback',
    choice_raw: raw,
    choice: normalized,
    changed: normalized !== raw,
  });
  return { choice_raw: raw, choice_norm: normalized, choice_source: 'fallback' };
}
