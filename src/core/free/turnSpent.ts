import { activeUnit, moveUnavailableReason } from "../battle/battle";
import type { BattleContent } from "../battle/content";
import type { BattleState } from "../battle/state";
import { captureTargets } from "../capture/capture";
import { freeHasTarget } from "./freeBattle";

/** Movement below this cannot take a meaningful step. */
export const MIN_STEP = 0.5;

/**
 * The active Pokémon has nothing left this turn: it has done something, cannot walk any more, no move
 * has a target in reach, and no ball can be thrown. The turn may then pass on its own.
 */
export function turnSpent(state: BattleState, content: BattleContent): boolean {
  const turn = state.turn;
  if (state.outcome !== "ongoing" || !turn || turn.fresh || turn.movePointsLeft >= MIN_STEP) return false;
  const unit = activeUnit(state);
  if (!unit) return false;
  // Too little movement left to walk, so a move only counts while something is already in its reach.
  if (unit.moves.some((m) => !moveUnavailableReason(state, content, unit.id, m) && freeHasTarget(state, content, unit.id, m))) return false;
  return turn.actionUsed || !state.captureAllowed
    || !Object.keys(state.balls).some((b) => (state.balls[b] ?? 0) > 0 && captureTargets(state, content, unit.id, b).length > 0);
}
