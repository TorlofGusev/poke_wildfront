/**
 * Mulberry32: tiny, fast, seedable PRNG. The whole generator state is one uint32,
 * so it can live inside serializable battle state and replays are exact.
 */
export function nextRandom(state: number): { value: number; state: number } {
  const s = (state + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, state: s };
}

/** Integer in [min, max] inclusive. */
export function randomInt(state: number, min: number, max: number): { value: number; state: number } {
  const r = nextRandom(state);
  return { value: min + Math.floor(r.value * (max - min + 1)), state: r.state };
}

/** Picks one item with probability proportional to its weight. */
export function weightedPick<T>(state: number, items: readonly T[], weight: (t: T) => number): { value: T; state: number } {
  const total = items.reduce((s, t) => s + weight(t), 0);
  if (items.length === 0 || total <= 0) throw new Error("weightedPick needs positive weights");
  const r = nextRandom(state);
  let x = r.value * total;
  for (const item of items) {
    x -= weight(item);
    if (x < 0) return { value: item, state: r.state };
  }
  return { value: items[items.length - 1]!, state: r.state };
}
