import { z } from 'zod';

const evSchema = z
  .object({
    hp: z.number().int().min(0).max(252).optional(),
    atk: z.number().int().min(0).max(252).optional(),
    def: z.number().int().min(0).max(252).optional(),
    spa: z.number().int().min(0).max(252).optional(),
    spd: z.number().int().min(0).max(252).optional(),
    spe: z.number().int().min(0).max(252).optional(),
  })
  .partial();

const ivSchema = z
  .object({
    hp: z.number().int().min(0).max(31).optional(),
    atk: z.number().int().min(0).max(31).optional(),
    def: z.number().int().min(0).max(31).optional(),
    spa: z.number().int().min(0).max(31).optional(),
    spd: z.number().int().min(0).max(31).optional(),
    spe: z.number().int().min(0).max(31).optional(),
  })
  .partial();

const genderSchema = z.union([z.literal(''), z.literal('M'), z.literal('F')]).default('');

const moves4Schema = z
  .array(z.string().transform((s) => s.trim()))
  .default([])
  .transform((arr) => {
    const out = arr.slice(0, 4);
    while (out.length < 4) out.push('');
    return out;
  });

const poolEntrySchema = z.object({
  id: z.string().default(''),
  species: z.string().default(''),
  setText: z.string().optional(),
  setObj: z.any().optional(),
  name: z.string().optional(),
  level: z.number().int().min(1).max(100).optional(),
  gender: genderSchema.optional(),
  shiny: z.boolean().optional(),
  happiness: z.number().int().min(0).max(255).optional(),
  item: z.string().optional(),
  ability: z.string().optional(),
  nature: z.string().optional(),
  evs: evSchema.optional(),
  ivs: ivSchema.optional(),
  moves: moves4Schema.optional(),
  teraType: z.string().optional(),
  hpType: z.string().optional(),
  pokeball: z.string().optional(),
  gigantamax: z.boolean().optional(),
  dynamaxLevel: z.number().int().min(0).max(10).optional(),
}).passthrough().superRefine((val, ctx) => {
  const evs = val.evs;
  if (!evs) return;
  const sum = (evs.hp ?? 0) + (evs.atk ?? 0) + (evs.def ?? 0) + (evs.spa ?? 0) + (evs.spd ?? 0) + (evs.spe ?? 0);
  if (sum > 510) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `EV total must be <= 510 (got ${sum})` });
  }
});

export const poolSchema = z.object({
  version: z.literal(1).default(1),
  updated_at: z.string().optional(),
  // Selected team of 6 (by pool entry id). Orchestrator uses this as the player's roster.
  team6: z.array(z.string()).optional(),
  pool: z.array(poolEntrySchema),
});

export const trainSettingsSchema = z.object({
  version: z.literal(1).default(1),
  updated_at: z.string().optional(),
  format: z.string().min(1),
  epochs: z.number().int().min(1).default(1),
  snapshotEvery: z.number().int().min(1).default(1),
  opponentPool: z.array(z.string()).default([]),
  seed: z.number().int().min(0).default(0),
  battlesPerBatch: z.number().int().min(1).default(20),
  timeoutMs: z.number().int().min(1000).default(30000),
});

export const exportRequestSchema = z.object({
  battle_id: z.string().min(1),
  // When true, include the in-battle messagebar text overlay (a black text bar) in the rendered/exported video.
  // This maps to the viewer query param `subtitles=1`.
  black_battle_text_overlay: z.boolean().default(false),
});
