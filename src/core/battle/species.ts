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
  /** Damage multiplier against a target below half HP or carrying a harmful status (Dark). */
  readonly vsHurt?: number;
}

/** What a Pokémon of this type can do on the battlefield. */
export interface TypeUnitTraits {
  /** Moves over water, mud and units at a cost of 1 per tile. */
  readonly flies?: boolean;
  /** Moves through enemy units. */
  readonly phases?: boolean;
  /** Cannot be pushed or pulled. */
  readonly immovable?: boolean;
  /** Multiplies all damage it takes (Steel). */
  readonly damageTaken?: number;
}

export interface TypeDef extends TypeProfile {
  /** One-line summary of the playstyle and mechanic, shown in the UI. */
  readonly summary?: string;
  readonly move?: TypeMoveMechanic;
  readonly unit?: TypeUnitTraits;
}

/** Level-1 stat total of a species: 30, plus 2 for each evolution stage behind it. */
export const STAT_TOTAL = 30;
export const STAT_TOTAL_PER_STAGE = 2;

/**
 * Level-1 stats of a species: the average of its types' profiles plus the species' own nudge, shifted
 * evenly so they add up to exactly `total`, then rounded (largest remainders first, so the total holds).
 * Each stat stays within 0–10.
 */
export function speciesStats(
  types: Readonly<Record<string, TypeProfile>>, typeIds: readonly string[], nudge: Partial<BaseStats> = {}, total = STAT_TOTAL,
): BaseStats {
  const raw = STAT_NAMES.map((s) => typeIds.reduce((sum, t) => {
    const p = types[t];
    if (!p) throw new Error(`unknown type ${t}`);
    return sum + p.profile[s];
  }, 0) / typeIds.length + (nudge[s] ?? 0));
  const shift = (total - raw.reduce((a, b) => a + b, 0)) / raw.length;
  const want = raw.map((v) => Math.min(10, Math.max(0, v + shift)));
  const out = want.map(Math.floor);
  // Hand out the points left (or take back the excess) by the size of the remainders; ties in stat order.
  const order = STAT_NAMES.map((_, i) => i).sort((a, b) => (want[b]! - out[b]!) - (want[a]! - out[a]!) || a - b);
  for (let left = total - out.reduce((a, b) => a + b, 0), k = 0; left !== 0 && k < 60; k++) {
    const i = order[k % order.length]!;
    if (left > 0 && out[i]! < 10) (out[i]! += 1, left--);
    else if (left < 0 && out[i]! > 0) (out[i]! -= 1, left++);
  }
  return Object.fromEntries(STAT_NAMES.map((s, i) => [s, out[i]!])) as Record<StatName, number>;
}
