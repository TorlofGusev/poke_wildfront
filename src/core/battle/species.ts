import type { BaseStats } from "./content";

export type StatName = keyof BaseStats;
export const STAT_NAMES: readonly StatName[] = ["hp", "attack", "defense", "speed", "willpower", "crit"];

export interface TypeProfile {
  /** Level-1 stats of a Pokémon of this type (the type's playstyle). */
  readonly profile: BaseStats;
}

/** What every move of this type does in addition to its own effects (applied to each enemy hit). */
export interface TypeMoveMechanic {
  readonly appliesStatus?: { readonly status: string; readonly duration: number };
  /** Pushes the target this many tiles (on top of any push the move has). */
  readonly extraPush?: number;
  readonly extraPull?: number;
  /** Heals the user for this fraction of the damage dealt. */
  readonly drain?: number;
  /** Never less than ×1 type effectiveness. */
  readonly neverResisted?: boolean;
  /** The target's Defense is ignored. */
  readonly ignoresDefense?: boolean;
  /** Multiplier when another ally of the user stands next to the target. */
  readonly flankBonus?: number;
  /** Extra damage per other ally of the user next to the target (0.1 = +10% each). */
  readonly swarmBonus?: number;
  /** Turns the target's tile into this terrain character (floor and grass only). */
  readonly terrainOnHit?: string;
}

/** What a Pokémon of this type can do on the battlefield. */
export interface TypeUnitTraits {
  /** Moves over water, mud and units at a cost of 1 per tile. */
  readonly flies?: boolean;
  /** Moves through enemy units. */
  readonly phases?: boolean;
  /** Cannot be pushed or pulled. */
  readonly immovable?: boolean;
}

export interface TypeDef extends TypeProfile {
  /** One-line summary of the playstyle and mechanic, shown in the UI. */
  readonly summary?: string;
  readonly move?: TypeMoveMechanic;
  readonly unit?: TypeUnitTraits;
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
    // Level-1 stats stay within 0–10.
    out[s] = Math.min(10, Math.max(0, Math.round(avg) + (nudge[s] ?? 0)));
  }
  return out;
}
