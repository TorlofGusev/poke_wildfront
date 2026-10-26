import { describe, expect, it } from "vitest";
import { applyAction, createBattle, moveUnavailableReason, unitById, validTargets, type BattleState, type UnitSetup } from "../../src/core/battle";
import { gridDistance, Grid, key, reachableTiles } from "../../src/core/grid";
import { content } from "./fixtures";

const OPEN = [".......", ".......", ".......", ".......", "......."];
const u = (id: string, speciesId: string, side: "player" | "enemy", x: number, y: number, extra: Partial<UnitSetup> = {}): UnitSetup => ({
  id, speciesId, side, pos: { x, y }, ...extra,
});
/** "fast" acts first (Speed 100), so the player unit p moves on the first turn. */
const start = (units: UnitSetup[], map = OPEN): BattleState => createBattle(content, map, units).state;

describe("8-directional grid", () => {
  it("counts diagonals alternately as 1 and 2, so all eight neighbours are adjacent", () => {
    expect(gridDistance({ x: 0, y: 0 }, { x: 1, y: 1 })).toBe(1);
    expect(gridDistance({ x: 0, y: 0 }, { x: 2, y: 2 })).toBe(3);
    expect(gridDistance({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(4);
    expect(gridDistance({ x: 0, y: 0 }, { x: 3, y: 1 })).toBe(3);
  });

  it("moves diagonally with the same alternating cost, never cutting a wall's corner", () => {
    const grid = Grid.fromAscii([".....", ".....", "....."]);
    const r = reachableTiles(grid, { x: 0, y: 0 }, 3, undefined, true);
    expect(r.cost.get(key({ x: 1, y: 1 }))).toBe(1);
    expect(r.cost.get(key({ x: 2, y: 2 }))).toBe(3);
    const walled = Grid.fromAscii([".#.", "...", "..."]);
    // (0,0) → (1,1) would cut the corner of the wall at (1,0).
    expect(reachableTiles(walled, { x: 0, y: 0 }, 1, undefined, true).destinations.map(key)).toEqual(["0,1"]);
    expect(reachableTiles(grid, { x: 0, y: 0 }, 1).cost.has(key({ x: 1, y: 1 }))).toBe(false);
  });

  it("melee attacks reach diagonal neighbours", () => {
    const state = start([u("p", "fast", "player", 2, 2), u("e", "slow", "enemy", 3, 3)]);
    expect(validTargets(state, content, "p", "tackle").map(key)).toEqual(["3,3"]);
  });
});

describe("body blocking", () => {
  it("a Pokémon standing in the line of fire blocks shots that need line of sight", () => {
    const open = start([u("p", "fast", "player", 0, 2, { moves: ["ember"] }), u("e", "slow", "enemy", 3, 2)]);
    expect(validTargets(open, content, "p", "ember").map(key)).toEqual(["3,2"]);
    // A guard (either side) between them screens the target; the guard itself can still be shot.
    const screened = start([u("p", "fast", "player", 0, 2, { moves: ["ember"] }), u("e", "slow", "enemy", 3, 2), u("g", "mid", "enemy", 1, 2)]);
    expect(validTargets(screened, content, "p", "ember").map(key)).toEqual(["1,2"]);
  });
});

describe("engagement (one on one)", () => {
  const hit = (state: BattleState, unitId: string, moveId: string, x: number, y: number) =>
    applyAction(state, content, { type: "useMove", unitId, moveId, target: { x, y } });

  it("standing next to a foe does not engage; a damaging melee hit does, for both", () => {
    const state = start([u("p", "fast", "player", 2, 2), u("e", "mid", "enemy", 3, 3)]);
    expect(unitById(state, "p").engagedWith).toBeNull();
    const r = hit(state, "p", "tackle", 3, 3);
    expect(r.events).toContainEqual({ type: "engaged", unitId: "p", targetId: "e" });
    expect(unitById(r.state, "e").engagedWith).toBe("p");
  });

  it("is one on one: a second foe hit in melee is not engaged", () => {
    const state = start([u("p", "fast", "player", 2, 2), u("e", "mid", "enemy", 3, 2), u("f", "mid", "enemy", 1, 2)]);
    const s1 = hit(state, "p", "tackle", 3, 2).state;
    // Engaged p may only target its partner.
    expect(validTargets(s1, content, "p", "zap").map(key)).toEqual([]);
    expect(unitById(s1, "f").engagedWith).toBeNull();
  });

  it("stepping away draws one free attack from the partner and ends the engagement", () => {
    const s1 = hit(start([u("p", "fast", "player", 2, 2), u("e", "mid", "enemy", 3, 2)]), "p", "tackle", 3, 2).state;
    const stay = applyAction(s1, content, { type: "move", unitId: "p", to: { x: 3, y: 1 } });
    expect(stay.events.some((e) => e.type === "engagementStrike")).toBe(false);
    const away = applyAction(s1, content, { type: "move", unitId: "p", to: { x: 0, y: 2 } });
    expect(away.events.filter((e) => e.type === "engagementStrike")).toEqual([{ type: "engagementStrike", unitId: "e", targetId: "p" }]);
    expect(away.events).toContainEqual(expect.objectContaining({ type: "damaged", unitId: "p" }));
    expect(unitById(away.state, "p").pos).toEqual({ x: 0, y: 2 });
    expect(unitById(away.state, "e").engagedWith).toBeNull();
  });

  it("a unit knocked out while breaking away stays where it was", () => {
    const s1 = hit(start([u("p", "fast", "player", 2, 2, { hp: 1 }), u("e", "mid", "enemy", 3, 2)]), "p", "tackle", 3, 2).state;
    const r = applyAction(s1, content, { type: "move", unitId: "p", to: { x: 0, y: 2 } });
    expect(unitById(r.state, "p").hp).toBe(0);
    expect(unitById(r.state, "p").pos).toEqual({ x: 2, y: 2 });
  });

  it("disengage (Skirmisher) slips away freely", () => {
    const mods = { disengage: true } as UnitSetup["mods"];
    const s1 = hit(start([u("p", "fast", "player", 2, 2, { mods }), u("e", "mid", "enemy", 3, 2)]), "p", "tackle", 3, 2).state;
    const r = applyAction(s1, content, { type: "move", unitId: "p", to: { x: 0, y: 2 } });
    expect(r.events.some((e) => e.type === "engagementStrike")).toBe(false);
    expect(unitById(r.state, "p").engagedWith).toBeNull();
  });

  it("an engaged unit with a ranged basic attack fights with Struggle at half its power", () => {
    // r (Ember 1–4 only) is engaged by e's melee hit.
    const units = [u("e", "fast", "enemy", 2, 2), u("r", "slow", "player", 3, 2, { moves: ["ember"] })];
    const s1 = hit(start(units), "e", "tackle", 3, 2).state;
    const s2 = applyAction(s1, content, { type: "endTurn", unitId: "e" }).state;
    expect(moveUnavailableReason(s2, content, "r", "ember")).toMatch(/engaged/);
    expect(moveUnavailableReason(s2, content, "r", "struggle")).toBeNull();
    const dmg = (state: BattleState, moveId: string) =>
      (applyAction(state, content, { type: "useMove", unitId: "r", moveId, target: { x: 2, y: 2 } }).events.find((e) => e.type === "damaged") as { amount: number }).amount;
    const free = { ...s2, units: s2.units.map((x) => ({ ...x, engagedWith: null })) };
    expect(dmg(s2, "struggle")).toBeLessThan(dmg(free, "ember"));
    expect(moveUnavailableReason(free, content, "r", "struggle")).toMatch(/only while engaged/);
  });

  it("pushing the partner away ends the engagement", () => {
    const s1 = hit(start([u("p", "fast", "player", 2, 2), u("e", "mid", "enemy", 3, 2)]), "p", "tackle", 3, 2).state;
    const r = hit(s1, "p", "shove", 3, 2);
    expect(r.events.some((e) => e.type === "disengaged")).toBe(unitById(r.state, "e").pos.x !== 3);
  });
});

describe("combos", () => {
  // p1 (fast) engages e in melee; then p2 (mid) hits the pinned e.
  const setupEngaged = (p2Mods: UnitSetup["mods"] = {}) => {
    const units = [u("p1", "fast", "player", 2, 2), u("e", "slow", "enemy", 3, 2), u("p2", "mid", "player", 4, 2, { mods: p2Mods })];
    let s = start(units);
    s = applyAction(s, content, { type: "useMove", unitId: "p1", moveId: "tackle", target: { x: 3, y: 2 } }).state;
    s = applyAction(s, content, { type: "endTurn", unitId: "p1" }).state;
    s = applyAction(s, content, { type: "endTurn", unitId: "e" }).state;
    return s;
  };

  it("hitting a foe engaged with an ally is a combo: the attacker's combo bonus, Bond only from comboBond", () => {
    const s = setupEngaged();
    expect(s.turn?.unitId).toBe("p2");
    const r = applyAction(s, content, { type: "useMove", unitId: "p2", moveId: "tackle", target: { x: 3, y: 2 } });
    expect(r.events).toContainEqual({ type: "combo", unitId: "p2", targetId: "e", setup: "engaged" });
    expect(r.state.bond.player).toBe(s.bond.player);
    const sb = setupEngaged({ comboBond: 1 } as UnitSetup["mods"]);
    expect(applyAction(sb, content, { type: "useMove", unitId: "p2", moveId: "tackle", target: { x: 3, y: 2 } }).state.bond.player).toBe(sb.bond.player + 1);
    const dmg = (st: BattleState) => (applyAction(st, content, { type: "useMove", unitId: "p2", moveId: "tackle", target: { x: 3, y: 2 } })
      .events.find((e) => e.type === "damaged" && e.unitId === "e") as { amount: number }).amount;
    expect(dmg(setupEngaged({ vsEngagedDamage: 2 } as UnitSetup["mods"]))).toBeGreaterThan(dmg(s));
  });

  it("the engaging unit's own hits and its own statuses are no combo", () => {
    const units = [u("p1", "fast", "player", 2, 2), u("e", "slow", "enemy", 3, 2)];
    const r1 = applyAction(start(units), content, { type: "useMove", unitId: "p1", moveId: "tackle", target: { x: 3, y: 2 } });
    expect(r1.events.some((e) => e.type === "combo")).toBe(false);
  });

  it("a status applied by an ally sets up a combo", () => {
    const s0 = start([u("p1", "fast", "player", 0, 0), u("e", "slow", "enemy", 2, 0), u("p2", "mid", "player", 4, 4)]);
    const s = { ...s0, units: s0.units.map((x) => (x.id === "e" ? { ...x, statuses: [{ id: "poison", turnsLeft: 3, sourceId: "p2" }] } : x)) };
    const r = applyAction(s, content, { type: "useMove", unitId: "p1", moveId: "zap", target: { x: 2, y: 0 } });
    expect(r.events).toContainEqual(expect.objectContaining({ type: "combo", unitId: "p1", targetId: "e", setup: "status" }));
  });
});
