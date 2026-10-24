import type { BaseStats } from "../battle/content";
import type { UnitModifiers } from "../battle/modifiers";

/** A node of a role's talent tree. */
export interface TreeNode {
  /** Talent id, or "@type" for the Pokémon's own type talent. */
  readonly talent: string;
  /** Row: the level the node unlocks at. */
  readonly level: number;
  /** Column 0–2 (layout only). */
  readonly col: number;
  /** Learnable once ANY of these is learned (empty = a root). */
  readonly requires?: readonly string[];
}

export interface RoleDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly tree: readonly TreeNode[];
}

export interface TalentDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Team-wide Bond effects while this Pokémon is deployed. */
  readonly team?: { readonly startBond?: number; readonly maxBond?: number };
  /** Type talent: what "@type" resolves to for Pokémon of this type. */
  readonly requiresType?: string;
  /** Teaches this move (a new skill). */
  readonly grantsMove?: string;
  /** Flat stat points added. */
  readonly stats?: Partial<BaseStats>;
  readonly mods?: Partial<UnitModifiers>;
}

export interface ItemDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly kind: "held" | "potion" | "candy" | "food" | "remedy";
  readonly price: number;
  /** Held items: battle modifiers. */
  readonly mods?: Partial<UnitModifiers>;
  /** Potions: HP restored. */
  readonly heal?: number;
  /** Remedies: knockout marks removed. */
  readonly clearsKnockouts?: number;
}

export interface ProgressionRules {
  /** Level at which a Pokémon can choose its role. */
  readonly roleLevel: number;
  /** Levels that give one talent point. */
  readonly talentLevels: readonly number[];
  readonly maxLevel: number;
  /** XP needed to go from level L to L+1 = L × xpPerLevel. */
  readonly xpPerLevel: number;
  /** Free stat points gained per level. */
  readonly pointsPerLevel: number;
  /** Free stat points gained on evolving. */
  readonly evolutionPoints: number;
  /** Extra points when a Candy is used with a stat point. */
  readonly candyBonus: number;
  /** Candies earned per won battle. */
  readonly candiesPerVictory: number;
  /** XP each deployed Pokémon earns per defeated enemy level. */
  readonly xpPerEnemyLevel: number;
  /** Pokédollars per defeated enemy level. */
  readonly moneyPerEnemyLevel: number;
  /** Active moves besides the basic attack. */
  readonly maxActiveMoves: number;
}

export interface ProgressionContent {
  readonly roles: Readonly<Record<string, RoleDef>>;
  readonly talents: Readonly<Record<string, TalentDef>>;
  readonly items: Readonly<Record<string, ItemDef>>;
  readonly rules: ProgressionRules;
}
