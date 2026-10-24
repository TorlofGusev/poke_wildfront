import type { PokemonType, TypeChartData } from "../rules/typeChart";

export interface BaseStats {
  readonly hp: number;
  readonly attack: number;
  readonly defense: number;
  readonly speed: number;
}

export interface SpeciesDef {
  readonly id: string;
  readonly name: string;
  readonly types: readonly PokemonType[];
  readonly stats: BaseStats;
  readonly moves: readonly string[];
}

/** basic: once per turn, free. special: has a cooldown. ultimate: once per battle (Valour later). */
export type MoveKind = "basic" | "special" | "ultimate";

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
  readonly effects?: readonly MoveEffect[];
}

export interface StatusDef {
  readonly id: string;
  readonly name: string;
  /** Fraction of max HP lost at the start of the unit's turn. */
  readonly damagePerTurn?: number;
  /** Movement points removed while active. */
  readonly movePenalty?: number;
}

export interface BattleRules {
  /** Damage = max(1, round(power * attack / defense * typeMultiplier / damageDivisor)). */
  readonly damageDivisor: number;
  /** Damage taken when pushed into an obstacle or another unit. */
  readonly impactDamage: number;
  /** Speed thresholds → movement points, highest first. */
  readonly movementBySpeed: readonly { readonly minSpeed: number; readonly move: number }[];
}

export interface BattleContent {
  readonly species: Readonly<Record<string, SpeciesDef>>;
  readonly moves: Readonly<Record<string, MoveDef>>;
  readonly statuses: Readonly<Record<string, StatusDef>>;
  readonly typeChart: TypeChartData;
  readonly rules: BattleRules;
}
