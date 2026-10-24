import type { PokemonType, TypeChartData } from "../rules/typeChart";
import type { UnitModifiers } from "./modifiers";
import type { TypeDef } from "./species";

export interface BaseStats {
  readonly hp: number;
  readonly attack: number;
  readonly defense: number;
  readonly speed: number;
}

export interface SpeciesDef {
  readonly id: string;
  /** National Pokédex number (used for sprites). */
  readonly dex?: number;
  readonly name: string;
  readonly types: readonly PokemonType[];
  readonly stats: BaseStats;
  readonly moves: readonly string[];
  /** Base capture chance before ball, HP and status modifiers (0–1). */
  readonly captureBase: number;
  /** Moves learned on reaching a level (in addition to `moves`, known from the start). */
  readonly learnset?: readonly { readonly level: number; readonly move: string }[];
  /** The two roles this species can specialise into. */
  readonly roles?: readonly string[];
  readonly evolution?: { readonly level: number; readonly into: string };
  readonly ability?: string;
}

/**
 * basic: the free attack. special: has a cooldown. ultimate: once per battle.
 * bond: costs the team's shared Bond points (the name is a content term, see terms.json).
 * A unit uses one of them per turn.
 */
export type MoveKind = "basic" | "special" | "ultimate" | "bond";

export type TargetShape =
  | { readonly kind: "single" }
  /** All tiles within `radius` (Manhattan) of the target tile. */
  | { readonly kind: "burst"; readonly radius: number }
  /** Straight line from the user towards the target, `length` tiles long. Target must be orthogonal. */
  | { readonly kind: "line"; readonly length: number };

export type MoveEffect =
  | { readonly kind: "push"; readonly distance: number }
  | { readonly kind: "pull"; readonly distance: number }
  | { readonly kind: "status"; readonly status: string; readonly duration: number }
  | { readonly kind: "heal"; readonly amount: number };

export interface MoveDef {
  readonly id: string;
  readonly name: string;
  readonly type: PokemonType;
  readonly kind: MoveKind;
  /** 0 for pure utility moves. */
  readonly power: number;
  readonly range: { readonly min: number; readonly max: number };
  readonly requiresLineOfSight: boolean;
  readonly shape: TargetShape;
  /** Which units the move affects. */
  readonly affects: "enemies" | "allies";
  /** Turns before a special can be used again (special moves only). */
  readonly cooldown?: number;
  /** Team Bond points spent (bond moves only). */
  readonly bondCost?: number;
  readonly effects?: readonly MoveEffect[];
}

export interface StatusDef {
  readonly id: string;
  readonly name: string;
  /** Fraction of max HP lost at the start of the unit's turn. */
  readonly damagePerTurn?: number;
  /** Movement points removed while active. */
  readonly movePenalty?: number;
  /** Cannot move at all while active (Paralysis). */
  readonly noMove?: boolean;
  /** Cannot use moves or balls while active (Freeze). */
  readonly noAction?: boolean;
  /** Multiplies damage dealt by the affected unit (Burn). */
  readonly damageDealt?: number;
  /** Multiplies damage taken by the affected unit (Curse). */
  readonly damageTaken?: number;
  /** Re-applying adds the durations instead of keeping the longer one (Poison). */
  readonly stacks?: boolean;
}

/**
 * Combat formulas (see docs/design/identity-and-stats-proposal.md):
 * - Max HP = hpBase + hpPerPoint × HP
 * - Damage = max(1, round(power × (statOffset + Atk) / (statOffset + Def) × multipliers / damageDivisor))
 * - Movement = min(moveMax, moveBase + ⌊Speed / speedPerMove⌋)
 */
export interface BattleRules {
  readonly hpBase: number;
  readonly hpPerPoint: number;
  readonly statOffset: number;
  readonly damageDivisor: number;
  readonly moveBase: number;
  readonly speedPerMove: number;
  readonly moveMax: number;
  /** Damage taken when pushed into an obstacle or another unit. */
  readonly impactDamage: number;
  /** Team Bond: default start and cap per side, and the gain per knockout. */
  readonly bond: { readonly start: number; readonly max: number; readonly perKnockout: number };
}

export interface BallDef {
  readonly id: string;
  readonly name: string;
  readonly multiplier: number;
  /** Poké Mart price in Pokédollars. */
  readonly price?: number;
}

export interface CaptureRules {
  /** Capture is possible below this HP fraction. */
  readonly hpThreshold: number;
  readonly minChance: number;
  readonly maxChance: number;
  /** Multiplier when the target has any status effect. */
  readonly statusBonus: number;
  readonly throwRange: { readonly min: number; readonly max: number };
}

/** A species line's innate passive (as in the main games). */
export interface AbilityDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly mods?: Partial<UnitModifiers>;
  /** Melee attackers that hit this Pokémon receive this status. */
  readonly contactStatus?: { readonly status: string; readonly duration: number };
  /** Moves of a type also inflict a status. */
  readonly moveStatus?: { readonly type: string; readonly status: string; readonly duration: number };
  /** Once per battle, a knockout blow leaves it at 1 HP instead. */
  readonly sturdy?: boolean;
  /** Can target Pokémon hidden in tall grass from range. */
  readonly keenEye?: boolean;
  /** +1 Attack for the rest of the battle each time it is damaged (max +3). */
  readonly angerPoint?: boolean;
  /** Enemies that start their turn next to it cannot move. */
  readonly arenaTrap?: boolean;
}

/** Player-facing names of setting-specific concepts, kept in data so the setting can be swapped. */
export interface Terms {
  readonly bond: string;
  readonly bondDescription: string;
  readonly food: string;
  readonly healCenter: string;
  readonly healCenterDescription: string;
}

export interface BattleContent {
  readonly terms: Terms;
  readonly abilities: Readonly<Record<string, AbilityDef>>;
  readonly species: Readonly<Record<string, SpeciesDef>>;
  readonly moves: Readonly<Record<string, MoveDef>>;
  readonly statuses: Readonly<Record<string, StatusDef>>;
  readonly typeChart: TypeChartData;
  /** Type playstyles: stat profiles and type mechanics. */
  readonly types: Readonly<Record<string, TypeDef>>;
  readonly rules: BattleRules;
  readonly balls: Readonly<Record<string, BallDef>>;
  readonly capture: CaptureRules;
}
