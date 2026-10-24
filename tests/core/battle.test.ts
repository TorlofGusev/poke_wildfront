import { describe, expect, it } from "vitest";
import {
  applyAction,
  createBattle,
  IllegalActionError,
  movementPoints,
  unitById,
  validTargets,
  type BattleAction,
  type BattleState,
  type UnitSetup,
} from "../../src/core/battle";
import { key } from "../../src/core/grid";
import { content } from "./fixtures";

const OPEN = [".......", ".......", ".......", ".......", "......."];

function battle(units: UnitSetup[], map: string[] = OPEN) {
  return createBattle(content, map, units);
}

function act(state: BattleState, action: BattleAction) {
  return applyAction(state, content, action);
}

const u = (id: string, speciesId: string, side: "player" | "enemy", x: number, y: number, hp?: number): UnitSetup => ({
  id, speciesId, side, pos: { x, y }, ...(hp !== undefined && { hp }),
});

describe("battle setup and initiative", () => {
  it("orders turns by speed, ties to the player", () => {
    const { state, events } = battle([
      u("e-slow", "slow", "enemy", 6, 0),
      u("p-mid", "mid", "player", 0, 0),
      u("e-mid", "mid", "enemy", 6, 1),
      u("p-fast", "fast", "player", 0, 1),
    ]);
    expect(events[0]).toEqual({ type: "roundStarted", round: 1, order: ["p-fast", "p-mid", "e-mid", "e-slow"] });
    expect(state.turn).toEqual({ unitId: "p-fast", movePointsLeft: 5, actionUsed: false, basicUsed: false });
  });

  it("rejects invalid placements", () => {
    expect(() => battle([u("a", "fast", "player", 0, 0), u("b", "fast", "enemy", 0, 0)])).toThrow();
    expect(() => battle([u("a", "fast", "player", 0, 0)], ["#."])).toThrow();
    expect(() => battle([u("a", "nope", "player", 0, 0)])).toThrow();
  });

  it("derives movement points from speed", () => {
    const { state } = battle([u("a", "fast", "player", 0, 0), u("b", "mid", "enemy", 6, 0), u("c", "slow", "enemy", 6, 1)]);
    expect(state.units.map((x) => movementPoints(content, x))).toEqual([5, 4, 3]);
  });

  it("starts a new round after everyone acted", () => {
    let { state } = battle([u("a", "fast", "player", 0, 0), u("b", "slow", "enemy", 6, 0)]);
    state = act(state, { type: "endTurn", unitId: "a" }).state;
    expect(state.turn?.unitId).toBe("b");
    const r = act(state, { type: "endTurn", unitId: "b" });
    expect(r.state.round).toBe(2);
    expect(r.state.turn?.unitId).toBe("a");
  });
});

describe("turn economy", () => {
  it("allows splitting movement around the action", () => {
    let { state } = battle([u("a", "fast", "player", 0, 0), u("b", "slow", "enemy", 3, 0)]);
    state = act(state, { type: "move", unitId: "a", to: { x: 2, y: 0 } }).state;
    expect(state.turn?.movePointsLeft).toBe(3);
    state = act(state, { type: "useMove", unitId: "a", moveId: "tackle", target: { x: 3, y: 0 } }).state;
    state = act(state, { type: "move", unitId: "a", to: { x: 2, y: 3 } }).state;
    expect(state.turn?.movePointsLeft).toBe(0);
    expect(() => act(state, { type: "move", unitId: "a", to: { x: 2, y: 4 } })).toThrow(IllegalActionError);
  });

  it("permits one basic attack and one action per turn", () => {
    let { state } = battle([u("a", "fast", "player", 0, 0), u("b", "slow", "enemy", 1, 0)]);
    state = act(state, { type: "useMove", unitId: "a", moveId: "tackle", target: { x: 1, y: 0 } }).state;
    expect(() => act(state, { type: "useMove", unitId: "a", moveId: "tackle", target: { x: 1, y: 0 } })).toThrow(/basic attack already used/);
    state = act(state, { type: "useMove", unitId: "a", moveId: "zap", target: { x: 1, y: 0 } }).state;
    expect(() => act(state, { type: "useMove", unitId: "a", moveId: "shove", target: { x: 1, y: 0 } })).toThrow(/action already used/);
  });

  it("rejects actions from units whose turn it is not", () => {
    const { state } = battle([u("a", "fast", "player", 0, 0), u("b", "slow", "enemy", 1, 0)]);
    expect(() => act(state, { type: "endTurn", unitId: "b" })).toThrow(IllegalActionError);
  });

  it("does not mutate the input state", () => {
    const { state } = battle([u("a", "fast", "player", 0, 0), u("b", "slow", "enemy", 1, 0)]);
    const snapshot = structuredClone(state);
    act(state, { type: "useMove", unitId: "a", moveId: "tackle", target: { x: 1, y: 0 } });
    expect(state).toEqual(snapshot);
  });
});

