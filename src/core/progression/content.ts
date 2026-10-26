import type { BaseStats } from "../battle/content";
import type { UnitModifiers } from "../battle/modifiers";

/** A mastery of a role's or type's tree; masteries of the same level are mutually exclusive. */
export interface TreeNode {
  /** Talent id, or "@type" for the Pokémon's own type talent. */
  readonly talent: string;
  /** Row: the level the node unlocks at. */
  readonly level: number;
}

export interface RoleDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Stats gained automatically per level (fractions accumulate; applied from level 1 once the role is chosen). */
  readonly growth: Partial<BaseStats>;
  /** Battle modifiers every Pokémon of this role has (its fighting style). */
  readonly mods?: Partial<UnitModifiers>;
  readonly tree: readonly TreeNode[];
}

/** A type's mastery tree, learned by Pokémon whose mastery type it is. */
export interface TypeTreeDef {
  readonly id: string;
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
  /** Type-flavoured versions of the skill by the Pokémon's type (move ids); other types learn grantsMove. */
  readonly typedMoves?: Readonly<Record<string, string>>;
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
  /** Share of a victory's XP that party members who did not fight get (Exp. Share). */
  readonly benchXpShare: number;
  /** Pokédollars per defeated enemy level. */
  readonly moneyPerEnemyLevel: number;
  /** Active moves besides the basic attack. */
  readonly maxActiveMoves: number;
  /** Pokédollars per level to forget the role and all masteries. */
  readonly respecCostPerLevel: number;
}

export interface ProgressionContent {
  readonly roles: Readonly<Record<string, RoleDef>>;
  readonly talents: Readonly<Record<string, TalentDef>>;
  readonly typeTrees: Readonly<Record<string, TypeTreeDef>>;
  readonly items: Readonly<Record<string, ItemDef>>;
  readonly rules: ProgressionRules;
  /** Key items (HMs, quest items) by id. */
  readonly keyItems?: Readonly<Record<string, { readonly id: string; readonly name: string; readonly description: string }>>;
}
