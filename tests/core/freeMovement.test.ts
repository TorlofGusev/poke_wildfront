import { describe, expect, it } from "vitest";
import { CONTENT } from "../../src/content";
import { applyAction, createBattle, moveUnavailableReason, unitById, type BattleState, type UnitSetup } from "../../src/core/battle";
import { planTurn } from "../../src/core/ai";
import {
  distance, freeAim, freeReach, freeReachFor, previewFreeWalk, UNIT_RADIUS, type FreeField,
} from "../../src/core/free";
import { PROTO_FIELD, PROTO_UNITS } from "./freeFixture";

const OPEN: FreeField = { width: 12, height: 8, zones: [] };
const u = (id: string, speciesId: string, side: "player" | "enemy", x: number, y: number): UnitSetup => ({ id, speciesId, side, pos: { x, y } });
const start = (units: UnitSetup[], field = OPEN): BattleState => createBattle(CONTENT, field, units).state;
/** Hands the turn to `id` with `mp` movement points (tests drive turns directly). */
const turnOf = (s: BattleState, id: string, mp = 4): BattleState =>
  ({ ...s, turn: { unitId: id, movePointsLeft: mp, actionUsed: false, basicUsed: false } });

describe("free movement: reach", () => {
  it("walks its movement points in a straight line on open ground", () => {
    const r = freeReach(OPEN, { x: 2, y: 4 }, 3, [], false);
    expect(r.costTo({ x: 5, y: 4 })).toBeCloseTo(3, 1);
    expect(r.costTo({ x: 5.6, y: 4 })).toBeNull();
  });

  it("mud costs double", () => {
    const field: FreeField = { width: 12, height: 8, zones: [{ terrain: "mud", poly: [{ x: 3, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 8 }, { x: 3, y: 8 }] }] };
    const r = freeReach(field, { x: 2, y: 4 }, 3, [], false);
    // 1 unit of grass, then 1 unit of mud (2 points).
    expect(r.costTo({ x: 4, y: 4 })).toBeCloseTo(3, 1);
    expect(r.costTo({ x: 4.6, y: 4 })).toBeNull();
    // Fliers skim over it.
    expect(freeReach(field, { x: 2, y: 4 }, 3, [], true).costTo({ x: 4.6, y: 4 })).not.toBeNull();
  });

  it("walks around rock, which costs extra distance", () => {
    const field: FreeField = { width: 12, height: 8, zones: [{ terrain: "rock", poly: [{ x: 4, y: 2 }, { x: 5, y: 2 }, { x: 5, y: 6 }, { x: 4, y: 6 }] }] };
    const r = freeReach(field, { x: 2, y: 4 }, 4, [], false);
    expect(r.costTo({ x: 6, y: 4 })).toBeNull();
    expect(freeReach(field, { x: 2, y: 4 }, 8, [], false).costTo({ x: 6, y: 4 })).toBeGreaterThan(4.5);
  });

  it("foes block the way; allies can be crossed but not stopped on", () => {
    const wall = [3, 4, 5].map((y) => ({ pos: { x: 4, y }, passable: false }));
    expect(freeReach(OPEN, { x: 2, y: 4 }, 4, wall, false).costTo({ x: 6, y: 4 })).toBeNull();
    const allies = wall.map((b) => ({ ...b, passable: true }));
    const r = freeReach(OPEN, { x: 2, y: 4 }, 4, allies, false);
    expect(r.costTo({ x: 5.5, y: 4 })).not.toBeNull();
    expect(r.costTo({ x: 4, y: 4 })).toBeNull();
  });
});

