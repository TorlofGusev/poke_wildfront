import { describe, expect, it } from "vitest";
import { CONTENT } from "../../src/content";
import { applyAction, createBattle, critChance, statusResistChance, type BattleEvent } from "../../src/core/battle";

const base = CONTENT.species.rattata!.stats;
/** One hit from p onto e (adjacent), with chosen stats, on a given seed. */
function hit(stats: Partial<typeof base>, moveId: string, seed: number, foeStats: Partial<typeof base> = {}): BattleEvent[] {
  const { state } = createBattle(CONTENT, ["....."], [
    { id: "p", speciesId: "pikachu", side: "player", pos: { x: 0, y: 0 }, stats: { ...base, speed: 20, ...stats }, moves: ["tackle", moveId] },
    { id: "e", speciesId: "snorlax", side: "enemy", pos: { x: 1, y: 0 }, stats: { ...base, speed: 0, ...foeStats } },
  ], { seed });
  return applyAction(state, CONTENT, { type: "useMove", unitId: "p", moveId, target: { x: 1, y: 0 } }).events;
}
const seeds = Array.from({ length: 40 }, (_, i) => i + 1);

describe("Crit and Willpower", () => {
  it("Crit raises the chance of critical hits, and a critical hit deals more", () => {
    expect(critChance(CONTENT, { stats: { ...base, crit: 10 } } as never)).toBeGreaterThan(critChance(CONTENT, { stats: { ...base, crit: 0 } } as never));
    const crits = (crit: number) => seeds.filter((s) => hit({ crit }, "tackle", s).some((e) => e.type === "critical")).length;
    expect(crits(40)).toBeGreaterThan(crits(0));
    const dmg = (s: number) => (hit({ crit: 40 }, "tackle", s).find((e) => e.type === "damaged") as { amount: number }).amount;
    const critSeed = seeds.find((s) => hit({ crit: 40 }, "tackle", s).some((e) => e.type === "critical"))!;
    const plainSeed = seeds.find((s) => !hit({ crit: 40 }, "tackle", s).some((e) => e.type === "critical"))!;
    expect(dmg(critSeed)).toBeGreaterThan(dmg(plainSeed));
  });

  it("Willpower fills the Spirit bar faster; a full bar pumps up the unit", () => {
    const pumped = (willpower: number) => hit({ willpower }, "tackle", 1).some((e) => e.type === "statusApplied" && e.status === "pumped");
    expect(pumped(0)).toBe(false);
    expect(pumped(100)).toBe(true);
  });

  it("Willpower shrugs off statuses foes inflict, up to half the time", () => {
    expect(statusResistChance(CONTENT, { stats: { ...base, willpower: 1000 } } as never)).toBe(0.5);
    const resisted = (willpower: number) => seeds.filter((s) => hit({}, "thunder-wave", s, { willpower }).some((e) => e.type === "statusResisted")).length;
    expect(resisted(0)).toBe(0);
    expect(resisted(1000)).toBeGreaterThan(5);
  });
});