describe("damage", () => {
  it("is deterministic and applies type effectiveness", () => {
    // ember (fire, 40) vs grass: 40 * 40/40 * 1.5 / 4 = 15
    let { state } = battle([u("p", "slow", "player", 0, 0), u("e", "slow", "enemy", 3, 0)]);
    state = act(state, { type: "endTurn", unitId: "p" }).state; // p and e both speed 30; player first
    const r = act(state, { type: "useMove", unitId: "e", moveId: "ember", target: { x: 0, y: 0 } });
    expect(r.events).toContainEqual({ type: "damaged", unitId: "p", amount: 15, hp: 25, source: "move", effectiveness: 1.5 });
  });

  it("knocks out at 0 HP and ends the battle", () => {
    const { state } = battle([u("a", "fast", "player", 0, 0), u("b", "slow", "enemy", 1, 0, 5)]);
    const r = act(state, { type: "useMove", unitId: "a", moveId: "tackle", target: { x: 1, y: 0 } });
    expect(r.events.map((e) => e.type)).toEqual(["moveUsed", "damaged", "fainted", "bondChanged", "battleEnded"]);
    expect(r.state.outcome).toBe("victory");
    expect(() => act(r.state, { type: "endTurn", unitId: "a" })).toThrow(/over/);
  });

  it("removes knocked-out units from the turn queue", () => {
    const { state } = battle([u("a", "fast", "player", 0, 0), u("b", "slow", "enemy", 1, 0, 5), u("c", "slow", "enemy", 6, 4)]);
    let s = act(state, { type: "useMove", unitId: "a", moveId: "tackle", target: { x: 1, y: 0 } }).state;
    s = act(s, { type: "endTurn", unitId: "a" }).state;
    expect(s.turn?.unitId).toBe("c");
  });
});

describe("targeting", () => {
  it("respects range and line of sight", () => {
    const map = [".....", ".....", "..#..", ".....", "....."];
    const { state } = battle([u("p", "slow", "player", 2, 0), u("e1", "slow", "enemy", 2, 4), u("e2", "slow", "enemy", 0, 2)], map);
    expect(validTargets(state, content, "p", "ember").map(key)).toEqual(["0,2"]);
  });

  it("hides enemies in grass from range but not from adjacent tiles", () => {
    const map = ['..""', "...."];
    let { state } = battle([u("p", "slow", "player", 0, 0), u("e", "slow", "enemy", 3, 0)], map);
    expect(validTargets(state, content, "p", "ember")).toEqual([]);
    state = act(state, { type: "move", unitId: "p", to: { x: 2, y: 0 } }).state;
    expect(validTargets(state, content, "p", "ember").map(key)).toEqual(["3,0"]);
  });

  it("line hits every enemy on the line until a wall", () => {
    const map = ["......#.", "........"];
    const { state } = battle(
      [u("p", "fast", "player", 0, 0), u("e1", "slow", "enemy", 1, 0), u("e2", "slow", "enemy", 3, 0), u("e3", "slow", "enemy", 7, 0), u("ally", "slow", "player", 2, 0)],
      map,
    );
    const r = act(state, { type: "useMove", unitId: "p", moveId: "zap", target: { x: 1, y: 0 } });
    expect(r.events.find((e) => e.type === "moveUsed")).toMatchObject({ affected: ["e1", "e2"] });
  });

  it("burst affects all enemies around the target tile, not allies", () => {
    const { state } = battle([
      u("p", "mid", "player", 0, 2), u("ally", "slow", "player", 3, 1),
      u("e1", "slow", "enemy", 3, 2), u("e2", "slow", "enemy", 4, 2), u("e3", "slow", "enemy", 5, 2),
    ]);
    const r = act(state, { type: "useMove", unitId: "p", moveId: "spray", target: { x: 3, y: 2 } });
    expect(r.events.find((e) => e.type === "moveUsed")).toMatchObject({ affected: ["e1", "e2"] });
  });
});

describe("cooldowns and ultimates", () => {
  it("puts specials on cooldown counted in the user's turns", () => {
    let { state } = battle([u("a", "fast", "player", 0, 0), u("b", "slow", "enemy", 1, 0), u("c", "slow", "enemy", 6, 4)]);
    state = act(state, { type: "useMove", unitId: "a", moveId: "zap", target: { x: 1, y: 0 } }).state;
    const passRound = (s: BattleState) => {
      for (const id of ["a", "b", "c"]) if (s.turn?.unitId === id) s = act(s, { type: "endTurn", unitId: id }).state;
      return s;
    };
    state = passRound(state); // round 2, a's turn: cooldown 2 → 1
    expect(unitById(state, "a").cooldowns.zap).toBe(1);
    expect(validTargets(state, content, "a", "zap")).toEqual([]);
    state = passRound(state); // round 3: cooldown 0
    expect(validTargets(state, content, "a", "zap").length).toBeGreaterThan(0);
  });

  it("allows an ultimate once per battle", () => {
    let { state } = battle([u("a", "fast", "player", 0, 0), u("b", "slow", "enemy", 1, 0), u("c", "slow", "enemy", 6, 4)]);
    state = act(state, { type: "useMove", unitId: "a", moveId: "nova", target: { x: 1, y: 0 } }).state;
    for (let i = 0; i < 3; i++) for (const id of ["a", "b", "c"]) if (state.turn?.unitId === id) state = act(state, { type: "endTurn", unitId: id }).state;
    expect(state.turn?.unitId).toBe("a");
    expect(() => act(state, { type: "useMove", unitId: "a", moveId: "nova", target: { x: 1, y: 0 } })).toThrow(/already used this battle/);
  });
});

