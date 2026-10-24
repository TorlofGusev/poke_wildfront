export type PokemonType = string;

export interface TypeChartData {
  readonly superEffective: number;
  readonly notVeryEffective: number;
  /** Attacking type → defending types it is strong / weak against. Missing pairs are neutral. */
  readonly chart: Readonly<Record<PokemonType, { readonly strong: readonly string[]; readonly weak: readonly string[] }>>;
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
    return mult;
  }, 1);
}