describe("free movement: attacks", () => {
  it("rock blocks the line of sight of a ranged move", () => {
    const field: FreeField = { width: 12, height: 8, zones: [{ terrain: "rock", poly: [{ x: 4.6, y: 3 }, { x: 5.4, y: 3 }, { x: 5.4, y: 5 }, { x: 4.6, y: 5 }] }] };
    const s = turnOf(start([u("p", "charmander", "player", 4, 4), u("e", "rattata", "enemy", 6, 4)], field), "p");
    expect(freeAim(s, CONTENT, "p", "ember", { x: 6, y: 4 })).toMatchObject({ ok: false, reason: "no line of sight" });
    const clear = turnOf(start([u("p", "charmander", "player", 4, 6), u("e", "rattata", "enemy", 6, 6)], field), "p");
    expect(freeAim(clear, CONTENT, "p", "ember", { x: 6, y: 6 }).ok).toBe(true);
  });

  it("melee needs touching range; Ember (range 2) cannot shoot point blank", () => {
    const fighter = { ...u("p", "charmander", "player", 4, 4), moves: ["scratch", "ember"] };
    const s = turnOf(start([fighter, u("e", "rattata", "enemy", 5, 4)]), "p");
    expect(freeAim(s, CONTENT, "p", "scratch", { x: 5, y: 4 }).ok).toBe(true);
    expect(freeAim(s, CONTENT, "p", "ember", { x: 5, y: 4 })).toMatchObject({ ok: false, reason: "too close" });
    const far = turnOf(start([fighter, u("e", "rattata", "enemy", 5.6, 4)]), "p");
    expect(freeAim(far, CONTENT, "p", "scratch", { x: 5.6, y: 4 })).toMatchObject({ ok: false, reason: "out of range" });
  });
});

describe("free movement: friendly fire", () => {
  const shot = (allyX: number, allyY = 4) =>
    turnOf(start([u("p", "charmander", "player", 2, 4), u("a", "squirtle", "player", allyX, allyY), u("e", "rattata", "enemy", 4.2, 4)]), "p");

  it("an ally in the 30° cone may catch a ranged shot, and does not block the line of sight", () => {
    const aim = freeAim(shot(3.5), CONTENT, "p", "ember", { x: 4.2, y: 4 });
    expect(aim.ok && aim.interceptor?.id).toBe("a");
    const hit = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const s = { ...shot(3.5), rngState: seed * 7919 };
      const r = applyAction(s, CONTENT, { type: "useMove", unitId: "p", moveId: "ember", target: { x: 4.2, y: 4 } });
      for (const id of ["a", "e"]) if (unitById(r.state, id).hp < unitById(s, id).hp) hit.add(id);
    }
    expect([...hit].sort()).toEqual(["a", "e"]);
  });

  it("the catch chance grows towards the cone's centre and towards the target", () => {
    const chance = (x: number, y: number) => {
      const aim = freeAim(shot(x, y), CONTENT, "p", "ember", { x: 4.2, y: 4 });
      return aim.ok ? aim.interceptChance ?? 0 : -1;
    };
    expect(chance(3.55, 4)).toBeGreaterThan(chance(3.0, 4));
    expect(chance(3.6, 4)).toBeGreaterThan(chance(3.6, 4.2));
    expect(chance(3.6, 4.2)).toBeGreaterThan(0);
  });

  it("an ally a step away, still within melee reach, can catch it", () => {
    const aim = freeAim(shot(3.1), CONTENT, "p", "ember", { x: 4.2, y: 4 });
    expect(aim.ok && aim.interceptor?.id).toBe("a");
  });

  it("an ally touching the shooter or outside the cone never catches it", () => {
    for (const s of [shot(2.65), shot(3.5, 5)]) {
      const aim = freeAim(s, CONTENT, "p", "ember", { x: 4.2, y: 4 });
      expect(aim.ok && aim.interceptor).toBe(undefined);
    }
  });
});