describe("displacement", () => {
  it("pushes the target away", () => {
    const { state } = battle([u("a", "fast", "player", 0, 0), u("b", "slow", "enemy", 1, 0)]);
    const r = act(state, { type: "useMove", unitId: "a", moveId: "shove", target: { x: 1, y: 0 } });
    expect(unitById(r.state, "b").pos).toEqual({ x: 3, y: 0 });
    expect(r.events).toContainEqual({ type: "displaced", unitId: "b", from: { x: 1, y: 0 }, to: { x: 3, y: 0 }, blocked: false });
  });

  it("deals impact damage when pushed into a wall or unit", () => {
    const { state } = battle([u("a", "fast", "player", 0, 0), u("b", "slow", "enemy", 1, 0)], [".".repeat(2) + "#...."]);
    const r = act(state, { type: "useMove", unitId: "a", moveId: "shove", target: { x: 1, y: 0 } });
    expect(unitById(r.state, "b").pos).toEqual({ x: 1, y: 0 });
    expect(r.events).toContainEqual({ type: "damaged", unitId: "b", amount: 5, hp: 40 - 5 - 5, source: "impact" });
  });

  it("pulls the target towards the user and stops adjacent", () => {
    let { state } = battle([u("p", "mid", "player", 0, 0), u("e", "slow", "enemy", 4, 0)]);
    const r = act(state, { type: "useMove", unitId: "p", moveId: "lasso", target: { x: 4, y: 0 } });
    expect(unitById(r.state, "e").pos).toEqual({ x: 1, y: 0 });
    expect(r.events.some((e) => e.type === "damaged")).toBe(false);
  });
});

describe("statuses and healing", () => {
  it("poison ticks at turn start, slow reduces movement, both expire", () => {
    let { state } = battle([u("p", "mid", "player", 0, 0), u("e", "slow", "enemy", 2, 0)]);
    state = act(state, { type: "useMove", unitId: "p", moveId: "toxin", target: { x: 2, y: 0 } }).state;
    const r = act(state, { type: "endTurn", unitId: "p" });
    expect(r.events).toContainEqual({ type: "damaged", unitId: "e", amount: 5, hp: 35, source: "status" });
    expect(r.state.turn).toMatchObject({ unitId: "e", movePointsLeft: 1 });
    const r2 = act(r.state, { type: "endTurn", unitId: "e" });
    expect(r2.events).toContainEqual({ type: "statusExpired", unitId: "e", status: "slow" });
    expect(unitById(r2.state, "e").statuses).toEqual([{ id: "poison", turnsLeft: 2 }]);
  });

  it("poison can knock out a unit at the start of its turn", () => {
    let { state } = battle([u("p", "mid", "player", 0, 0), u("e", "slow", "enemy", 2, 0, 3)]);
    state = act(state, { type: "useMove", unitId: "p", moveId: "toxin", target: { x: 2, y: 0 } }).state;
    const r = act(state, { type: "endTurn", unitId: "p" });
    expect(r.state.outcome).toBe("victory");
  });

  it("heals allies (including self) without exceeding max HP", () => {
    const { state } = battle([u("p", "mid", "player", 0, 0, 30), u("e", "slow", "enemy", 6, 4)]);
    const r = act(state, { type: "useMove", unitId: "p", moveId: "mend", target: { x: 0, y: 0 } });
    expect(r.events).toContainEqual({ type: "healed", unitId: "p", amount: 10, hp: 40 });
  });
});

describe("player modifiers (fatigue)", () => {
  it("reduce player movement and damage only", () => {
    const { state } = createBattle(content, OPEN, [u("p", "slow", "player", 0, 0), u("e", "slow", "enemy", 1, 0)], {
      playerModifiers: { moveBonus: -1, damageDealt: 0.5 },
    });
    expect(state.turn?.movePointsLeft).toBe(2);
    expect(movementPoints(content, unitById(state, "e"))).toBe(3);
    const r = act(state, { type: "useMove", unitId: "p", moveId: "tackle", target: { x: 1, y: 0 } });
    // tackle normal 40 vs grass: 40 * 1 * 0.5 / 4 = 5
    expect(r.events).toContainEqual({ type: "damaged", unitId: "e", amount: 5, hp: 35, source: "move", effectiveness: 1 });
  });
});
