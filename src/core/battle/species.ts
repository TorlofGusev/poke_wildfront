import type { BaseStats } from "./content";

export type StatName = keyof BaseStats;
export const STAT_NAMES: readonly StatName[] = ["hp", "attack", "defense", "speed", "willpower", "crit"];

export interface TypeProfile {
  /** Level-1 stats of a Pokémon of this type (the type's playstyle); its Speed comes from the role instead. */
  readonly profile: BaseStats;
  /** −1 slow, 0, +1 fast: added to the role's Speed. */
  readonly speedLean?: number;
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
 * Level-1 stats of a species. Speed is set apart: the role's base (`roleSpeed`, melee faster) plus its types'
 * average lean (−1/0/+1, rounded away from zero) and the species' own Speed nudge, kept within 1–8. The rest is
 * the average of its types' profiles plus the nudge, shifted evenly so everything adds up to exactly `total`,
 * then rounded (largest remainders first, so the total holds). The other stats stay within `min`–`max`
 * (no extremes: a first form tops out at 8). Without a role Speed is shared out like the other stats.
 */
export function speciesStats(
  types: Readonly<Record<string, TypeProfile>>, typeIds: readonly string[], nudge: Partial<BaseStats> = {}, total = STAT_TOTAL, roleSpeed?: number,
  { min, max }: { min: number; max: number } = { min: 0, max: 10 },
): BaseStats {
  const profiles = typeIds.map((t) => {
    const p = types[t];
    if (!p) throw new Error(`unknown type ${t}`);
    return p;
  });
  let speed: number | undefined;
  if (roleSpeed !== undefined) {
    const lean = profiles.reduce((sum, p) => sum + (p.speedLean ?? 0), 0) / profiles.length;
    speed = Math.min(8, Math.max(1, roleSpeed + Math.sign(lean) * Math.round(Math.abs(lean)) + (nudge.speed ?? 0)));
  }
  const names = STAT_NAMES.filter((s) => speed === undefined || s !== "speed");
  const rest = total - (speed ?? 0);
  const raw = names.map((s) => profiles.reduce((sum, p) => sum + p.profile[s], 0) / profiles.length + (nudge[s] ?? 0));
  const shift = (rest - raw.reduce((a, b) => a + b, 0)) / raw.length;
  const want = raw.map((v) => Math.min(max, Math.max(min, v + shift)));
  const out = want.map(Math.floor);
  // Hand out the points left (or take back the excess) by the size of the remainders; ties in stat order.
  const order = names.map((_, i) => i).sort((a, b) => (want[b]! - out[b]!) - (want[a]! - out[a]!) || a - b);
  for (let left = rest - out.reduce((a, b) => a + b, 0), k = 0; left !== 0 && k < 60; k++) {
    const i = order[k % order.length]!;
    if (left > 0 && out[i]! < max) (out[i]! += 1, left--);
    else if (left < 0 && out[i]! > min) (out[i]! -= 1, left++);
  }
  const stats = Object.fromEntries(names.map((s, i) => [s, out[i]!])) as Record<StatName, number>;
  return speed === undefined ? stats : { ...stats, speed };
}
