import type { BaseStats } from "./content";

export type StatName = keyof BaseStats;
export const STAT_NAMES: readonly StatName[] = ["hp", "attack", "defense", "speed"];

export interface TypeProfile {
  /** Level-1 stats of a Pokémon of this type (the type's playstyle). */
  readonly profile: BaseStats;
}

/**
 * Level-1 stats of a species: the average of its types' profiles (rounded),
 * plus the species' own small nudge. Never below 0.
 */
export function speciesStats(types: Readonly<Record<string, TypeProfile>>, typeIds: readonly string[], nudge: Partial<BaseStats> = {}): BaseStats {
  const out = {} as Record<StatName, number>;
  for (const s of STAT_NAMES) {
    const avg = typeIds.reduce((sum, t) => {
      const p = types[t];
      if (!p) throw new Error(`unknown type ${t}`);
      return sum + p.profile[s];
    }, 0) / typeIds.length;
    out[s] = Math.max(0, Math.round(avg) + (nudge[s] ?? 0));
  }
  return out;
}
