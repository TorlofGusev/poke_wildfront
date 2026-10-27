import { describe, expect, it } from "vitest";
import {
  applyAction,
  createBattle,
  movementPoints,
  reachableFor,
  unitById,
  type BattleContent,
  type BattleState,
  type MoveDef,
  type TypeDef,
  type UnitSetup,
} from "../../src/core/battle";
import { key } from "../../src/core/grid";
import { content as base } from "./fixtures";

const single = { kind: "single" } as const;
const move = (id: string, type: string, power = 40, range = 1): MoveDef => ({
  id, name: id, type, kind: "basic", power, range: { min: 1, max: range }, requiresLineOfSight: false, shape: single, affects: "enemies",
});

/** Fixture content with one test species per type and the given type mechanics. */
function withTypes(types: Record<string, Partial<TypeDef>>): BattleContent {
  const t: Record<string, TypeDef> = { ...base.types };
  for (const [id, def] of Object.entries(types)) t[id] = { profile: { hp: 5, attack: 5, defense: 5, speed: 5, willpower: 0, crit: 0 }, ...def };
  const species = { ...base.species };
  const moves = { ...base.moves };
  for (const id of Object.keys(t)) {
    moves[`${id}-hit`] = move(`${id}-hit`, id);
    species[id] = { id, name: id, types: [id], stats: { hp: 40, attack: 40, defense: 40, speed: 50, willpower: 0, crit: 0 }, moves: [`${id}-hit`, "tackle"], captureBase: 0.5 };
  }
  return {
    ...base, types: t, species, moves,
    statuses: {
      ...base.statuses,
      poison: { ...base.statuses.poison!, stacks: true },
      burn: { id: "burn", name: "Burn", damagePerTurn: 0.1, damageDealt: 0.5 },
      paralysis: { id: "paralysis", name: "Paralysis", noMove: true },
      freeze: { id: "freeze", name: "Freeze", noAction: true },
      curse: { id: "curse", name: "Curse", damageTaken: 2 },
    },
  };
}

const u = (id: string, speciesId: string, side: "player" | "enemy", x: number, y: number, extra: Partial<UnitSetup> = {}): UnitSetup => ({
  id, speciesId, side, pos: { x, y }, ...extra,
});

function hit(c: BattleContent, state: BattleState, unitId: string, moveId: string, x: number, y: number) {
  return applyAction(state, c, { type: "useMove", unitId, moveId, target: { x, y } });
}
const damageTo = (events: ReturnType<typeof hit>["events"], id: string) =>
  (events.find((e) => e.type === "damaged" && e.unitId === id) as { amount: number } | undefined)?.amount ?? 0;

const OPEN = ["......", "......", "......"];