describe("free movement: engagement", () => {
  const engaged = () => {
    // Growlithe: a melee line (a ranged one could only scuffle while engaged).
    const s = turnOf(start([u("p", "growlithe", "player", 4, 4), u("e", "geodude", "enemy", 5, 4)]), "p");
    const hit = applyAction(s, CONTENT, { type: "useMove", unitId: "p", moveId: "bite", target: { x: 5, y: 4 } });
    expect(unitById(hit.state, "p").engagedWith).toBe("e");
    return hit.state;
  };

  it("a melee hit engages; walking near the foe (not engaged) costs nothing extra", () => {
    const s = turnOf(start([u("p", "rattata", "player", 2, 4), u("e", "geodude", "enemy", 5, 4)]), "p");
    const r = applyAction(s, CONTENT, { type: "move", unitId: "p", to: { x: 4, y: 4 } });
    expect(r.events.some((e) => e.type === "engagementStrike")).toBe(false);
    expect(unitById(r.state, "p").engagedWith).toBeNull();
  });

  it("any step, even one staying in reach, draws the free attack and ends the engagement", () => {
    const r = applyAction(engaged(), CONTENT, { type: "move", unitId: "p", to: { x: 4.4, y: 3.3 } });
    expect(r.events.some((e) => e.type === "engagementStrike")).toBe(true);
    expect(unitById(r.state, "p").engagedWith).toBeNull();
  });

  it("an engaged ranged Pokémon can only scuffle (Struggle) until it steps away", () => {
    const s = turnOf(start([u("p", "growlithe", "player", 4, 4), u("e", "squirtle", "enemy", 5, 4)]), "p");
    const hit = applyAction(s, CONTENT, { type: "useMove", unitId: "p", moveId: "bite", target: { x: 5, y: 4 } }).state;
    const theirs = turnOf(hit, "e");
    expect(unitById(theirs, "e").engagedWith).toBe("p");
    for (const m of unitById(theirs, "e").moves.filter((x) => x !== "struggle")) expect(moveUnavailableReason(theirs, CONTENT, "e", m)).toMatch(/only Struggle/);
    expect(moveUnavailableReason(theirs, CONTENT, "e", "struggle")).toBeNull();
  });

  it("an engaging hit pulls the pair together until they touch", () => {
    const s = turnOf(start([u("p", "growlithe", "player", 4, 4), u("e", "rattata", "enemy", 5.2, 4)]), "p");
    const r = applyAction(s, CONTENT, { type: "useMove", unitId: "p", moveId: "bite", target: { x: 5.2, y: 4 } });
    const gap = distance(unitById(r.state, "p").pos, unitById(r.state, "e").pos);
    expect(gap).toBeLessThan(UNIT_RADIUS * 2 + 0.15);
    expect(gap).toBeGreaterThanOrEqual(UNIT_RADIUS * 2);
  });

  it("leaving the partner's reach draws its free attack and ends the engagement", () => {
    const s = engaged();
    expect(previewFreeWalk(s, CONTENT, "p", { x: 2, y: 4 }).find((h) => h.unitId === "p")?.damage).toBeGreaterThan(0);
    const r = applyAction(s, CONTENT, { type: "move", unitId: "p", to: { x: 2, y: 4 } });
    expect(r.events.some((e) => e.type === "engagementStrike")).toBe(true);
    expect(unitById(r.state, "p").engagedWith).toBeNull();
  });
});

describe("free movement: prototype battle", () => {
  it("the AI plays the prototype arena to an end with legal actions", () => {
    let s = createBattle(CONTENT, PROTO_FIELD, PROTO_UNITS).state;
    for (let i = 0; i < 200 && s.outcome === "ongoing"; i++)
      for (const a of planTurn(s, CONTENT)) if (s.outcome === "ongoing") s = applyAction(s, CONTENT, a).state;
    expect(s.outcome).not.toBe("ongoing");
    // A whole battle of AI turns: slow on a CI runner.
  }, 60_000);

  it("every start spot is free and reachable ground", () => {
    const s = createBattle(CONTENT, PROTO_FIELD, PROTO_UNITS).state;
    expect(freeReachFor(s, s.turn!.unitId).cells.length).toBeGreaterThan(50);
  });
});
