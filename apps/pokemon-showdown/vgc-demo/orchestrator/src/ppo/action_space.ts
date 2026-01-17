// Per-active action_id layout (A=107)
//
// 0..55   : move_i + target_t + tera_f
//          i in [1..4], t in [0..6], tera_f in [0..1]
//          index = ((i0 * 7 + t0) * 2 + tera_f)
// 56..61  : switch_to slot s in [1..6]
// 62      : pass
// 63..106 : reserved (masked off for now)

export const PPO_ACTIONS_PER_ACTIVE = 107 as const;

export const PPO_MOVE_SLOTS = 4 as const;
export const PPO_TARGETS = 7 as const;
export const PPO_TERA_FLAGS = 2 as const;

export const PPO_SWITCH_SLOTS = 6 as const;

export const PPO_MOVE_ACTIONS = (PPO_MOVE_SLOTS * PPO_TARGETS * PPO_TERA_FLAGS) as const;
export const PPO_SWITCH_BASE = PPO_MOVE_ACTIONS as const;
export const PPO_PASS_ACTION_ID = (PPO_SWITCH_BASE + PPO_SWITCH_SLOTS) as const;

export enum PpoTarget {
  opp1 = 0,
  opp2 = 1,
  ally = 2,
  self = 3,
  all_opp = 4,
  all = 5,
  none = 6,
}

export function encodeMoveAction(moveSlot1: number, target: PpoTarget, tera: 0 | 1 = 0): number {
  const i0 = Math.max(0, Math.min(PPO_MOVE_SLOTS - 1, Math.trunc(moveSlot1 - 1)));
  const t0 = Math.max(0, Math.min(PPO_TARGETS - 1, Math.trunc(target)));
  const f0 = tera ? 1 : 0;
  return (i0 * PPO_TARGETS + t0) * PPO_TERA_FLAGS + f0;
}

export function decodeMoveAction(actionId: number): { kind: 'move'; moveSlot1: number; target: PpoTarget; tera: 0 | 1 } | null {
  const a = Math.trunc(actionId);
  if (a < 0 || a >= PPO_MOVE_ACTIONS) return null;
  const base = Math.floor(a / PPO_TERA_FLAGS);
  const f0 = a % PPO_TERA_FLAGS;
  const i0 = Math.floor(base / PPO_TARGETS);
  const t0 = base % PPO_TARGETS;
  return { kind: 'move', moveSlot1: i0 + 1, target: t0 as PpoTarget, tera: (f0 ? 1 : 0) as 0 | 1 };
}

export function encodeSwitchAction(slot1: number): number {
  const s0 = Math.max(0, Math.min(PPO_SWITCH_SLOTS - 1, Math.trunc(slot1 - 1)));
  return PPO_SWITCH_BASE + s0;
}

export function decodeSwitchAction(actionId: number): { kind: 'switch'; slot1: number } | null {
  const a = Math.trunc(actionId);
  const base = PPO_SWITCH_BASE;
  if (a < base || a >= base + PPO_SWITCH_SLOTS) return null;
  return { kind: 'switch', slot1: a - base + 1 };
}

export function isSwitchAction(actionId: number): boolean {
  return decodeSwitchAction(actionId) !== null;
}

export function isPassAction(actionId: number): boolean {
  return Math.trunc(actionId) === PPO_PASS_ACTION_ID;
}
