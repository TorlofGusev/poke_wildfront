import type { StatName } from "../battle/species";
import type { BaseStats } from "../battle/content";
import type { UnitModifiers } from "../battle/modifiers";

/** A focus offered at the focus level: a stat that grows every level and the Bond skill that scales with it. */
export interface FocusOption {
  readonly stat: StatName;
  /** Skill talent learned with the focus (teaches a Bond move whose damage uses `stat`). */
  readonly skill: string;
}

/**
 * A hand-made mastery tree for one evolution line (docs/design/mastery-trees.md): three focuses, then rows by
 * level, each 2–3 skills or 2–3 passives. `forms` lets a branching evolution (Eevee) replace rows per form.
 */
export interface MasteryTree {
  readonly line: readonly string[];
  readonly focus: readonly FocusOption[];
  readonly rows: Readonly<Record<string, readonly string[]>>;
  readonly forms?: Readonly<Record<string, { readonly rows: Readonly<Record<string, readonly string[]>> }>>;
}

export interface TalentDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Team-wide Bond effects while this Pokémon is deployed. */
  readonly team?: { readonly startBond?: number; readonly maxBond?: number };
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
  /** Level at which a Pokémon chooses its focus. */
  readonly focusLevel: number;
  /** Points the focus stat gets when chosen. */
  readonly focusBonus: number;
  /** The focus stat gains 1 point every this many levels. */
  readonly focusGrowthEvery: number;
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
  /** Pokédollars per level to forget the focus and all masteries. */
  readonly respecCostPerLevel: number;
}

export interface ProgressionContent {
  readonly talents: Readonly<Record<string, TalentDef>>;
  readonly items: Readonly<Record<string, ItemDef>>;
  readonly rules: ProgressionRules;
  /** Mastery trees by species id (every member of a line maps to its line's tree). */
  readonly trees: Readonly<Record<string, MasteryTree>>;
  /** Key items (HMs, quest items) by id. */
  readonly keyItems?: Readonly<Record<string, { readonly id: string; readonly name: string; readonly description: string }>>;
}
