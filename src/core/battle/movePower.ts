import type { BattleRules, MoveDef } from "./content";

/**
 * Power of a move from its canon power (all hits of a multi-hit move added up), so moves keep their
 * canon proportions: the canon value is compressed (huge moves would end fights in one hit), then
 * scaled by what the move can do here. Reach, areas and lines hit more often, so they hit softer;
 * a basic attack can be used every turn; Bond moves and ultimates are paid for, so they hit harder.
 * Nothing goes past `max`.
 */
export function powerFromCanon(rules: BattleRules["movePower"], move: Pick<MoveDef, "kind" | "range" | "shape">, canonPower: number): number {
  const f = rules;
  const shape = move.shape.kind === "burst" ? (move.shape.radius >= 2 ? f.burst2 : f.burst1)
    : move.shape.kind === "line" ? f.line : 1;
  const reach = move.range.max >= 3 ? f.range3 : move.range.max === 2 ? f.range2 : 1;
  const kind = move.kind === "basic" ? f.basic : move.kind === "bond" || move.kind === "ultimate" ? f.paid : 1;
  const raw = f.scale * canonPower ** f.exponent * shape * reach * kind;
  return Math.min(f.max, Math.max(f.round, Math.round(raw / f.round) * f.round));
}
