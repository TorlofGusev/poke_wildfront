import { describe, expect, it } from "vitest";
import { applyAction, createBattle, unitById, type BattleState, type UnitSetup } from "../../src/core/battle";
import { captureChance, captureTargets, captureUnavailableReason } from "../../src/core/capture";
import { nextRandom } from "../../src/core/rng";
import { content } from "./fixtures";

const u = (id: string, speciesId: string, side: "player" | "enemy", x: number, y: number, hp?: number): UnitSetup => ({
  id, speciesId, side, pos: { x, y }, ...(hp !== undefined && { hp }),
});

function wild(enemyHp: number, opts: { seed?: number; balls?: Record<string, number>; captureAllowed?: boolean } = {}) {
  return createBattle(content, ["......", "......"], [u("p", "fast", "player", 0, 0), u("e", "slow", "enemy", 2, 0, enemyHp), u("e2", "slow", "enemy", 5, 1)], {
    seed: opts.seed ?? 42, balls: opts.balls ?? { "poke-ball": 3, "ultra-ball": 1 }, captureAllowed: opts.captureAllowed ?? true,
  }).state;
}

describe("rng", () => {
  it("is deterministic and in [0, 1)", () => {
    let s = 7;
    const values: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const r = nextRandom(s);
      s = r.state;
      values.push(r.value);
    }
    expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(nextRandom(7)).toEqual(nextRandom(7));
  });
});

describe("capture chance", () => {
  const unit = (hp: number, statuses: { id: string; turnsLeft: number }[] = []) => ({ ...unitById(wild(hp), "e"), statuses });

  it("grows as HP drops and with better balls and statuses", () => {
    expect(captureChance(content, unit(19), "poke-ball")).toBeCloseTo(0.5 * (1 + (0.5 - 19 / 40) / 0.5));
    expect(captureChance(content, unit(4), "poke-ball")).toBeGreaterThan(captureChance(content, unit(19), "poke-ball"));
    expect(captureChance(content, unit(19), "ultra-ball")).toBeGreaterThan(captureChance(content, unit(19), "poke-ball"));
    expect(captureChance(content, unit(19, [{ id: "poison", turnsLeft: 1 }]), "poke-ball"))
      .toBeGreaterThan(captureChance(content, unit(19), "poke-ball"));
  });

  it("is clamped so every species stays capturable but never certain", () => {
    expect(captureChance(content, unit(1), "ultra-ball")).toBe(0.95);
    const hard = { ...content, species: { ...content.species, slow: { ...content.species.slow!, captureBase: 0 } } };
    expect(captureChance(hard, unit(19), "poke-ball")).toBe(0.05);
  });
});

describe("throwing balls", () => {
  it("requires the target below 50% HP", () => {
    expect(captureUnavailableReason(wild(20), content, "p", "poke-ball", { x: 2, y: 0 })).toMatch(/below 50%/);
    expect(captureUnavailableReason(wild(19), content, "p", "poke-ball", { x: 2, y: 0 })).toBeNull();
  });

  it("requires balls, a wild battle, range and the unit's action", () => {
    expect(captureUnavailableReason(wild(10, { balls: {} }), content, "p", "poke-ball", { x: 2, y: 0 })).toMatch(/no Poké Ball left/);
    expect(captureUnavailableReason(wild(10, { captureAllowed: false }), content, "p", "poke-ball", { x: 2, y: 0 })).toMatch(/not possible/);
    const far = createBattle(content, ["......"], [u("p", "fast", "player", 0, 0), u("e", "slow", "enemy", 5, 0, 5)], { captureAllowed: true, balls: { "poke-ball": 1 } }).state;
    expect(captureUnavailableReason(far, content, "p", "poke-ball", { x: 5, y: 0 })).toMatch(/range/);
    const used = applyAction(wild(30), content, { type: "useMove", unitId: "p", moveId: "zap", target: { x: 2, y: 0 } }).state;
    expect(captureUnavailableReason(used, content, "p", "poke-ball", { x: 2, y: 0 })).toMatch(/action already used/);
    expect(captureTargets(wild(10), content, "p", "poke-ball")).toEqual([{ x: 2, y: 0 }]);
  });

  it("always consumes the ball and uses the action", () => {
    let state: BattleState = wild(19);
    const r = applyAction(state, content, { type: "throwBall", unitId: "p", ballId: "poke-ball", target: { x: 2, y: 0 } });
    expect(r.state.balls["poke-ball"]).toBe(2);
    expect(r.state.turn?.actionUsed).toBe(true);
    const thrown = r.events.find((e) => e.type === "ballThrown");
    expect(thrown).toMatchObject({ targetId: "e", ballId: "poke-ball" });
    state = r.state;
    expect(state.rngState).not.toBe(wild(19).rngState);
  });

  it("is reproducible with the same seed and differs across seeds", () => {
    const results = (seed: number) =>
      applyAction(wild(19, { seed }), content, { type: "throwBall", unitId: "p", ballId: "poke-ball", target: { x: 2, y: 0 } }).events;
    expect(results(1)).toEqual(results(1));
    const outcomes = new Set(Array.from({ length: 40 }, (_, i) => (results(i).find((e) => e.type === "ballThrown") as { success: boolean }).success));
    expect(outcomes).toEqual(new Set([true, false]));
  });

  it("removes a caught Pokémon from the field and wins when none remain", () => {
    const state = createBattle(content, ["......"], [u("p", "fast", "player", 0, 0), u("e", "slow", "enemy", 1, 0, 1)], {
      captureAllowed: true, balls: { "ultra-ball": 5 }, seed: 3,
    }).state;
    let s = state;
    for (let i = 0; i < 20 && s.outcome === "ongoing"; i++) {
      const r = applyAction(s, content, { type: "throwBall", unitId: "p", ballId: "ultra-ball", target: { x: 1, y: 0 } });
      s = r.state;
      if (s.outcome === "ongoing") s = applyAction(applyAction(s, content, { type: "endTurn", unitId: "p" }).state, content, { type: "endTurn", unitId: "e" }).state;
    }
    expect(s.outcome).toBe("victory");
    expect(unitById(s, "e").captured).toBe(true);
  });
});

describe("retreat", () => {
  it("ends the battle immediately on a player turn", () => {
    const r = applyAction(wild(40), content, { type: "retreat", unitId: "p" });
    expect(r.state.outcome).toBe("retreated");
    expect(r.events).toEqual([{ type: "battleEnded", outcome: "retreated" }]);
  });
});
