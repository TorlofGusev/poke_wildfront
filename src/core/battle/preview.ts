import type { BattleEvent } from "./events";

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

/** Per unit: what a batch of events did to it (damage, healing, knockout, statuses). */
export function summarizeHits(events: readonly BattleEvent[]): HitPreview[] {
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
  return [...byUnit.entries()].map(([id, v]) => ({ unitId: id, ...v }));
}
