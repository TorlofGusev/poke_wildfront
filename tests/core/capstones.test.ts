import { describe, expect, it } from "vitest";
import { type UnitSetup } from "../../src/core/battle";
import { applyAction, createBattle, passUntil } from "./hexFixture";
import ghost from "../../src/content/mastery/archetypes/ghost.json";
import { content as c } from "./fixtures";

const u = (id: string, speciesId: string, side: "player" | "enemy", x: number, extra: Partial<UnitSetup> = {}): UnitSetup => ({ id, speciesId, side, pos: { x, y: 0 }, ...extra });
const cursedBody = ghost.passives["ghost-cursed-body"].mods;

describe("Cursed Body (Ghost capstone)", () => {
  it("its adjacent hits Disable the foe for 1 turn", () => {
    const { state } = createBattle(c, ["....."], [u("p", "fast", "player", 0, { mods: cursedBody }), u("e", "slow", "enemy", 1)]);
    const r = applyAction(state, c, { type: "useMove", unitId: "p", moveId: "tackle", target: { x: 1, y: 0 } });
    expect(r.state.units.find((x) => x.id === "e")!.statuses).toContainEqual(expect.objectContaining({ id: "disabled", turnsLeft: 1 }));
  });

  it("foes that hit it from an adjacent hex take 6 damage", () => {
    const { state } = createBattle(c, ["....."], [u("e", "fast", "enemy", 0), u("p", "slow", "player", 1, { mods: cursedBody })]);
    const r = applyAction(passUntil(state, c, "e"), c, { type: "useMove", unitId: "e", moveId: "tackle", target: { x: 1, y: 0 } });
    expect(r.events).toContainEqual(expect.objectContaining({ type: "damaged", unitId: "e", amount: 6 }));
  });
});
