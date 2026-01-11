export type Rng = {
  nextFloat(): number;
  nextIntExclusive(max: number): number;
};

export function makeRng(seed: number): Rng {
  // LCG, deterministic across platforms.
  let state = (seed >>> 0) || 1;
  const nextU32 = () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state;
  };

  return {
    nextFloat() {
      return nextU32() / 0xffffffff;
    },
    nextIntExclusive(max: number) {
      if (!Number.isFinite(max) || max <= 0) return 0;
      return nextU32() % Math.floor(max);
    },
  };
}

export function stableArgMax<T>(items: T[], score: (x: T) => number): { item: T; score: number; index: number } {
  if (items.length === 0) throw new Error('stableArgMax: empty items');
  let bestIndex = 0;
  let bestScore = score(items[0]);
  for (let i = 1; i < items.length; i++) {
    const s = score(items[i]);
    if (s > bestScore) {
      bestScore = s;
      bestIndex = i;
    }
  }
  return { item: items[bestIndex], score: bestScore, index: bestIndex };
}
