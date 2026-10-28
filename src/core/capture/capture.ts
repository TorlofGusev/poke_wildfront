import { unitAt, unitById } from "../battle/battle";
import type { BattleContent } from "../battle/content";
import type { BattleState, BattleUnit } from "../battle/state";
import type { Point } from "../grid/types";
import { distance, MELEE_REACH, sightBlocked } from "../free/field";

/** Success probability of one throw; see docs/design/phase3-capture-and-death.md. */
export function captureChance(content: BattleContent, target: BattleUnit, ballId: string): number {
  const rules = content.capture;
  const ball = content.balls[ballId];
  if (!ball) throw new Error(`Unknown ball '${ballId}'`);
  const base = content.species[target.speciesId]!.captureBase;
  const hpFraction = target.hp / target.maxHp;
  const hpFactor = 1 + Math.max(0, rules.hpThreshold - hpFraction) / rules.hpThreshold;
  const statusMult = target.statuses.length > 0 ? rules.statusBonus : 1;
  const raw = base * ball.multiplier * hpFactor * statusMult;
  return Math.min(rules.maxChance, Math.max(rules.minChance, raw));
}

/** Whether the target is weak enough to be captured at all. */
export function isCapturable(content: BattleContent, target: BattleUnit): boolean {
  return target.side === "enemy" && target.hp > 0 && !target.captured && target.hp / target.maxHp < content.capture.hpThreshold;
}

/** Why the throw is illegal right now, or null if it can be attempted. */
export function captureUnavailableReason(
  state: BattleState,
  content: BattleContent,
  unitId: string,
  ballId: string,
  target: Point,
): string | null {
  if (!state.captureAllowed) return "capture is not possible in this battle";
  if (state.turn?.unitId !== unitId) return "not this unit's turn";
  if (state.turn.actionUsed) return "action already used this turn";
  const self = unitById(state, unitId);
  if (self.statuses.some((st) => content.statuses[st.id]?.noAction)) return "cannot act this turn";
  if (!content.balls[ballId]) return "unknown ball";
  if ((state.balls[ballId] ?? 0) <= 0) return `no ${content.balls[ballId]!.name} left`;
  const victim = unitAt(state, target);
  if (!victim || victim.side === "player") return "no wild Pokémon there";
  if (!isCapturable(content, victim)) return `target must be below ${Math.round(content.capture.hpThreshold * 100)}% HP`;
  const user = unitById(state, unitId);
  const { min, max } = content.capture.throwRange;
  // Range is a distance (a step of slack at the far end); rocks and bushes block sight.
  const d = distance(user.pos, target);
  if (d > max + 0.3 || (min >= 2 && d < MELEE_REACH)) return `out of throwing range (${min}–${max})`;
  if (sightBlocked(state.field, user.pos, target)) return "no line of sight";
  return null;
}

/** Positions of the Pokémon the unit could throw the given ball right now. */
export function captureTargets(state: BattleState, content: BattleContent, unitId: string, ballId: string): Point[] {
  return state.units
    .filter((u) => u.side === "enemy" && u.hp > 0 && !u.captured)
    .map((u) => u.pos)
    .filter((p) => captureUnavailableReason(state, content, unitId, ballId, p) === null);
}
