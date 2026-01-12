// Deterministic string->int ID helpers.
//
// We intentionally avoid depending on Pokemon Showdown's internal numeric IDs.
// The only requirement for PPO is stable IDs across runs so embeddings are consistent.

export const VOCAB = {
  species: 4096,
  move: 2048,
  item: 1024,
  ability: 1024,
  teraType: 32,
  weather: 32,
  terrain: 32,
} as const;

function fnv1a32(s: string): number {
  // 32-bit FNV-1a
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // convert to unsigned
  return h >>> 0;
}

function hashToVocabId(raw: string, vocabSize: number): number {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return 0;
  const h = fnv1a32(s);
  return (h % vocabSize) + 1; // reserve 0 for unknown
}

export function speciesId(name: string): number {
  return hashToVocabId(name, VOCAB.species);
}

export function moveId(nameOrId: string): number {
  return hashToVocabId(nameOrId, VOCAB.move);
}

export function itemId(name: string): number {
  return hashToVocabId(name, VOCAB.item);
}

export function abilityId(name: string): number {
  return hashToVocabId(name, VOCAB.ability);
}

export function teraTypeId(name: string): number {
  return hashToVocabId(name, VOCAB.teraType);
}

export function weatherId(name: string): number {
  return hashToVocabId(name, VOCAB.weather);
}

export function terrainId(name: string): number {
  return hashToVocabId(name, VOCAB.terrain);
}

export const TYPE_IDS: Record<string, number> = Object.fromEntries(
  [
    'normal',
    'fire',
    'water',
    'electric',
    'grass',
    'ice',
    'fighting',
    'poison',
    'ground',
    'flying',
    'psychic',
    'bug',
    'rock',
    'ghost',
    'dragon',
    'dark',
    'steel',
    'fairy',
  ].map((t, i) => [t, i + 1])
);

export function typeId(name: string): number {
  const s = String(name ?? '').trim().toLowerCase();
  return TYPE_IDS[s] ?? 0;
}

export const STATUS_IDS: Record<string, number> = {
  none: 0,
  brn: 1,
  par: 2,
  slp: 3,
  frz: 4,
  psn: 5,
  tox: 6,
};

export function statusIdFromCondition(cond: string): number {
  const s = String(cond ?? '').trim();
  if (!s) return 0;
  const parts = s.split(' ').filter(Boolean);
  // e.g. "123/300 par" or "0 fnt"
  for (const p of parts) {
    const key = p.toLowerCase();
    if (key in STATUS_IDS) return STATUS_IDS[key];
  }
  return 0;
}
