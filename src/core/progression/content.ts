import type { BaseStats } from "../battle/content";
import type { UnitModifiers } from "../battle/modifiers";

export interface RoleDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Role-specific talents, each can be taken once. */
  readonly talents: readonly string[];
}

export interface TalentDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Plain stat talents can be taken repeatedly and belong to every role. */
  readonly stackable?: boolean;
  /** Earliest level at which the talent is offered. */
  readonly minLevel?: number;
  /** Only offered to Pokémon of this type. */
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
  readonly kind: "held" | "potion" | "candy";
  readonly price: number;
  /** Held items: battle modifiers. */
  readonly mods?: Partial<UnitModifiers>;
  /** Potions: HP restored. */
  readonly heal?: number;
}

export interface ProgressionRules {
  /** Level at which a Pokémon chooses its role. Every level after that gives one talent pick. */
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
