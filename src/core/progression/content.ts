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
  /** Percent stat increases (0.1 = +10%); speed is flat. */
  readonly stats?: Partial<BaseStats>;
  readonly mods?: Partial<UnitModifiers>;
}

export interface ItemDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly kind: "held" | "potion";
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
  /** Fraction of base stats gained per level above 1. */
  readonly statGrowth: number;
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
