import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { type UnitSetup } from "../../src/core/battle";
import { applyAction, createBattle, validTargets } from "./hexFixture";
import { CONTENT } from "../../src/content";

const u = (id: string, speciesId: string, side: "player" | "enemy", x: number, moves: string[], extra: Partial<UnitSetup> = {}): UnitSetup =>
  ({ id, speciesId, side, pos: { x, y: 0 }, moves, stats: { ...CONTENT.species[speciesId]!.stats, speed: id === "p" ? 30 : 1 }, ...extra });
const hp = (r: ReturnType<typeof applyAction>, id: string) => r.state.units.find((x) => x.id === id)!.hp;

describe("move mechanics behind canon names", () => {
  it("every library move does something: damage or an effect", () => {
    const lib = JSON.parse(readFileSync("src/content/mastery/moves.json", "utf8")) as Record<string, { power: number; effects?: unknown[] }>;
    expect(Object.entries(lib).filter(([, m]) => !m.power && !m.effects?.length).map(([id]) => id)).toEqual([]);
  });

  it("U-turn and Flip Turn end the user's engagement after the hit", () => {
    for (const move of ["u-turn", "flip-turn"]) {
      const { state } = createBattle(CONTENT, ["....."], [u("p", "scyther", "player", 0, ["cut", move]), u("e", "rattata", "enemy", 1, ["tackle"])]);
      const engaged = { ...state, units: state.units.map((x) => ({ ...x, engagedWith: x.id === "p" ? "e" : "p" })) };
      const r = applyAction(engaged, CONTENT, { type: "useMove", unitId: "p", moveId: move, target: { x: 1, y: 0 } });
      expect(r.state.units.find((x) => x.id === "p")!.engagedWith, move).toBeFalsy();
    }
  });

  it("Dream Eater only aims at a sleeping foe and heals the user by half the damage", () => {
    const { state } = createBattle(CONTENT, ["....."], [u("p", "drowzee", "player", 0, ["pound", "dream-eater"]), u("e", "rattata", "enemy", 2, ["tackle"])], { bond: { player: { start: 6, max: 6 } } });
    expect(validTargets(state, CONTENT, "p", "dream-eater")).toEqual([]);
    const asleep = { ...state, units: state.units.map((x) => (x.id === "e" ? { ...x, statuses: [{ id: "sleep", turnsLeft: 2 }] } : { ...x, hp: x.hp - 30 })) };
    const r = applyAction(asleep, CONTENT, { type: "useMove", unitId: "p", moveId: "dream-eater", target: { x: 2, y: 0 } });
    const dealt = (r.events.find((e) => e.type === "damaged" && e.unitId === "e") as { amount: number }).amount;
    expect(hp(r, "p") - (asleep.units.find((x) => x.id === "p")!.hp)).toBe(Math.max(1, Math.round(dealt * 0.5)));
  });

  it("Pollen Puff damages a foe but heals an ally", () => {
    const { state } = createBattle(CONTENT, ["......"], [u("p", "butterfree", "player", 2, ["tackle", "pollen-puff"]), u("a", "rattata", "player", 0, ["tackle"]), u("e", "rattata", "enemy", 4, ["tackle"])]);
    const hurt = { ...state, units: state.units.map((x) => (x.id === "a" ? { ...x, hp: x.hp - 40 } : x)) };
    const onAlly = applyAction(hurt, CONTENT, { type: "useMove", unitId: "p", moveId: "pollen-puff", target: { x: 0, y: 0 } });
    expect(hp(onAlly, "a")).toBeGreaterThan(hurt.units.find((x) => x.id === "a")!.hp);
    expect(onAlly.events.some((e) => e.type === "damaged")).toBe(false);
    const onFoe = applyAction(hurt, CONTENT, { type: "useMove", unitId: "p", moveId: "pollen-puff", target: { x: 4, y: 0 } });
    expect(hp(onFoe, "e")).toBeLessThan(hurt.units.find((x) => x.id === "e")!.hp);
  });

  it("Taunt reaches 3 hexes; on its next turn the target may only attack the taunter", () => {
    const { state } = createBattle(CONTENT, ["......."], [
      u("p", "mankey", "player", 0, ["scratch", "taunt"]), u("q", "rattata", "player", 4, ["tackle"]), u("e", "rattata", "enemy", 3, ["tackle"]),
    ], { bond: { player: { start: 6, max: 6 } } });
    expect(validTargets({ ...state, turn: { ...state.turn!, unitId: "e" } }, CONTENT, "e", "tackle")).toContainEqual({ x: 4, y: 0 });
    expect(validTargets(state, CONTENT, "p", "taunt")).toContainEqual({ x: 3, y: 0 });
    const r = applyAction(state, CONTENT, { type: "useMove", unitId: "p", moveId: "taunt", target: { x: 3, y: 0 } });
    expect(r.state.units.find((x) => x.id === "e")!.statuses).toContainEqual(expect.objectContaining({ id: "taunted", sourceId: "p" }));
    const eTurn = { ...r.state, turn: { ...r.state.turn!, unitId: "e" } };
    expect(validTargets(eTurn, CONTENT, "e", "tackle")).not.toContainEqual({ x: 4, y: 0 });
  });

  it("Leech Seed drains each turn into the Pokémon that planted it; draining moves heal the user", () => {
    const { state } = createBattle(CONTENT, ["....."], [u("p", "bulbasaur", "player", 0, ["vine-whip", "leech-seed"]), u("e", "rattata", "enemy", 2, ["tackle"])]);
    const hurt = { ...state, units: state.units.map((x) => (x.id === "p" ? { ...x, hp: x.hp - 20 } : x)) };
    const seeded = applyAction(hurt, CONTENT, { type: "useMove", unitId: "p", moveId: "leech-seed", target: { x: 2, y: 0 } });
    const before = seeded.state.units.find((x) => x.id === "p")!.hp;
    const next = applyAction(seeded.state, CONTENT, { type: "endTurn", unitId: "p" });
    const lost = (next.events.find((e) => e.type === "damaged" && e.unitId === "e") as { amount: number }).amount;
    expect(next.state.units.find((x) => x.id === "p")!.hp).toBe(before + lost);
    for (const m of ["leech-life", "drain-punch", "draining-kiss"]) expect(CONTENT.moves[m]!.effects?.some((e) => e.kind === "drain"), m).toBe(true);
  });

  it("Fake Out makes the target flinch (it loses its next action), not freeze", () => {
    expect(CONTENT.moves["fake-out"]!.effects).toEqual([{ kind: "status", status: "flinched", duration: 1 }]);
    expect(CONTENT.statuses.flinched!.noAction).toBe(true);
  });

  it("abilities guard against the statuses their names promise", () => {
    expect(CONTENT.abilities.insomnia!.mods!.statusImmune).toEqual(["sleep"]);
    expect(CONTENT.abilities["clear-body"]!.mods!.statusImmune).toEqual(["weakened"]);
    for (const a of Object.values(CONTENT.abilities)) for (const s of a.mods?.statusImmune ?? []) if (s !== "*") expect(CONTENT.statuses, `${a.id}: ${s}`).toHaveProperty(s);
  });
});
