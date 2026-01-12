import { PPO_ACTIONS_PER_ACTIVE, PpoTarget, encodeMoveAction, encodeSwitchAction } from './action_space';
import { BattleStateTracker } from './battle_state_tracker';
import { isFaintedFromCondition } from './util';

function isNoTargetMoveId(id: string): boolean {
  const m = String(id ?? '').toLowerCase();
  return (
    // Protect family
    m === 'protect' ||
    m === 'detect' ||
    m === 'spikyshield' ||
    m === 'kingsshield' ||
    m === 'banefulbunker' ||
    m === 'silktrap' ||
    m === 'obstruct' ||
    m === 'endure' ||
    // Guards
    m === 'wideguard' ||
    m === 'quickguard' ||
    m === 'craftyshield' ||
    m === 'matblock' ||
    // Common spread / no-target
    m === 'rockslide' ||
    m === 'icywind' ||
    m === 'makeitrain' ||
    m === 'bleakwindstorm' ||
    // Redirection
    m === 'followme' ||
    m === 'ragepowder' ||
    // Side setup
    m === 'tailwind'
  );
}

function needsTarget(targetType: string | undefined, moveId: string): boolean {
  if (isNoTargetMoveId(moveId)) return false;
  const t = String(targetType ?? '');
  if (!t) return true;
  return (
    t === 'normal' ||
    t === 'adjacentFoe' ||
    t === 'any' ||
    t === 'anyAdjacentFoe' ||
    t === 'randomNormal' ||
    t === 'adjacentAlly' ||
    t === 'ally' ||
    t === 'adjacentAllyOrSelf' ||
    t === 'self'
  );
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

    if (forced && forcePassOnly) {
      // Forced slot but no distinct switch is available for it.
      // Must respond with 'pass' to avoid an incomplete forced-switch choice.
      outMask[0] = 1;
      outTable[0] = 'pass';
      return;
    }

    // moves
    const moves = Array.isArray(activeReq?.moves) ? (activeReq.moves as any[]) : [];
    for (let j = 0; j < Math.min(4, moves.length); j++) {
      const m = moves[j] ?? {};
      if (m.disabled) continue;
      const moveSlot1 = j + 1;
      const id = String(m?.id ?? '').toLowerCase();
      const targetType = m?.target as string | undefined;

      const wantsTarget = needsTarget(targetType, id);
      const allowedTargets: PpoTarget[] = [];

      if (!wantsTarget) {
        allowedTargets.push(PpoTarget.none);
      } else {
        const t = String(targetType ?? '');
        if (t === 'adjacentAlly' || t === 'ally') {
          if (hasPartner) allowedTargets.push(PpoTarget.ally);
        } else if (t === 'adjacentAllyOrSelf') {
          if (hasPartner) allowedTargets.push(PpoTarget.ally);
          allowedTargets.push(PpoTarget.self);
        } else if (t === 'self') {
          allowedTargets.push(PpoTarget.self);
        } else {
          // foe targeting (or unknown): allow opp1 always; opp2 only if opponent has a partner alive.
          allowedTargets.push(PpoTarget.opp1);
          if (oppHasPartner) allowedTargets.push(PpoTarget.opp2);
        }
      }

      for (const tgt of allowedTargets) {
        const actionId = encodeMoveAction(moveSlot1, tgt);
        const loc = moveTargetLoc(tgt, slotIndex, hasPartner, oppHasPartner);
        const choice = loc ? `move ${moveSlot1}${loc}` : `move ${moveSlot1}`;
        outMask[actionId] = forced ? 0 : 1;
        outTable[actionId] = forced ? null : choice;
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
      for (let a = 0; a < 28; a++) {
        outMask[a] = 0;
        outTable[a] = null;
      }
    }

    // Guarantee at least one legal action.
    if (!outMask.some((x) => x === 1)) {
      outMask[0] = 1;
      outTable[0] = 'default';
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
    mask_right[0] = 1;
    table_right[0] = 'pass';
  }

  return { expectedChoices, slot_left, slot_right, mask_left, mask_right, table_left, table_right };
}
