import { describe, expect, it } from "vitest";
import { applyAction, createBattle, unitById, validTargets, type AbilityDef, type BattleContent, type UnitSetup } from "../../src/core/battle";
import { CONTENT } from "../../src/content";
import { content as base } from "./fixtures";

/** Fixture content where species "slow" has the given ability. */
function withAbility(def: Omit<AbilityDef, "id" | "name" | "description">): BattleContent {
  return {
    ...base,
    abilities: { test: { id: "test", name: "Test", description: "", ...def } },
    species: { ...base.species, slow: { ...base.species.slow!, ability: "test" } },
  };
}
const u = (id: string, speciesId: string, side: "player" | "enemy", x: number, y: number, extra: Partial<UnitSetup> = {}): UnitSetup => ({
  id, speciesId, side, pos: { x, y }, ...extra,
});

describe("abilities", () => {
  it("Sturdy survives one knockout blow at 1 HP", () => {
    const c = withAbility({ sturdy: true });
    let { state } = createBattle(c, ["...."], [u("p", "fast", "player", 0, 0), u("e", "slow", "enemy", 1, 0, { hp: 5 })]);
    const r = applyAction(state, c, { type: "useMove", unitId: "p", moveId: "tackle", target: { x: 1, y: 0 } });
    expect(unitById(r.state, "e").hp).toBe(1);
    expect(r.events).toContainEqual({ type: "abilityTriggered", unitId: "e", ability: "test" });
    state = r.state;
    expect(unitById(state, "e").sturdyUsed).toBe(true);
  });

  it("Static-style contact status punishes melee attackers only", () => {
    const c = withAbility({ contactStatus: { status: "slow", duration: 1 } });
    const { state } = createBattle(c, ["....."], [u("p", "fast", "player", 0, 0), u("e", "slow", "enemy", 1, 0)]);
    const r = applyAction(state, c, { type: "useMove", unitId: "p", moveId: "tackle", target: { x: 1, y: 0 } });
    expect(unitById(r.state, "p").statuses.map((s) => s.id)).toEqual(["slow"]);
  });

  it("Keen Eye targets Pokémon hidden in tall grass", () => {
    const c = withAbility({ keenEye: true });
    // The Keen Eye user acts first thanks to its Speed; the foe hides in grass 3 tiles away.
    const fastStats = { hp: 40, attack: 40, defense: 40, speed: 200 };
    const { state } = createBattle(c, ['...""'], [u("p", "slow", "player", 0, 0, { stats: fastStats }), u("e", "fast", "enemy", 3, 0)]);
    expect(validTargets(state, c, "p", "ember").length).toBe(1);
    const plain = createBattle(base, ['...""'], [u("p", "slow", "player", 0, 0, { stats: fastStats }), u("e", "fast", "enemy", 3, 0)]).state;
    expect(validTargets(plain, base, "p", "ember")).toEqual([]);
  });

  it("Anger Point raises Attack each time it is hit, up to +3", () => {
    const c = withAbility({ angerPoint: true });
    let { state } = createBattle(c, ["...."], [u("p", "fast", "player", 0, 0), u("e", "slow", "enemy", 1, 0, { hp: 40 })]);
    state = applyAction(state, c, { type: "useMove", unitId: "p", moveId: "tackle", target: { x: 1, y: 0 } }).state;
    expect(unitById(state, "e").attackBoost).toBe(1);
  });

  it("Arena Trap pins adjacent enemies in place", () => {
    const c = withAbility({ arenaTrap: true });
    const { state } = createBattle(c, ["....."], [u("p", "fast", "player", 1, 0), u("e", "slow", "enemy", 2, 0)]);
    expect(state.turn).toMatchObject({ unitId: "p", movePointsLeft: 0 });
  });

  it("Shield Dust blocks statuses", () => {
    const c = withAbility({ mods: { statusImmune: ["*"] } });
    const { state } = createBattle(c, ["....."], [u("p", "mid", "player", 0, 0), u("e", "slow", "enemy", 2, 0)]);
    const r = applyAction(state, c, { type: "useMove", unitId: "p", moveId: "toxin", target: { x: 2, y: 0 } });
    expect(unitById(r.state, "e").statuses).toEqual([]);
  });

  it("every species has an existing ability", () => {
    for (const s of Object.values(CONTENT.species)) expect(CONTENT.abilities, s.id).toHaveProperty(s.ability!);
  });
});
