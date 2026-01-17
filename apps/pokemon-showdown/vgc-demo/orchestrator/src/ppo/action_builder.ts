import { PPO_ACTIONS_PER_ACTIVE, PPO_MOVE_ACTIONS, PPO_PASS_ACTION_ID, PpoTarget, encodeMoveAction, encodeSwitchAction } from './action_space';
import { BattleStateTracker } from './battle_state_tracker';
import { isFaintedFromCondition } from './util';

const forceNeedsTargetMoveIds = new Set<string>([
  'aurasphere',
  'shadowball',
  'darkpulse',
  'thunderbolt',
  'icebeam',
  'flamethrower',
  'energyball',
  // Some request states omit `target` even for single-target moves.
  // These are common offenders that then trip "<move> needs a target".
  'partingshot',
  'ragefist',
]);

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

  // Forced / auto-target moves (targetLoc is not allowed in some request states)
  'struggle',
  'recharge',
  'outrage',
]);

function isNoTargetTargetType(t: string): boolean {
  // Common PS target types that do not require an explicit targetLoc.
  // Keep this conservative; when unsure, prefer NO target rather than guessing a foe slot.
  const s = String(t ?? '');
  if (!s) return false;
  if (s === 'self') return true;
  if (s.startsWith('all')) return true;
  if (s === 'adjacentAllies' || s === 'allies') return true;
  return false;
}

function moveTargetLoc(target: PpoTarget, activeIndex: number, hasPartner: boolean, oppHasPartner: boolean): string {
  // Uses Pokemon Showdown targetLoc conventions for doubles.
  switch (target) {
    case PpoTarget.opp1:
      return ' 1';
    case PpoTarget.opp2:
      return oppHasPartner ? ' 2' : ' 1';
    case PpoTarget.ally:
      if (!hasPartner) return '';
      return activeIndex === 0 ? ' -2' : ' -1';
    case PpoTarget.self:
      return activeIndex === 0 ? ' -1' : ' -2';
    case PpoTarget.none:
    case PpoTarget.all:
    case PpoTarget.all_opp:
    default:
      return '';
  }
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
    const isFnt = isFaintedFromCondition(cond);
    if (!active && !fainted && !isFnt) out.push(i + 1);
  }
  return out;
}

export type BuiltActionsForRequest = {
  expectedChoices: number; // 1 or 2
  slot_left: number; // original active slot index (0/1)
  slot_right: number; // original active slot index (0/1)
  mask_left: number[]; // len A
  mask_right: number[]; // len A
  table_left: (string | null)[]; // len A
  table_right: (string | null)[]; // len A
};

