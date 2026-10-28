import { describe, expect, it } from "vitest";
import { NOVICE_AI_WEIGHTS, planTurn } from "../../src/core/ai";
import { type BattleContent, type BattleState, type MoveDef, type UnitSetup } from "../../src/core/battle";
import { applyAction, createBattle } from "./hexFixture";
import { content as base } from "./fixtures";

const selfBuff = (id: string, status: string): MoveDef => ({
  id, name: id, type: "normal", kind: "special", cooldown: 3, power: 0, range: { min: 0, max: 0 },
  requiresLineOfSight: false, shape: { kind: "single" }, affects: "allies", effects: [{ kind: "status", status, duration: 2 }],
});
const stats = { hp: 40, attack: 40, defense: 40, speed: 30, willpower: 0, crit: 0 };

/** Fixture content plus self-buff moves and species that know them. */
const content: BattleContent = {
  ...base,
  statuses: { ...base.statuses, protected: { id: "protected", name: "Protected", damageTaken: 0 }, hasted: { id: "hasted", name: "Hasted", movePenalty: -2 } },
  moves: {
    ...base.moves, protect: selfBuff("protect", "protected"), agility: selfBuff("agility", "hasted"),
    block: { id: "block", name: "Block", type: "normal", kind: "special", cooldown: 2, power: 0, range: { min: 1, max: 1 },
      requiresLineOfSight: false, shape: { kind: "single" }, affects: "enemies", effects: [{ kind: "engage" }] },
  },
  species: {
    ...base.species,
    guard: { id: "guard", name: "Guard", types: ["normal"], stats, moves: ["tackle", "zap", "protect"], captureBase: 0.5 },
    speedy: { id: "speedy", name: "Speedy", types: ["normal"], stats, moves: ["tackle", "agility"], captureBase: 0.5 },
    blocker: { id: "blocker", name: "Blocker", types: ["normal"], stats, moves: ["block"], captureBase: 0.5 },
  },
};

const u = (id: string, speciesId: string, side: "player" | "enemy", x: number, y: number, hp?: number): UnitSetup => ({
  id, speciesId, side, pos: { x, y }, ...(hp !== undefined && { hp }),
});

function enemyTurn(units: UnitSetup[], enemyId: string, map: string[]): BattleState {
  let { state } = createBattle(content, map, units);
  while (state.turn && state.turn.unitId !== enemyId) {
    state = applyAction(state, content, { type: "endTurn", unitId: state.turn.unitId }).state;
  }
  return state;
}

const usedMoves = (state: BattleState) =>
  planTurn(state, content).flatMap((a) => (a.type === "useMove" ? [a.moveId] : []));

describe("enemy AI self-buffs", () => {
  it("uses Protect when low on HP and threatened", () => {
    const state = enemyTurn([u("p", "slow", "player", 0, 0), u("e", "guard", "enemy", 6, 0, 8)], "e", ["..........."]);
    expect(usedMoves(state)).toContain("protect");
  });

  it("does not use Protect when no opponent can reach it", () => {
    const state = enemyTurn([u("p", "slow", "player", 0, 0), u("e", "guard", "enemy", 14, 0, 8)], "e", ["..............."]);
    expect(usedMoves(state)).not.toContain("protect");
  });

  it("prefers a knockout over buffing", () => {
    const state = enemyTurn(
      [u("p1", "slow", "player", 0, 0, 15), u("p2", "slow", "player", 0, 2), u("e", "guard", "enemy", 3, 0, 8)],
      "e",
      [".......", ".......", "......."],
    );
    // The knockout first; a buff may follow once nothing is left to hit.
    const moves = usedMoves(state);
    expect(moves[0]).toBe("zap");
  });

  it("uses Agility while opponents are out of reach, and still advances", () => {
    const state = enemyTurn([u("p", "slow", "player", 0, 0), u("e", "speedy", "enemy", 14, 0)], "e", ["..............."]);
    const plan = planTurn(state, content);
    expect(plan[0]?.type).toBe("move");
    expect(plan[0]!.type === "move" && plan[0]!.to.x).toBeLessThan(state.units.find((x) => x.id === "e")!.pos.x - 2);
    expect(usedMoves(state)).toContain("agility");
  });

  it("does not re-apply a buff that is already active", () => {
    const state = enemyTurn([u("p", "slow", "player", 0, 0), u("e", "speedy", "enemy", 14, 0)], "e", ["..............."]);
    state.units.find((x) => x.id === "e")!.statuses.push({ id: "hasted", turnsLeft: 2 });
    expect(usedMoves(state)).not.toContain("agility");
  });
});

describe("enemy AI combos", () => {
  const OPEN = [".......", ".......", "......."];
  it("blocks a foe only when an ally can flank it", () => {
    const alone = enemyTurn([u("p", "slow", "player", 0, 1), u("b", "blocker", "enemy", 1, 1)], "b", OPEN);
    expect(usedMoves(alone)).not.toContain("block");
    const withAlly = enemyTurn([u("p", "slow", "player", 0, 1), u("b", "blocker", "enemy", 1, 1), u("a", "slow", "enemy", 3, 1)], "b", OPEN);
    expect(usedMoves(withAlly)).toContain("block");
  });
});

describe("novice AI", () => {
  it("plays legal, repeatable turns and skips combo setups", () => {
    const OPEN = [".......", ".......", "......."];
    const s = enemyTurn([u("p", "slow", "player", 0, 1), u("b", "blocker", "enemy", 1, 1), u("a", "slow", "enemy", 3, 1)], "b", OPEN);
    const plan = planTurn(s, content, NOVICE_AI_WEIGHTS);
    expect(planTurn(s, content, NOVICE_AI_WEIGHTS)).toEqual(plan);
    expect(plan.flatMap((a) => (a.type === "useMove" ? [a.moveId] : []))).not.toContain("block");
    let st = s;
    for (const a of plan) st = applyAction(st, content, a).state;
    expect(st.turn?.unitId).not.toBe("b");
  });
});