describe("type mechanics", () => {
  it("Normal moves are never resisted", () => {
    const c = withTypes({ normal: { move: { neverResisted: true } }, rock: {} });
    const { state } = createBattle(c, OPEN, [u("p", "normal", "player", 0, 0), u("e", "rock", "enemy", 1, 0)]);
    const r = hit(c, state, "p", "normal-hit", 1, 0);
    expect(r.events).toContainEqual(expect.objectContaining({ type: "damaged", unitId: "e", effectiveness: 1 }));
  });

  it("Fire burns: damage over time and weaker attacks", () => {
    const c = withTypes({ fire: { move: { appliesStatus: { status: "burn", duration: 2 } } } });
    let { state } = createBattle(c, OPEN, [u("p", "fire", "player", 0, 0), u("e", "normal", "enemy", 1, 0)]);
    state = hit(c, state, "p", "fire-hit", 1, 0).state;
    expect(unitById(state, "e").statuses).toMatchObject([{ id: "burn", turnsLeft: 2 }]);
    const r = applyAction(state, c, { type: "endTurn", unitId: "p" });
    expect(r.events).toContainEqual(expect.objectContaining({ type: "damaged", unitId: "e", source: "status" }));
    const burned = hit(c, r.state, "e", "tackle", 0, 0);
    // tackle 40 × 40/40 / 4 = 10, halved by the test burn.
    expect(damageTo(burned.events, "p")).toBe(5);
  });

  it("Water pushes 1 extra tile; Rock cannot be moved", () => {
    const c = withTypes({ water: { move: { extraPush: 1 } }, rock: { unit: { immovable: true } } });
    const { state } = createBattle(c, OPEN, [u("p", "water", "player", 0, 0), u("e", "normal", "enemy", 1, 0), u("r", "rock", "enemy", 0, 1)]);
    expect(unitById(hit(c, state, "p", "water-hit", 1, 0).state, "e").pos).toEqual({ x: 2, y: 0 });
    expect(unitById(hit(c, state, "p", "water-hit", 0, 1).state, "r").pos).toEqual({ x: 0, y: 1 });
  });

  it("Grass drains HP back to the user", () => {
    const c = withTypes({ grass: { move: { drain: 0.5 } } });
    const { state } = createBattle(c, OPEN, [u("p", "grass", "player", 0, 0, { hp: 20 }), u("e", "normal", "enemy", 1, 0)]);
    const r = hit(c, state, "p", "grass-hit", 1, 0);
    expect(r.events).toContainEqual({ type: "healed", unitId: "p", amount: 5, hp: 25 });
  });

  it("Electric paralyzes: no movement next turn, attacks still allowed", () => {
    const c = withTypes({ electric: { move: { appliesStatus: { status: "paralysis", duration: 1 } } } });
    let { state } = createBattle(c, OPEN, [u("p", "electric", "player", 0, 0), u("e", "normal", "enemy", 1, 0)]);
    state = hit(c, state, "p", "electric-hit", 1, 0).state;
    state = applyAction(state, c, { type: "endTurn", unitId: "p" }).state;
    expect(state.turn).toMatchObject({ unitId: "e", movePointsLeft: 0 });
    expect(() => hit(c, state, "e", "tackle", 0, 0)).not.toThrow();
    state = applyAction(state, c, { type: "endTurn", unitId: "e" }).state;
    expect(unitById(state, "e").statuses).toEqual([]);
  });

  it("Ice freezes: no action next turn, movement still allowed", () => {
    const c = withTypes({ ice: { move: { appliesStatus: { status: "freeze", duration: 1 } } } });
    let { state } = createBattle(c, OPEN, [u("p", "ice", "player", 0, 0), u("e", "normal", "enemy", 1, 0)]);
    state = hit(c, state, "p", "ice-hit", 1, 0).state;
    state = applyAction(state, c, { type: "endTurn", unitId: "p" }).state;
    expect(() => hit(c, state, "e", "tackle", 0, 0)).toThrow(/freeze/i);
    expect(movementPoints(c, unitById(state, "e"))).toBeGreaterThan(0);
  });

  it("Fighting flanks and Bug swarms when allies stand next to the target", () => {
    const c = withTypes({ fighting: { move: { flankBonus: 1.5 } }, bug: { move: { swarmBonus: 0.5 } } });
    const alone = createBattle(c, OPEN, [u("p", "fighting", "player", 0, 1), u("e", "normal", "enemy", 1, 1)]).state;
    const flanked = createBattle(c, OPEN, [u("p", "fighting", "player", 0, 1), u("z", "normal", "player", 2, 1), u("e", "normal", "enemy", 1, 1)]).state;
    expect(damageTo(hit(c, flanked, "p", "fighting-hit", 1, 1).events, "e")).toBe(Math.round(damageTo(hit(c, alone, "p", "fighting-hit", 1, 1).events, "e") * 1.5));
    const swarm = createBattle(c, OPEN, [u("p", "bug", "player", 0, 1), u("z", "normal", "player", 2, 1), u("y", "normal", "player", 1, 0), u("e", "normal", "enemy", 1, 1)]).state;
    expect(damageTo(hit(c, swarm, "p", "bug-hit", 1, 1).events, "e")).toBe(20); // 10 × (1 + 0.5 × 2)
  });

  it("Poison stacks its duration", () => {
    const c = withTypes({});
    let { state } = createBattle(c, OPEN, [u("p", "mid", "player", 0, 0), u("e", "slow", "enemy", 1, 0)]);
    state = applyAction(state, c, { type: "useMove", unitId: "p", moveId: "toxin", target: { x: 1, y: 0 } }).state;
    expect(unitById(state, "e").statuses.find((s) => s.id === "poison")!.turnsLeft).toBe(3);
  });

  it("Ground turns the target's tile into mud", () => {
    const c = withTypes({ ground: { move: { terrainOnHit: "m" } } });
    const { state } = createBattle(c, OPEN, [u("p", "ground", "player", 0, 0), u("e", "normal", "enemy", 1, 0)]);
    const r = hit(c, state, "p", "ground-hit", 1, 0);
    expect(r.state.mapRows[0]![1]).toBe("m");
    expect(r.events).toContainEqual({ type: "terrainChanged", pos: { x: 1, y: 0 }, terrain: "m" });
  });

  it("Flying crosses water and passes over units; Ghost passes through enemies", () => {
    const c = withTypes({ flying: { unit: { flies: true } }, ghost: { unit: { phases: true } } });
    const map = ["..~..", "....."];
    const flyer = createBattle(c, map, [u("p", "flying", "player", 0, 0), u("e", "normal", "enemy", 4, 1)]).state;
    expect(reachableFor(flyer, "p").destinations.map(key)).toContain("3,0");
    const walker = createBattle(c, ["....."], [u("p", "normal", "player", 0, 0), u("e", "slow", "enemy", 1, 0)]).state;
    expect(reachableFor(walker, "p").destinations.map(key)).not.toContain("2,0");
    const ghost = createBattle(c, ["....."], [u("p", "ghost", "player", 0, 0), u("e", "slow", "enemy", 1, 0)]).state;
    expect(reachableFor(ghost, "p").destinations.map(key)).toContain("2,0");
    expect(reachableFor(ghost, "p").destinations.map(key)).not.toContain("1,0");
  });

  it("Psychic pulls; Ghost curses; Dragon ignores Defense", () => {
    const raw = withTypes({
      psychic: { move: { extraPull: 1 } },
      ghost: { move: { appliesStatus: { status: "curse", duration: 2 } } },
      dragon: { move: { ignoresDefense: true } },
    });
    const c = { ...raw, moves: { ...raw.moves, "psychic-hit": move("psychic-hit", "psychic", 40, 3) } };
    const pull = createBattle(c, OPEN, [u("p", "psychic", "player", 0, 0), u("e", "normal", "enemy", 3, 0)]).state;
    expect(unitById(hit(c, pull, "p", "psychic-hit", 3, 0).state, "e").pos).toEqual({ x: 2, y: 0 });
    let s = createBattle(c, OPEN, [u("p", "ghost", "player", 0, 0), u("e", "normal", "enemy", 1, 0)]).state;
    s = hit(c, s, "p", "ghost-hit", 1, 0).state;
    expect(unitById(s, "e").statuses.map((x) => x.id)).toEqual(["curse"]);
    const tank = { stats: { hp: 40, attack: 40, defense: 400, speed: 50, willpower: 0, crit: 0 }, maxHp: 200, hp: 200 };
    const vsTank = createBattle(c, OPEN, [u("p", "dragon", "player", 0, 0), u("e", "normal", "enemy", 1, 0, tank)]).state;
    // Ignoring Defense with statOffset 0 would divide by zero; real content uses an offset of 10.
    const withOffset = { ...c, rules: { ...c.rules, statOffset: 10 } };
    expect(damageTo(hit(withOffset, vsTank, "p", "dragon-hit", 1, 0).events, "e")).toBe(50); // 40 × 50/10 / 4
  });
});
