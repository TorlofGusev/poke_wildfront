import { describe, expect, it } from "vitest";
import { CONTENT } from "../../src/content";
import { applyAction, createBattle, unitById, type BattleState } from "../../src/core/battle";

/** p1 tackles e, which carries `status` from ally p2 (or from nobody). */
function hitStatused(status: string | null, sourceId = "p2") {
  const stats = { ...CONTENT.species.rattata!.stats, speed: 20, crit: 0 };
  const { state } = createBattle(CONTENT, ["....."], [
    { id: "p1", speciesId: "rattata", side: "player", pos: { x: 0, y: 0 }, stats, moves: ["tackle"] },
    { id: "p2", speciesId: "rattata", side: "player", pos: { x: 3, y: 0 }, stats: { ...stats, speed: 1 }, moves: ["tackle"] },
    { id: "e", speciesId: "snorlax", side: "enemy", pos: { x: 1, y: 0 }, stats: { ...stats, speed: 0, willpower: 0 } },
  ]);
  const s: BattleState = { ...state, units: state.units.map((u) => (u.id === "e" && status ? { ...u, statuses: [{ id: status, turnsLeft: 3, sourceId }] } : u)) };
  const r = applyAction(s, CONTENT, { type: "useMove", unitId: "p1", moveId: "tackle", target: { x: 1, y: 0 } });
  const dmg = (r.events.find((e) => e.type === "damaged") as { amount: number } | undefined)?.amount ?? 0;
  return { r, dmg, combo: (r.events.find((e) => e.type === "combo") as { combo: string } | undefined)?.combo ?? null };
}

describe("named combos", () => {
  it("an ally's status sets up its named combo: more damage, and some use the status up", () => {
    const plain = hitStatused(null);
    const salts = hitStatused("paralysis");
    expect(salts.combo).toBe("smelling-salts");
    expect(salts.dmg).toBeGreaterThan(plain.dmg);
    expect(unitById(salts.r.state, "e").statuses.some((st) => st.id === "paralysis")).toBe(false);
    const venoshock = hitStatused("poison");
    expect(venoshock.combo).toBe("venoshock");
    expect(unitById(venoshock.r.state, "e").statuses.some((st) => st.id === "poison")).toBe(true);
    expect(hitStatused("exposed").combo).toBe("hex");
  });

  it("the user's own status is no combo", () => {
    expect(hitStatused("paralysis", "p1").combo).toBeNull();
  });
});
