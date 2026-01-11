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
  name: z.string().default(''),
  species: z.string().min(1),
  level: z.number().int().min(1).max(100).default(50),
  gender: genderSchema,
  shiny: z.boolean().default(false),
  happiness: z.number().int().min(0).max(255).default(255),
  item: z.string().default(''),
  ability: z.string().default(''),
  nature: z.string().default(''),
  evs: evSchema.default({}),
  ivs: ivSchema.default({}),
  moves: moves4Schema,
  teraType: z.string().default(''),
  hpType: z.string().default(''),
  pokeball: z.string().default(''),
  gigantamax: z.boolean().default(false),
  dynamaxLevel: z.number().int().min(0).max(10).default(10),
}).superRefine((val, ctx) => {
  const evs = val.evs ?? {};
  const sum = (evs.hp ?? 0) + (evs.atk ?? 0) + (evs.def ?? 0) + (evs.spa ?? 0) + (evs.spd ?? 0) + (evs.spe ?? 0);
  if (sum > 510) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `EV total must be <= 510 (got ${sum})` });
  }
});

export const poolSchema = z.object({
  version: z.literal(1).default(1),
  updated_at: z.string().optional(),
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
});
