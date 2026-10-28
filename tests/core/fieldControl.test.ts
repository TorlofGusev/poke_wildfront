import { describe, expect, it } from "vitest";
import { CONTENT } from "../../src/content";
import { applyAction, createBattle, unitById, type BattleState, type UnitSetup } from "../../src/core/battle";
import { DEFAULT_AI_WEIGHTS, planTurn } from "../../src/core/ai";
import { distance, freeAim, freeReachFor, inArea, type FreeField } from "../../src/core/free";

const OPEN: FreeField = { width: 12, height: 8, zones: [] };
const u = (id: string, speciesId: string, side: "player" | "enemy", x: number, y: number, moves?: string[]): UnitSetup =>
  ({ id, speciesId, side, pos: { x, y }, ...(moves && { moves }) });
// Mastery moves cost Bond: plenty for both sides.
const start = (units: UnitSetup[]): BattleState => ({ ...createBattle(CONTENT, OPEN, units).state, bond: { player: 20, enemy: 20 } });
/** Hands the turn to `id` (tests drive turns directly). */
const turnOf = (s: BattleState, id: string, mp = 4): BattleState =>
  ({ ...s, turn: { unitId: id, movePointsLeft: mp, actionUsed: false, basicUsed: false } });
const use = (s: BattleState, unitId: string, moveId: string, x: number, y: number) =>
  applyAction(s, CONTENT, { type: "useMove", unitId, moveId, target: { x, y } });
const endTurn = (s: BattleState) => applyAction(s, CONTENT, { type: "endTurn", unitId: s.turn!.unitId });
/** Ends turns until it is `id`'s turn again. */
const until = (s: BattleState, id: string) => {
  const events = [];
  do {
    const r = endTurn(s);
    s = r.state;
    events.push(...r.events);
  } while (s.turn?.unitId !== id && s.outcome === "ongoing");
  return { state: s, events };
};

describe("cones", () => {
  it("hit everyone in the fan, foe or friend, and miss those beside it", () => {
    const s = turnOf(start([
      u("p", "charmander", "player", 3, 4, ["flamethrower"]),
      u("a", "rattata", "enemy", 4.5, 4), u("b", "rattata", "enemy", 4.6, 4.8),
      u("f", "bulbasaur", "player", 4.4, 3.2), u("c", "rattata", "enemy", 3, 6),
    ]), "p");
    const aim = freeAim(s, CONTENT, "p", "flamethrower", { x: 5, y: 4 });
    expect(aim.ok).toBe(true);
    if (!aim.ok) return;
    expect(aim.affected.map((x) => x.id).sort()).toEqual(["a", "b", "f"]);
  });
});

describe("hazards", () => {
  it("fire burns whoever walks in, friend or foe, and fades after two of its maker's turns", () => {
    let s = turnOf(start([u("p", "charmander", "player", 2, 4, ["flame-burst"]), u("e", "rattata", "enemy", 4, 4), u("x", "rattata", "enemy", 10, 1)]), "p");
    s = use(s, "p", "flame-burst", 4, 4).state;
    expect(s.hazards).toHaveLength(1);
    expect(s.hazards![0]!.kind).toBe("fire");
    // A foe walking into the fire is burnt.
    s = turnOf(s, "x", 8);
    const hp = unitById(s, "x").hp;
    const walk = applyAction(s, CONTENT, { type: "move", unitId: "x", to: { x: 4.6, y: 3.5 } });
    expect(walk.events.some((e) => e.type === "hazardTouched" && e.unitId === "x")).toBe(true);
    expect(unitById(walk.state, "x").hp).toBeLessThan(hp);
    // Two of the maker's turns later it is gone.
    s = until(until(turnOf(walk.state, "x"), "p").state, "p").state;
    expect(s.hazards ?? []).toHaveLength(0);
  });

  it("mud is real terrain while it lasts: walking through it costs more", () => {
    let s = turnOf(start([u("p", "squirtle", "player", 2, 4, ["muddy-water"]), u("e", "rattata", "enemy", 3.2, 4), u("x", "rattata", "enemy", 10, 1)]), "p");
    s = use(s, "p", "muddy-water", 3.2, 4).state;
    const mud = s.hazards!.find((h) => h.kind === "mud")!;
    expect(s.field.zones.some((z) => z.terrain === "mud")).toBe(true);
    const before = freeReachFor({ ...s, field: OPEN, turn: { ...s.turn!, unitId: "e", movePointsLeft: 3 } }, "e").cells.length;
    const after = freeReachFor({ ...s, turn: { ...s.turn!, unitId: "e", movePointsLeft: 3 } }, "e").cells.length;
    expect(after).toBeLessThan(before);
    expect(mud.turnsLeft).toBe(CONTENT.rules.zones.turns);
  });
});

