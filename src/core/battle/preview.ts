import { applyAction, unitById, validTargets } from "./battle";
import type { BattleContent } from "./content";
import type { BattleState } from "./state";
import { samePoint, type Point } from "../grid/types";

export interface HitPreview {
  readonly unitId: string;
  /** Total damage this unit would take (including pushes into obstacles). */
  readonly damage: number;
  readonly healed: number;
  readonly knockedOut: boolean;
  readonly statuses: readonly string[];
  /** Type effectiveness of the move against this unit, if it deals damage. */
  readonly effectiveness?: number;
}

/**
 * Exactly what a move would do if used now. Combat has no randomness, so this simply
 * plays the action on a copy of the state and reads the resulting events.
 */
export function previewMove(state: BattleState, content: BattleContent, unitId: string, moveId: string, target: Point): HitPreview[] {
  if (!validTargets(state, content, unitId, moveId).some((p) => samePoint(p, target))) return [];
  const { events } = applyAction(state, content, { type: "useMove", unitId, moveId, target });
  const byUnit = new Map<string, { damage: number; healed: number; knockedOut: boolean; statuses: string[]; effectiveness?: number }>();
  const entry = (id: string) => {
    if (!byUnit.has(id)) byUnit.set(id, { damage: 0, healed: 0, knockedOut: false, statuses: [] });
    return byUnit.get(id)!;
  };
  for (const e of events) {
    if (e.type === "damaged") {
      const x = entry(e.unitId);
      x.damage += e.amount;
      if (e.effectiveness !== undefined && x.effectiveness === undefined) x.effectiveness = e.effectiveness;
    } else if (e.type === "healed") entry(e.unitId).healed += e.amount;
    else if (e.type === "fainted") entry(e.unitId).knockedOut = true;
    else if (e.type === "statusApplied") entry(e.unitId).statuses.push(e.status);
  }
  // Order: the user's own changes (drain) last.
  return [...byUnit.entries()]
    .sort(([a], [b]) => (a === unitId ? 1 : 0) - (b === unitId ? 1 : 0) || unitById(state, a).pos.y - unitById(state, b).pos.y)
    .map(([id, v]) => ({ unitId: id, ...v }));
}
