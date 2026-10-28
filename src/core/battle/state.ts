import type { Point } from "../grid/types";
import type { FreeField } from "../free/field";
import type { FreeArea } from "../free/field";
import type { AbilityDef, BaseStats, HazardKind } from "./content";
import type { UnitModifiers } from "./modifiers";
import type { TypeUnitTraits } from "./species";

export type Side = "player" | "enemy";

export interface ActiveStatus {
  readonly id: string;
  /** Remaining turns of the affected unit. */
  turnsLeft: number;
  /** The unit that applied it (combos reward exploiting an ally's setup). */
  sourceId?: string;
}

export interface BattleUnit {
  readonly id: string;
  readonly speciesId: string;
  readonly side: Side;
  readonly maxHp: number;
  hp: number;
  pos: Point;
  statuses: ActiveStatus[];
  /** moveId → turns until usable again. */
  cooldowns: Record<string, number>;
  /** Ultimate moves already spent this battle. */
  usedUltimates: string[];
  /** Caught in a Poké Ball and removed from the field. */
  captured: boolean;
  readonly level: number;
  /** Effective stats for this battle (level, talents and items applied); hp here is unused, see maxHp. */
  readonly stats: BaseStats;
  /** Moves usable in this battle. */
  readonly moves: readonly string[];
  /** Fixed modifiers for this battle (fatigue, held item, talents). */
  readonly mods: UnitModifiers;
  /** Battlefield traits from its types. */
  readonly traits: TypeUnitTraits;
  readonly ability: AbilityDef | null;
  /** Spirit bar (0 to rules.willpower.spiritMax), filled by hits and knockouts. */
  spirit: number;
  /** Battle-long Attack bonus (Anger Point). */
  attackBoost: number;
  /** Sturdy has already saved it this battle. */
  sturdyUsed: boolean;
  /** Fury Cutter: the foe it hit last, and how many hits in a row. */
  furyTarget: string | null;
  furyStreak: number;
  /** The foe it is engaged with (always mutual), or null. */
  engagedWith: string | null;
  /** Round whose start-of-turn effects (cooldowns, damage over time, healing) it already had. */
  startedRound?: number;
}

export interface TurnState {
  readonly unitId: string;
  movePointsLeft: number;
  /** A ball has been thrown this turn (one a turn). */
  actionUsed: boolean;
  /** The basic attack is separate from the action: one of each per turn. */
  basicUsed: boolean;
  /** The unit has moved this turn (Speed's momentum bonus). */
  moved?: boolean;
  /** Nothing done yet: the player may still hand the turn to another of their units. */
  fresh?: boolean;
}

export type BattleOutcome = "ongoing" | "victory" | "defeat" | "retreated";

/** Burning, poisoned or muddy ground a move left; it fades after its maker's next turns. */
export interface Hazard {
  readonly id: number;
  readonly kind: HazardKind;
  readonly at: Point;
  readonly radius: number;
  readonly sourceId: string;
  turnsLeft: number;
  /** Mud is real terrain while it lasts: the patch it added to the field. */
  readonly poly?: readonly Point[];
}

/** A delayed strike waiting for its user's next turn, or an area a unit watches until then. */
export interface PendingStrike {
  readonly kind: "delayed" | "watch";
  readonly unitId: string;
  readonly moveId: string;
  readonly area: FreeArea;
  readonly target: Point;
}

/** Plain, serializable battle state. Never mutated by the public API. */
export interface BattleState {
  /** Terrain rows; some type mechanics reshape them during battle. */
  /** The battlefield: Pokémon stand anywhere on it. Terrain-changing hits add patches. */
  field: FreeField;
  units: BattleUnit[];
  round: number;
  /** Unit ids still to act this round, in order; the head is acting now. */
  queue: string[];
  /** The enemies' turn order, rolled once at the start of the battle. */
  enemyOrder?: readonly string[];
  turn: TurnState | null;
  outcome: BattleOutcome;
  /** Team Bond points per side, spent by bond moves. */
  bond: Record<Side, number>;
  bondMax: Record<Side, number>;
  /** Seeded PRNG state: capture rolls, critical hits and status resistance consume it. */
  rngState: number;
  /** Poké Balls carried into this battle, by ball id. */
  balls: Record<string, number>;
  captureAllowed: boolean;
  hazards?: Hazard[];
  pending?: PendingStrike[];
}
