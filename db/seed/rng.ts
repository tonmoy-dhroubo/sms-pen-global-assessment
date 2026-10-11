// Deterministic pseudo-random numbers for the seed's filler values (seed-plan rule 3): the same seed always gives
// the same sequence, so two runs produce the same marks, payment dates and submission times.

/** The fixed seed. Changing it changes every filler value in the demo data. */
export const SEED_RNG_SEED = 20261012;

export interface Rng {
  /** A float in [0, 1). */
  next(): number;
  /** A whole number from `min` to `max`, both included. */
  int(min: number, max: number): number;
  /** One element of a non-empty array. */
  pick<T>(items: readonly T[]): T;
}

/** mulberry32: a tiny 32-bit generator with good enough statistics for demo data. */
export function createRng(seed: number = SEED_RNG_SEED): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => {
      if (items.length === 0) throw new RangeError("pick() needs a non-empty array");
      return items[Math.floor(next() * items.length)]!; // index is always in range
    },
  };
}
