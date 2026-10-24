import type { Point } from "../grid/types";
import type { BaseStats } from "./content";
import type { UnitModifiers } from "./modifiers";

export type Side = "player" | "enemy";

export interface ActiveStatus {
  readonly id: string;
  /** Remaining turns of the affected unit. */
  turnsLeft: number;
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
}

export interface TurnState {
  readonly unitId: string;
  movePointsLeft: number;
  actionUsed: boolean;
}

export type BattleOutcome = "ongoing" | "victory" | "defeat" | "retreated";

/** Plain, serializable battle state. Never mutated by the public API. */
export interface BattleState {
  readonly mapRows: readonly string[];
  units: BattleUnit[];
  round: number;
  /** Unit ids still to act this round, in order; the head is acting now. */
  queue: string[];
  turn: TurnState | null;
  outcome: BattleOutcome;
  /** Seeded PRNG state; only capture rolls consume it. */
  rngState: number;
  /** Poké Balls carried into this battle, by ball id. */
  balls: Record<string, number>;
  captureAllowed: boolean;
}
