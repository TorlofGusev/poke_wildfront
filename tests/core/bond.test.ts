import { describe, expect, it } from "vitest";
import { applyAction, createBattle, moveUnavailableReason, type BattleContent, type UnitSetup } from "../../src/core/battle";
import { teamBond } from "../../src/core/progression";
import { content as base, pm, prog } from "./fixtures";

const c: BattleContent = {
  ...base,
  moves: {
    ...base.moves,
    blast: { id: "blast", name: "Blast", type: "normal", kind: "bond", bondCost: 2, power: 80, range: { min: 1, max: 1 }, requiresLineOfSight: false, shape: { kind: "single" }, affects: "enemies" },
  },
  species: { ...base.species, fast: { ...base.species.fast!, moves: [...base.species.fast!.moves, "blast"] } },
};
const u = (id: string, speciesId: string, side: "player" | "enemy", x: number, extra: Partial<UnitSetup> = {}): UnitSetup => ({ id, speciesId, side, pos: { x, y: 0 }, ...extra });

describe("team Bond", () => {
  it("bond moves spend the team pool and need enough of it", () => {
    const { state } = createBattle(c, ["....."], [u("p", "fast", "player", 0), u("e", "slow", "enemy", 1)], { bond: { player: { start: 2, max: 6 } } });
    const r = applyAction(state, c, { type: "useMove", unitId: "p", moveId: "blast", target: { x: 1, y: 0 } });
    expect(r.state.bond.player).toBe(0);
    expect(r.events).toContainEqual({ type: "bondChanged", side: "player", amount: -2, total: 0, reason: "spent" });
    const poor = createBattle(c, ["....."], [u("p", "fast", "player", 0), u("e", "slow", "enemy", 1)], { bond: { player: { start: 1, max: 6 } } }).state;
    expect(moveUnavailableReason(poor, c, "p", "blast")).toMatch(/needs 2 Bond/);
  });

  it("knockouts build Bond (plus Rally), capped at the maximum", () => {
    const { state } = createBattle(c, ["......"], [u("p", "fast", "player", 0, { mods: { bondOnKo: 1 } }), u("e", "slow", "enemy", 1, { hp: 1 }), u("e2", "slow", "enemy", 5)], {
      bond: { player: { start: 5, max: 6 } },
    });
    const r = applyAction(state, c, { type: "useMove", unitId: "p", moveId: "tackle", target: { x: 1, y: 0 } });
    expect(r.state.bond.player).toBe(6);
  });

  it("Second Wind gives Bond when the Pokémon faints; Momentum makes bond moves cheaper", () => {
    let { state } = createBattle(c, ["....."], [u("p", "slow", "player", 0, { hp: 1, mods: { bondOnFaint: 2 } }), u("q", "slow", "player", 3), u("e", "fast", "enemy", 1)], {
      bond: { player: { start: 0, max: 6 } },
    });
    state = applyAction(state, c, { type: "useMove", unitId: "e", moveId: "tackle", target: { x: 0, y: 0 } }).state;
    expect(state.bond.player).toBe(2);
    const cheap = createBattle(c, ["....."], [u("p", "fast", "player", 0, { mods: { bondCostReduction: 1 } }), u("e", "slow", "enemy", 1)], { bond: { player: { start: 1, max: 6 } } }).state;
    expect(moveUnavailableReason(cheap, c, "p", "blast")).toBeNull();
  });

  it("team talents of deployed Pokémon and meals raise starting Bond and its cap", () => {
    const withTeam = { ...prog, talents: { ...prog.talents, steady: { id: "steady", name: "", description: "", team: { startBond: 1, maxBond: 1 } } } };
    expect(teamBond(c, withTeam, [pm("a", "fast", 0, 40, { talents: ["steady"] }), pm("b", "fast")], { startBond: 1 })).toEqual({ start: 4, max: 7 });
    expect(teamBond(c, withTeam, [], { startBond: 9 })).toEqual({ start: 6, max: 6 });
  });
});
