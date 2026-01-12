import { abilityId, itemId, teraTypeId, typeId } from './id_maps';
import {
  ENTITY_FLOAT_DIM,
  ENTITY_INT_DIM,
  GLOBAL_FLOAT_DIM,
  GLOBAL_INT_DIM,
  HISTORY_FLOAT_DIM,
  HISTORY_INT_DIM,
  PPO_ENTITY_COUNT,
  PPO_HISTORY_K,
  PPO_TEAM_SIZE,
  type PackedObs,
} from './obs_types';
import { make2d } from './util';
import { BattleStateTracker } from './battle_state_tracker';

export function buildPackedObs(tr: BattleStateTracker): PackedObs {
  const entity_int = make2d(PPO_ENTITY_COUNT, ENTITY_INT_DIM, 0);
  const entity_float = make2d(PPO_ENTITY_COUNT, ENTITY_FLOAT_DIM, 0);

  const fillEntity = (row: number, m: any) => {
    // entity_int layout (len=11):
    // [species, status, type1, type2, item, ability, tera_type, move1,move2,move3,move4]
    entity_int[row][0] = Number(m?.species_id ?? 0) | 0;
    entity_int[row][1] = Number(m?.status_id ?? 0) | 0;
    entity_int[row][2] = typeId(String(m?.type1 ?? '')) | 0;
    entity_int[row][3] = typeId(String(m?.type2 ?? '')) | 0;
    entity_int[row][4] = itemId(String(m?.item ?? '')) | 0;
    entity_int[row][5] = abilityId(String(m?.ability ?? '')) | 0;
    entity_int[row][6] = teraTypeId(String(m?.tera_type ?? '')) | 0;

    const moves = Array.isArray(m?.revealed_moves) ? (m.revealed_moves as any[]) : [];
    for (let j = 0; j < 4; j++) entity_int[row][7 + j] = Number(moves[j] ?? 0) | 0;

    // entity_float layout (len=11):
    // [hp_frac, fainted, active, terastallized, boosts(7)]
    const hp = Number(m?.hp_frac ?? -1);
    entity_float[row][0] = Number.isFinite(hp) ? hp : -1;
    entity_float[row][1] = m?.fainted ? 1 : 0;
    entity_float[row][2] = m?.active ? 1 : 0;
    entity_float[row][3] = m?.terastallized ? 1 : 0;
    const boosts = Array.isArray(m?.boosts) ? (m.boosts as any[]) : [];
    for (let j = 0; j < 7; j++) entity_float[row][4 + j] = Number(boosts[j] ?? 0) || 0;
  };

  for (let i = 0; i < PPO_TEAM_SIZE; i++) fillEntity(i, tr.my[i]);
  for (let i = 0; i < PPO_TEAM_SIZE; i++) fillEntity(PPO_TEAM_SIZE + i, tr.opp[i]);

  const global_int = Array.from({ length: GLOBAL_INT_DIM }, () => 0);
  global_int[0] = Number(tr.turn) | 0;
  global_int[1] = Number(tr.weather_id) | 0;
  global_int[2] = Number(tr.terrain_id) | 0;
  global_int[3] = Number(tr.trick_room_turns) | 0;
  global_int[4] = Number(tr.tailwind_my) | 0;
  global_int[5] = Number(tr.tailwind_opp) | 0;
  global_int[6] = Number(tr.reflect_my) | 0;
  global_int[7] = Number(tr.lightscreen_my) | 0;
  global_int[8] = Number(tr.reflect_opp) | 0;
  global_int[9] = Number(tr.lightscreen_opp) | 0;

  const global_float = Array.from({ length: GLOBAL_FLOAT_DIM }, () => 0);

  const history_int = make2d(PPO_HISTORY_K, HISTORY_INT_DIM, 0);
  const history_float = make2d(PPO_HISTORY_K, HISTORY_FLOAT_DIM, 0);

  for (let k = 0; k < PPO_HISTORY_K; k++) {
    const my = tr.last_actions_my[k] ?? [0, 0];
    const opp = tr.last_actions_opp[k] ?? [0, 0];
    history_int[k][0] = my[0] | 0;
    history_int[k][1] = my[1] | 0;
    history_int[k][2] = opp[0] | 0;
    history_int[k][3] = opp[1] | 0;

    const dmg = tr.last_damage[k] ?? [0, 0];
    history_float[k][0] = Number(dmg[0] ?? 0) || 0;
    history_float[k][1] = Number(dmg[1] ?? 0) || 0;
  }

  return { entity_int, entity_float, global_int, global_float, history_int, history_float };
}
