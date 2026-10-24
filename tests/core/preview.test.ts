import { describe, expect, it } from "vitest";
import { applyAction, createBattle, previewMove } from "../../src/core/battle";
import { content } from "./fixtures";

describe("move preview", () => {
  it("predicts exactly what the move will do, without changing the state", () => {
    const { state } = createBattle(content, ["......"], [
      { id: "p", speciesId: "fast", side: "player", pos: { x: 0, y: 0 } },
      { id: "e", speciesId: "slow", side: "enemy", pos: { x: 1, y: 0 } },
    ]);
    const before = structuredClone(state);
    const preview = previewMove(state, content, "p", "shove", { x: 1, y: 0 });
    expect(state).toEqual(before);
    const real = applyAction(state, content, { type: "useMove", unitId: "p", moveId: "shove", target: { x: 1, y: 0 } });
    const dealt = real.events.filter((e) => e.type === "damaged" && e.unitId === "e").reduce((n, e) => n + (e as { amount: number }).amount, 0);
    expect(preview).toEqual([{ unitId: "e", damage: dealt, healed: 0, knockedOut: false, statuses: [], effectiveness: 1 }]);
  });

  it("flags knockouts and returns nothing for invalid targets", () => {
    const { state } = createBattle(content, ["......"], [
      { id: "p", speciesId: "fast", side: "player", pos: { x: 0, y: 0 } },
      { id: "e", speciesId: "slow", side: "enemy", pos: { x: 1, y: 0 }, hp: 3 },
    ]);
    expect(previewMove(state, content, "p", "tackle", { x: 1, y: 0 })[0]).toMatchObject({ knockedOut: true, damage: 3 });
    expect(previewMove(state, content, "p", "tackle", { x: 4, y: 0 })).toEqual([]);
  });
});
