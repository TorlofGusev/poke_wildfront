import {
  applyAction,
  livingUnits,
  reachableFor,
  unitById,
  validTargets,
  type BattleAction,
  type BattleContent,
  type BattleState,
  type BattleUnit,
} from "../battle";
import { manhattan, type Point } from "../grid/types";

export interface AiWeights {
  /** Value per HP of damage dealt to opponents. */
  readonly damage: number;
  /** Bonus for each opponent knocked out. */
  readonly knockout: number;
  /** Value per HP healed on allies. */
  readonly heal: number;
  /** Penalty per HP lost by own side (friendly fire, impact). */
  readonly ownLoss: number;
  /** Flat cost of spending an ultimate, so it is saved for big turns. */
  readonly ultimateCost: number;
  /** Value of applying a status, per turn of duration. */
  readonly statusPerTurn: number;
}

export const DEFAULT_AI_WEIGHTS: AiWeights = {
  damage: 1,
  knockout: 25,
  heal: 0.8,
  ownLoss: 1.2,
  ultimateCost: 20,
  statusPerTurn: 2,
};

interface Plan {
  readonly actions: BattleAction[];
  readonly score: number;
}

/**
 * Picks the active unit's turn as a list of actions ending with `endTurn`.
 * Exhaustively simulates every (destination, move, target) combination with the real
 * rules engine, so the AI can never attempt an illegal action and needs no separate
 * damage model. Deterministic: ties keep the first plan found in a fixed order.
 * Callers must stop applying the plan once the battle has ended.
 */
export function planTurn(
  state: BattleState,
  content: BattleContent,
  weights: AiWeights = DEFAULT_AI_WEIGHTS,
): BattleAction[] {
  const turn = state.turn;
  if (!turn) return [];
  const unitId = turn.unitId;
  const self = unitById(state, unitId);
  const species = content.species[self.speciesId]!;
  const end: BattleAction = { type: "endTurn", unitId };

  const stops: (Point | null)[] = [null, ...reachableFor(state, unitId).destinations];
  let best: Plan | null = null;

  for (const stop of stops) {
    const moveAction: BattleAction | null = stop ? { type: "move", unitId, to: stop } : null;
    const afterMove = moveAction ? applyAction(state, content, moveAction).state : state;
    for (const moveId of species.moves) {
      for (const target of validTargets(afterMove, content, unitId, moveId)) {
        const use: BattleAction = { type: "useMove", unitId, moveId, target };
        const result = applyAction(afterMove, content, use);
        let score = evaluate(state, result.state, self, weights, result.events);
        if (content.moves[moveId]!.kind === "ultimate") score -= weights.ultimateCost;
        if (score <= 0) continue;
        if (!best || score > best.score) {
          best = { actions: [...(moveAction ? [moveAction] : []), use, end], score };
        }
      }
    }
  }
  if (best) return best.actions;

  // Nothing worth doing in reach: advance towards the closest opponent.
  const opponents = livingUnits(state).filter((u) => u.side !== self.side);
  const distTo = (p: Point) => Math.min(...opponents.map((o) => manhattan(p, o.pos)));
  let bestStop: Point | null = null;
  let bestDist = distTo(self.pos);
  for (const p of reachableFor(state, unitId).destinations) {
    const d = distTo(p);
    if (d < bestDist) {
      bestDist = d;
      bestStop = p;
    }
  }
  return bestStop ? [{ type: "move", unitId, to: bestStop }, end] : [end];
}

function evaluate(
  before: BattleState,
  after: BattleState,
  self: BattleUnit,
  w: AiWeights,
  events: ReturnType<typeof applyAction>["events"],
): number {
  let score = 0;
  for (const u of before.units) {
    const now = unitById(after, u.id);
    const delta = now.hp - u.hp;
    if (u.side === self.side) {
      score += delta > 0 ? delta * w.heal : delta * w.ownLoss;
    } else {
      score += -delta * w.damage;
      if (u.hp > 0 && now.hp <= 0) score += w.knockout;
    }
  }
  for (const e of events) {
    if (e.type === "statusApplied" && unitById(after, e.unitId).side !== self.side) {
      score += e.duration * w.statusPerTurn;
    }
  }
  return score;
}