describe("delayed strikes", () => {
  it("hit nothing now, then strike the marked ground at the start of the user's next turn", () => {
    let s = turnOf(start([u("p", "abra", "player", 2, 4, ["sky-attack"]), u("e", "rattata", "enemy", 3.5, 4), u("x", "rattata", "enemy", 10, 1)]), "p");
    const r = use(s, "p", "sky-attack", 3.5, 4);
    expect(r.events.some((e) => e.type === "damaged")).toBe(false);
    expect(r.events.some((e) => e.type === "strikePrepared")).toBe(true);
    const hp = unitById(r.state, "e").hp;
    const next = until(r.state, "p");
    expect(next.events.some((e) => e.type === "moveUsed" && e.unitId === "p" && e.moveId === "sky-attack")).toBe(true);
    expect(unitById(next.state, "e").hp).toBeLessThan(hp);
    expect(next.state.pending ?? []).toHaveLength(0);
  });

  it("miss a Pokémon that stepped out of the mark", () => {
    let s = turnOf(start([u("p", "abra", "player", 2, 4, ["sky-attack"]), u("e", "rattata", "enemy", 3.5, 4), u("x", "rattata", "enemy", 10, 1)]), "p");
    s = use(s, "p", "sky-attack", 3.5, 4).state;
    s = applyAction(turnOf(s, "e", 4), CONTENT, { type: "move", unitId: "e", to: { x: 5, y: 6 } }).state;
    const hp = unitById(s, "e").hp;
    const next = until(turnOf(s, "e"), "p");
    expect(unitById(next.state, "e").hp).toBe(hp);
    expect(next.events.some((e) => e.type === "strikeEnded" && e.unitId === "p")).toBe(true);
  });
});

describe("watches", () => {
  it("strike and stop the first foe moving into the watched area", () => {
    let s = turnOf(start([u("p", "rattata", "player", 4, 4, ["sucker-punch"]), u("e", "rattata", "enemy", 8, 4), u("x", "rattata", "enemy", 10, 1)]), "p");
    s = use(s, "p", "sucker-punch", 4, 4).state;
    const watch = s.pending![0]!;
    expect(watch.kind).toBe("watch");
    const hp = unitById(s, "e").hp;
    const walk = applyAction(turnOf(s, "e", 6), CONTENT, { type: "move", unitId: "e", to: { x: 3, y: 4.8 } });
    expect(walk.events.some((e) => e.type === "watchTriggered" && e.targetId === "e")).toBe(true);
    const e = unitById(walk.state, "e");
    expect(e.hp).toBeLessThan(hp);
    // Stopped where it entered, short of where it was going.
    expect(inArea(watch.area, e.pos)).toBe(true);
    expect(distance(e.pos, { x: 3, y: 4.8 })).toBeGreaterThan(0.5);
    expect(walk.state.pending ?? []).toHaveLength(0);
  });

  it("can be set on empty ground but not while engaged, and ends unused at the user's next turn", () => {
    let s = turnOf(start([u("p", "rattata", "player", 2, 2, ["sucker-punch"]), u("e", "rattata", "enemy", 9, 6), u("x", "rattata", "enemy", 10, 1)]), "p");
    expect(freeAim(s, CONTENT, "p", "sucker-punch", { x: 2, y: 2 }).ok).toBe(true);
    s = use(s, "p", "sucker-punch", 2, 2).state;
    const next = until(s, "p");
    expect(next.state.pending ?? []).toHaveLength(0);
    expect(next.events.some((e) => e.type === "strikeEnded")).toBe(true);
  });
});

describe("AI and field control", () => {
  it("prefers not to end its walk on burning ground", () => {
    let s = turnOf(start([u("p", "charmander", "player", 2, 4, ["fire-spin"]), u("e", "rattata", "enemy", 3.2, 4), u("x", "rattata", "enemy", 10, 1)]), "p");
    s = use(s, "p", "fire-spin", 3.2, 4).state;
    const ai = turnOf(s, "x", 6);
    const plan = planTurn(ai, CONTENT);
    for (const a of plan) if (a.type === "move") expect(s.hazards!.some((h) => distance(h.at, a.to) <= h.radius)).toBe(false);
  });

  it("uses a delayed strike when it is the best it has", () => {
    const s = turnOf(start([u("p", "rattata", "player", 4, 4), u("e", "abra", "enemy", 6, 4, ["sky-attack"])]), "e", 0);
    // Mastery moves cost Bond, which the AI saves: free here, to see the strike itself weighed.
    const plan = planTurn(s, CONTENT, { ...DEFAULT_AI_WEIGHTS, bondCost: 0 });
    expect(plan.some((a) => a.type === "useMove" && a.moveId === "sky-attack")).toBe(true);
  });
});
