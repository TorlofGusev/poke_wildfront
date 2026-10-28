import { describe, expect, it } from "vitest";
import { unitById, type BattleContent, type BattleState, type UnitSetup } from "../../src/core/battle";
import { applyAction, createBattle, passUntil } from "./hexFixture";
import { content as base } from "./fixtures";

const content: BattleContent = {
  ...base,
  statuses: { ...base.statuses, freeze: { id: "freeze", name: "Freeze", noAction: true } },
  moves: {
    ...base.moves,
    chill: { id: "chill", name: "Chill", type: "normal", kind: "special", cooldown: 3, power: 0, range: { min: 1, max: 3 }, requiresLineOfSight: false, shape: { kind: "single" }, affects: "enemies", effects: [{ kind: "status", status: "freeze", duration: 1 }] },
  },
  species: { ...base.species, chiller: { ...base.species.fast!, id: "chiller", moves: ["tackle", "toxin", "chill"] } },
};
const OPEN = [".......", ".......", ".......", "......."];
const u = (id: string, speciesId: string, side: "player" | "enemy", x: number, y: number, extra: Partial<UnitSetup> = {}): UnitSetup => ({ id, speciesId, side, pos: { x, y }, ...extra });
const mods = (m: object) => m as UnitSetup["mods"];
const start = (units: UnitSetup[]): BattleState => createBattle(content, OPEN, units).state;
const use = (s: BattleState, unitId: string, moveId: string, x: number, y: number) => applyAction(s, content, { type: "useMove", unitId, moveId, target: { x, y } });
const dmgTo = (r: ReturnType<typeof use>, id: string) => (r.events.find((e) => e.type === "damaged" && e.unitId === id) as { amount: number } | undefined)?.amount ?? 0;

describe("mastery mechanics", () => {
  it("caps status duration bonuses at +2 and never extends Freeze", () => {
    const s = start([u("p", "chiller", "player", 0, 0, { mods: mods({ statusDurationBonus: 5 }) }), u("e", "slow", "enemy", 2, 0)]);
    const r = use(s, "p", "toxin", 2, 0);
    expect(r.events).toContainEqual(expect.objectContaining({ type: "statusApplied", status: "poison", duration: 5 }));
    const f = use(s, "p", "chill", 2, 0);
    expect(f.events).toContainEqual(expect.objectContaining({ type: "statusApplied", status: "freeze", duration: 1 }));
  });

  it("Moxie and Speed Boost reward a knockout", () => {
    const s = start([u("p", "fast", "player", 0, 0, { mods: mods({ koAttackBoost: 1, koMove: 2, koRefreshBasic: true }) }), u("e", "slow", "enemy", 1, 0, { hp: 1 }), u("f", "slow", "enemy", 5, 3)]);
    const before = s.turn!.movePointsLeft;
    const r = use(s, "p", "tackle", 1, 0);
    expect(unitById(r.state, "p").attackBoost).toBe(1);
    expect(r.state.turn!.movePointsLeft).toBe(before + 2);
    expect(r.state.turn!.basicUsed).toBe(false);
  });

  it("Fury Cutter grows with hits in a row on the same foe", () => {
    const s = start([u("p", "fast", "player", 0, 0, { mods: mods({ furyCutter: 0.5 }) }), u("e", "slow", "enemy", 1, 0)]);
    const first = use(s, "p", "tackle", 1, 0);
    const again = { ...first.state, turn: { ...first.state.turn!, basicUsed: false } };
    expect(dmgTo(use(again, "p", "tackle", 1, 0), "e")).toBeGreaterThan(dmgTo(first, "e"));
  });

  it("Pursuit hits harder on a foe breaking away and Mean Look stops a free escape", () => {
    const units = (pm: object, em: object) => [u("e", "fast", "enemy", 2, 2, { mods: mods(em) }), u("p", "mid", "player", 3, 2, { mods: mods(pm) })];
    const engaged = (pm: object, em: object) => {
      let s = passUntil(start(units(pm, em)), content, "e");
      s = use(s, "e", "tackle", 3, 2).state;
      return applyAction(s, content, { type: "endTurn", unitId: "e" }).state;
    };
    const away = (s: BattleState) => applyAction(s, content, { type: "move", unitId: "p", to: { x: 5, y: 2 } });
    expect(dmgTo(away(engaged({}, { strikeDamage: 2 })), "p")).toBeGreaterThan(dmgTo(away(engaged({}, {})), "p"));
    expect(away(engaged({ disengage: true }, {})).events.some((e) => e.type === "engagementStrike")).toBe(false);
    expect(away(engaged({ disengage: true }, { noEscape: true })).events.some((e) => e.type === "engagementStrike")).toBe(true);
  });

  it("Endure survives one knockout blow; Hydration sheds foes' statuses", () => {
    const s = start([u("p", "fast", "player", 0, 0), u("e", "slow", "enemy", 1, 0, { hp: 2, mods: mods({ sturdy: true, damageTaken: 10 }) })]);
    expect(unitById(use(s, "p", "tackle", 1, 0).state, "e").hp).toBe(1);
    const s2 = start([u("p", "chiller", "player", 0, 0), u("e", "slow", "enemy", 2, 0, { mods: mods({ shedStatuses: true }) })]);
    let st = use(s2, "p", "toxin", 2, 0).state;
    st = applyAction(st, content, { type: "endTurn", unitId: "p" }).state;
    while (st.turn && st.turn.unitId !== "e") st = applyAction(st, content, { type: "endTurn", unitId: st.turn.unitId }).state;
    expect(unitById(st, "e").statuses).toEqual([]);
  });
});
