export type PokemonType = string;

export interface TypeChartData {
  readonly superEffective: number;
  readonly notVeryEffective: number;
  /** Canon "no effect" pairs: here only a strong resist (a move never does nothing). */
  readonly immune?: number;
  /** Attacking type → defending types it is strong / weak against / canon-immune to. Missing pairs are neutral. */
  readonly chart: Readonly<Record<PokemonType, { readonly strong: readonly string[]; readonly weak: readonly string[]; readonly immune?: readonly string[] }>>;
}

/** Combined multiplier of one attacking type against all of the defender's types. */
export function typeMultiplier(
  data: TypeChartData,
  attackType: PokemonType,
  defenderTypes: readonly PokemonType[],
): number {
  const row = data.chart[attackType];
  if (!row) throw new Error(`Unknown attacking type '${attackType}'`);
  return defenderTypes.reduce((mult, t) => {
    if (row.strong.includes(t)) return mult * data.superEffective;
    if (row.weak.includes(t)) return mult * data.notVeryEffective;
    if (row.immune?.includes(t)) return mult * (data.immune ?? data.notVeryEffective);
    return mult;
  }, 1);
}