export function buildActionsForRequest(args: {
  req: any;
  tracker: BattleStateTracker;
}): BuiltActionsForRequest {
  const req = args.req;
  const tracker = args.tracker;

  const activesReqAll = Array.isArray(req?.active) ? (req.active as any[]) : [];
  const forceSwitch = Array.isArray(req?.forceSwitch) ? (req.forceSwitch as boolean[]) : null;

  // Determine which active slots (0/1) are actually unfainted/alive according to req.side.pokemon.
  // Important: Showdown can include move lists for fainted actives, but it will reject extra choices.
  const sideMons = Array.isArray(req?.side?.pokemon) ? (req.side.pokemon as any[]) : [];
  const activesFromSide = sideMons.filter((p) => p && typeof p === 'object' && p.active);
  const aliveActiveSlots: number[] = [];
  for (let slot = 0; slot < Math.min(2, activesFromSide.length); slot++) {
    const p = activesFromSide[slot];
    if (p?.fainted) continue;
    const cond = String(p?.condition ?? '').trim();
    if (isFaintedFromCondition(cond)) continue;
    aliveActiveSlots.push(slot);
  }

  // Decide which active slots are currently actionable.
  // Critical: keep original slot indices (0/1). Filtering without indices breaks forceSwitch alignment.
  const slotsToChoose: number[] = [];
  const forcedPassOnlySlots = new Set<number>();
  if (Array.isArray(forceSwitch) && forceSwitch.length > 0) {
    const forcedSlots: number[] = [];
    for (let i = 0; i < Math.min(2, forceSwitch.length); i++) if (forceSwitch[i]) forcedSlots.push(i);

    // Forced switch phase: Showdown may still require 2 decisions even if only 1 legal switch exists.
    // In that case we must send `switch X, pass` (not an incomplete single switch).
    // We assign real switches to the first K forced slots, and make remaining forced slots pass-only.
    const available = legalSwitchSlots(req).length;
    const k = Math.max(0, Math.min(forcedSlots.length, available));
    for (let i = 0; i < forcedSlots.length; i++) {
      const s = forcedSlots[i];
      slotsToChoose.push(s);
      if (i >= k) forcedPassOnlySlots.add(s);
    }
  } else {
    // If side state indicates only one unfainted active, only that slot should choose.
    // Otherwise, fall back to both actives that have a moves list.
    if (aliveActiveSlots.length > 0 && aliveActiveSlots.length < 2) {
      slotsToChoose.push(...aliveActiveSlots);
    } else {
      for (let i = 0; i < Math.min(2, activesReqAll.length); i++) {
        const a = activesReqAll[i];
        const moves = Array.isArray(a?.moves) ? (a.moves as any[]) : [];
        if (moves.length > 0) slotsToChoose.push(i);
      }
    }
  }

  // Default to slot 0 if we cannot infer.
  if (slotsToChoose.length === 0) slotsToChoose.push(0);
  slotsToChoose.sort((a, b) => a - b);

  const slot_left = slotsToChoose[0] ?? 0;
  const slot_right = slotsToChoose[1] ?? (slot_left === 0 ? 1 : 0);

  const expectedChoices = Math.min(2, slotsToChoose.length);
  const hasPartner = aliveActiveSlots.length >= 2;
  const oppHasPartner = tracker.oppAliveActiveCount >= 2;

  const mask_left = Array.from({ length: PPO_ACTIONS_PER_ACTIVE }, () => 0);
  const mask_right = Array.from({ length: PPO_ACTIONS_PER_ACTIVE }, () => 0);
  const table_left = Array.from({ length: PPO_ACTIONS_PER_ACTIVE }, () => null as string | null);
  const table_right = Array.from({ length: PPO_ACTIONS_PER_ACTIVE }, () => null as string | null);

  const buildForActive = (
    activeReq: any,
    slotIndex: number,
    outMask: number[],
    outTable: (string | null)[],
    forcePassOnly: boolean
  ) => {
    const forced = !!forceSwitch?.[slotIndex];

    // Showdown: canTerastallize is a string (tera type) when still available, else ''.
    const canTera = !!String(activeReq?.canTerastallize ?? '').trim();

    if (forced && forcePassOnly) {
      // Forced slot but no distinct switch is available for it.
      // Must respond with 'pass' to avoid an incomplete forced-switch choice.
      outMask[PPO_PASS_ACTION_ID] = 1;
      outTable[PPO_PASS_ACTION_ID] = 'pass';
      return;
    }

    // moves
    const moves = Array.isArray(activeReq?.moves) ? (activeReq.moves as any[]) : [];
    for (let j = 0; j < Math.min(4, moves.length); j++) {
      const m = moves[j] ?? {};
      if (m.disabled) continue;
      const moveSlot1 = j + 1;
      const id = String(m?.id ?? '').toLowerCase();
      const moveName = String(m?.move ?? '').toLowerCase();
      const targetType = m?.target as string | undefined;

      const forceNoTarget =
        neverTargetMoveIds.has(id) ||
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

      const allowedTargets: PpoTarget[] = [];
      const t = String(targetType ?? '');

      // If request metadata is missing/unreliable, do NOT guess that the move is foe-targeted.
      // Prefer NO target unless we are confident the move requires a target.
      if (!t) {
        if (forceNeedsTargetMoveIds.has(id)) {
          allowedTargets.push(PpoTarget.opp1);
          if (oppHasPartner) allowedTargets.push(PpoTarget.opp2);
        } else {
          allowedTargets.push(PpoTarget.none);
        }
      } else if (forceNoTarget || isNoTargetTargetType(t)) {
        allowedTargets.push(PpoTarget.none);
      } else if (t === 'adjacentAlly' || t === 'ally') {
        if (hasPartner) allowedTargets.push(PpoTarget.ally);
      } else if (t === 'adjacentAllyOrSelf') {
        if (hasPartner) allowedTargets.push(PpoTarget.ally);
        allowedTargets.push(PpoTarget.self);
      } else if (
        t === 'normal' ||
        t === 'adjacentFoe' ||
        t === 'any' ||
        t === 'anyAdjacentFoe' ||
        t === 'randomNormal'
      ) {
        allowedTargets.push(PpoTarget.opp1);
        if (oppHasPartner) allowedTargets.push(PpoTarget.opp2);
      } else {
        // Unknown target type: safest is to omit target.
        allowedTargets.push(PpoTarget.none);
      }

      for (const tgt of allowedTargets) {
        const loc = moveTargetLoc(tgt, slotIndex, hasPartner, oppHasPartner);
        const baseChoice = loc ? `move ${moveSlot1}${loc}` : `move ${moveSlot1}`;

        // Non-tera variant
        const a0 = encodeMoveAction(moveSlot1, tgt, 0);
        outMask[a0] = forced ? 0 : 1;
        outTable[a0] = forced ? null : baseChoice;

        // Tera variant (only if still available)
        const a1 = encodeMoveAction(moveSlot1, tgt, 1);
        outMask[a1] = forced || !canTera ? 0 : 1;
        outTable[a1] = forced || !canTera ? null : `${baseChoice} terastallize`;
      }
    }

    // switches
    const canSwitch = !!req?.canSwitch || !!req?.forceSwitch;
    if (canSwitch) {
      const sw = legalSwitchSlots(req);
      for (const slot1 of sw) {
        const actionId = encodeSwitchAction(slot1);
        outMask[actionId] = 1;
        outTable[actionId] = `switch ${slot1}`;
      }
    }

    // If forced switch and no legal switch exists, fall back to pass.
    // (Showdown will often accept 'pass' for non-actionable slots.)
    if (forced) {
      // remove any move masks already set
      for (let a = 0; a < PPO_MOVE_ACTIONS; a++) {
        outMask[a] = 0;
        outTable[a] = null;
      }
    }

    // Guarantee at least one legal action.
    if (!outMask.some((x) => x === 1)) {
      outMask[PPO_PASS_ACTION_ID] = 1;
      outTable[PPO_PASS_ACTION_ID] = 'pass';
    }
  };

  buildForActive(
    activesReqAll[slot_left] ?? {},
    slot_left,
    mask_left,
    table_left,
    forcedPassOnlySlots.has(slot_left)
  );
  if (expectedChoices >= 2) {
    buildForActive(
      activesReqAll[slot_right] ?? {},
      slot_right,
      mask_right,
      table_right,
      forcedPassOnlySlots.has(slot_right)
    );
  }
  else {
    // only one actionable active => mask right is dummy
    mask_right[PPO_PASS_ACTION_ID] = 1;
    table_right[PPO_PASS_ACTION_ID] = 'pass';
  }

  return { expectedChoices, slot_left, slot_right, mask_left, mask_right, table_left, table_right };
}
