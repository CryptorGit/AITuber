export const PPO_ACTIONS_PER_ACTIVE = 34 as const;

// Per-active action_id layout (A=34)
// 0..27 : move_i + target_t, where i in [1..4], t in [0..6]
// 28..33: switch_to slot s in [1..6]

export const PPO_MOVE_SLOTS = 4 as const;
export const PPO_TARGETS = 7 as const;

export enum PpoTarget {
  opp1 = 0,
  opp2 = 1,
  ally = 2,
  self = 3,
  all_opp = 4,
  all = 5,
  none = 6,
}

export function encodeMoveAction(moveSlot1: number, target: PpoTarget): number {
  const i0 = Math.max(0, Math.min(PPO_MOVE_SLOTS - 1, Math.trunc(moveSlot1 - 1)));
  const t0 = Math.max(0, Math.min(PPO_TARGETS - 1, Math.trunc(target)));
  return i0 * PPO_TARGETS + t0;
}

export function decodeMoveAction(actionId: number): { kind: 'move'; moveSlot1: number; target: PpoTarget } | null {
  const a = Math.trunc(actionId);
  if (a < 0 || a >= PPO_MOVE_SLOTS * PPO_TARGETS) return null;
  const i0 = Math.floor(a / PPO_TARGETS);
  const t0 = a % PPO_TARGETS;
  return { kind: 'move', moveSlot1: i0 + 1, target: t0 as PpoTarget };
}

export function encodeSwitchAction(slot1: number): number {
  const s0 = Math.max(0, Math.min(5, Math.trunc(slot1 - 1)));
  return PPO_MOVE_SLOTS * PPO_TARGETS + s0;
}

export function decodeSwitchAction(actionId: number): { kind: 'switch'; slot1: number } | null {
  const a = Math.trunc(actionId);
  const base = PPO_MOVE_SLOTS * PPO_TARGETS;
  if (a < base || a >= base + 6) return null;
  return { kind: 'switch', slot1: a - base + 1 };
}

export function isSwitchAction(actionId: number): boolean {
  return decodeSwitchAction(actionId) !== null;
}
