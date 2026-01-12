export const PPO_TEAM_SIZE = 6 as const;
export const PPO_ENTITY_COUNT = 12 as const; // my6 + opp6
export const PPO_HISTORY_K = 4 as const;

export const ENTITY_INT_DIM = 11 as const;
export const ENTITY_FLOAT_DIM = 11 as const;

// global_int layout (len=10):
// [turn, weather_id, terrain_id, trick_room_turns, tailwind_my, tailwind_opp, reflect_my, lightscreen_my, reflect_opp, lightscreen_opp]
export const GLOBAL_INT_DIM = 10 as const;
export const GLOBAL_FLOAT_DIM = 1 as const; // reserved, currently all zeros

// history_int layout (K,4): [my_a1,my_a2,opp_a1,opp_a2]
export const HISTORY_INT_DIM = 4 as const;
// history_float layout (K,2): [delta_my_hp_sum, delta_opp_hp_sum]
export const HISTORY_FLOAT_DIM = 2 as const;

export type PackedObs = {
  entity_int: number[][]; // [12,11]
  entity_float: number[][]; // [12,11]
  global_int: number[]; // [10]
  global_float: number[]; // [1]
  history_int: number[][]; // [K,4]
  history_float: number[][]; // [K,2]
};
