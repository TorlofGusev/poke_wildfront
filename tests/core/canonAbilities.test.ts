import { describe, expect, it } from "vitest";
import { movementPoints, type UnitSetup } from "../../src/core/battle";
import { applyAction, createBattle } from "./hexFixture";
import { CONTENT } from "../../src/content";

const u = (id: string, speciesId: string, side: "player" | "enemy", x: number, moves: string[], extra: Partial<UnitSetup> = {}): UnitSetup =>
  ({ id, speciesId, side, pos: { x, y: 0 }, moves, stats: { ...CONTENT.species[speciesId]!.stats, speed: id === "p" ? 30 : 1, crit: 0 }, ...extra });
const hit = (attacker: Partial<UnitSetup>, defender: Partial<UnitSetup>, move: string, attackerMoves = ["scratch", move]) => {
  const x = CONTENT.moves[move]!.range.min;
  const { state } = createBattle(CONTENT, ["....."], [u("p", "charmander", "player", 0, attackerMoves, attacker), u("e", "rattata", "enemy", x, ["tackle"], defender)]);
  return applyAction(state, CONTENT, { type: "useMove", unitId: "p", moveId: move, target: { x, y: 0 } });
};
const dmg = (r: ReturnType<typeof hit>) => (r.events.find((e) => e.type === "damaged" && e.unitId === "e") as { amount: number }).amount;

describe("canon abilities behind the names", () => {
  it("Thick Fat halves Fire damage", () => {
    expect(dmg(hit({}, { mods: { typeDamageTaken: { fire: 0.5 } } }, "ember"))).toBeLessThan(dmg(hit({}, {}, "ember")) * 0.6);
  });

  it("Sheer Force: a status move hits 30% harder and drops its status", () => {
    const plain = hit({}, {}, "ember");
    const sheer = hit({ mods: { sheerForce: true } }, {}, "ember");
    expect(dmg(sheer)).toBeGreaterThan(dmg(plain));
    expect(sheer.state.units.find((x) => x.id === "e")!.statuses.some((s) => s.id === "burn")).toBe(false);
  });

  it("Battle Armor never takes critical hits", () => {
    const r = hit({ stats: { ...CONTENT.species.charmander!.stats, speed: 30, crit: 200 } }, { mods: { critImmune: true } }, "scratch", ["scratch"]);
    expect(r.events.some((e) => e.type === "critical")).toBe(false);
  });

  it("a Static mastery paralyzes a foe that hits it from an adjacent hex", () => {
    const r = hit({}, { mods: { hitStatus: { status: "paralysis", duration: 1 } } }, "scratch", ["scratch"]);
    expect(r.state.units.find((x) => x.id === "p")!.statuses.some((s) => s.id === "paralysis")).toBe(true);
  });

  it("Guts ignores Burn's damage penalty; Quick Feet keeps moving through Paralysis", () => {
    const strike = (mods: UnitSetup["mods"], status?: string) => {
      const { state } = createBattle(CONTENT, ["....."], [u("p", "charmander", "player", 0, ["scratch"], { mods }), u("e", "snorlax", "enemy", 1, ["tackle"])]);
      const s = status ? { ...state, units: state.units.map((x) => (x.id === "p" ? { ...x, statuses: [{ id: status, turnsLeft: 3 }] } : x)) } : state;
      return dmg(applyAction(s, CONTENT, { type: "useMove", unitId: "p", moveId: "scratch", target: { x: 1, y: 0 } }));
    };
    expect(strike({ statusedDamage: 1.3 }, "burn")).toBeGreaterThan(strike({}));
    expect(strike({}, "burn")).toBeLessThan(strike({}));
    const { state } = createBattle(CONTENT, ["....."], [u("p", "rattata", "player", 0, ["tackle"], { mods: { statusedMove: 2 } }), u("e", "rattata", "enemy", 4, ["tackle"])]);
    const paralysed = { ...state.units[0]!, statuses: [{ id: "paralysis", turnsLeft: 2 }] };
    expect(movementPoints(CONTENT, paralysed, state)).toBeGreaterThan(0);
  });
});
