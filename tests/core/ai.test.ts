import { describe, expect, it } from "vitest";
import { planTurn } from "../../src/core/ai";
import { type BattleState, type UnitSetup } from "../../src/core/battle";
import { applyAction, createBattle } from "./hexFixture";
import { content } from "./fixtures";

const u = (id: string, speciesId: string, side: "player" | "enemy", x: number, y: number, hp?: number): UnitSetup => ({
  id, speciesId, side, pos: { x, y }, ...(hp !== undefined && { hp }),
});

/** Starts a battle and skips player turns until the given enemy acts. */
function enemyTurn(units: UnitSetup[], enemyId: string, map = [".......", ".......", "......."]): BattleState {
  let { state } = createBattle(content, map, units);
  while (state.turn && state.turn.unitId !== enemyId) {
    state = applyAction(state, content, { type: "endTurn", unitId: state.turn.unitId }).state;
  }
  return state;
}

function runPlan(state: BattleState) {
  const plan = planTurn(state, content);
  let s = state;
  for (const a of plan) if (s.outcome === "ongoing") s = applyAction(s, content, a).state;
  return { plan, state: s };
}

describe("enemy AI", () => {
  it("always produces a legal turn ending with endTurn", () => {
    const state = enemyTurn([u("p", "slow", "player", 0, 1), u("e", "fast", "enemy", 6, 1)], "e");
    const { plan } = runPlan(state);
    expect(plan.at(-1)).toEqual({ type: "endTurn", unitId: "e" });
  });

  it("moves in and attacks when a target is reachable", () => {
    const state = enemyTurn([u("p", "slow", "player", 0, 1), u("e", "fast", "enemy", 5, 1)], "e");
    const { plan } = runPlan(state);
    const types = plan.map((a) => a.type);
    expect(types[0]).toBe("move");
    expect(types.at(-1)).toBe("endTurn");
    expect(types.filter((x) => x === "useMove").length).toBeGreaterThanOrEqual(2);
  });

  it("prefers finishing off a low-HP target", () => {
    const state = enemyTurn(
      [u("p1", "slow", "player", 2, 0), u("p2", "slow", "player", 2, 2, 5), u("e", "fast", "enemy", 2, 1)],
      "e",
    );
    const { state: after } = runPlan(state);
    expect(after.units.find((x) => x.id === "p2")!.hp).toBe(0);
  });

  it("advances when nothing is in reach", () => {
    const state = enemyTurn(
      [u("p", "slow", "player", 0, 0), u("e", "slow", "enemy", 12, 0)],
      "e",
      ["............."],
    );
    const { plan, state: after } = runPlan(state);
    expect(plan[0]?.type).toBe("move");
    // Slow walks 2.9 (test rules) straight at the player.
    const before = state.units.find((x) => x.id === "e")!.pos;
    const now = after.units.find((x) => x.id === "e")!.pos;
    expect(before.x - now.x).toBeGreaterThan(2.3);
  });

  it("is deterministic", () => {
    const units = [u("p1", "slow", "player", 0, 0), u("p2", "mid", "player", 0, 2), u("e", "fast", "enemy", 5, 1)];
    expect(planTurn(enemyTurn(units, "e"), content)).toEqual(planTurn(enemyTurn(units, "e"), content));
  });

  it("can play a full battle to completion without errors", () => {
    let { state } = createBattle(content, [".......", "...#...", "......."], [
      u("p1", "fast", "player", 0, 0), u("p2", "mid", "player", 0, 2),
      u("e1", "slow", "enemy", 6, 0), u("e2", "mid", "enemy", 6, 2),
    ]);
    // Both sides driven by the AI.
    for (let i = 0; i < 500 && state.outcome === "ongoing"; i++) {
      for (const a of planTurn(state, content)) {
        if (state.outcome !== "ongoing") break;
        state = applyAction(state, content, a).state;
      }
    }
    expect(state.outcome).not.toBe("ongoing");
  });
});
