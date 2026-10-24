import type { Point } from "../grid/types";

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
}

export interface TurnState {
  readonly unitId: string;
  movePointsLeft: number;
  actionUsed: boolean;
}

export type BattleOutcome = "ongoing" | "victory" | "defeat";

/** Plain, serializable battle state. Never mutated by the public API. */
export interface BattleState {
  readonly mapRows: readonly string[];
  units: BattleUnit[];
  round: number;
  /** Unit ids still to act this round, in order; the head is acting now. */
  queue: string[];
  turn: TurnState | null;
  outcome: BattleOutcome;
}
