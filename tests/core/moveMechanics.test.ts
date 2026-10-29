import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { moveRange, type UnitSetup } from "../../src/core/battle";
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

  it("Super Fang takes half the target's current HP, whatever its stats", () => {
    const fang = (foe: string, foeHp?: number) => {
      const { state } = createBattle(CONTENT, ["....."], [u("p", "raticate", "player", 0, ["tackle", "super-fang"]), u("e", foe, "enemy", 1, ["tackle"])], { bond: { player: { start: 6, max: 6 } } });
      const s = foeHp ? { ...state, units: state.units.map((x) => (x.id === "e" ? { ...x, hp: foeHp } : x)) } : state;
      return { before: s.units.find((x) => x.id === "e")!.hp, after: hp(applyAction(s, CONTENT, { type: "useMove", unitId: "p", moveId: "super-fang", target: { x: 1, y: 0 } }), "e") };
    };
    const tank = fang("onix", 80);
    expect(tank.after).toBe(40);
    expect(fang("gastly").after).toBe(Math.round(fang("gastly").before / 2));
  });

  it("Endeavor, Flail and Reversal hit harder the more HP the user has lost", () => {
    for (const move of ["endeavor", "flail", "reversal"]) {
      const dealt = (lost: number) => {
        const { state } = createBattle(CONTENT, ["....."], [u("p", "raticate", "player", 0, ["tackle", move]), u("e", "snorlax", "enemy", 1, ["tackle"])], { seed: 1, bond: { player: { start: 6, max: 6 } } });
        const s = { ...state, units: state.units.map((x) => (x.id === "p" ? { ...x, hp: Math.max(1, Math.round(x.maxHp * (1 - lost))) } : x)) };
        return s.units.find((x) => x.id === "e")!.hp - hp(applyAction(s, CONTENT, { type: "useMove", unitId: "p", moveId: move, target: { x: 1, y: 0 } }), "e");
      };
      expect(dealt(0.8), move).toBeGreaterThan(dealt(0) * 1.8);
    }
  });

  it("Brine hits a hurt target harder, Wring Out a healthy one", () => {
    const dealt = (move: string, left: number) => {
      const { state } = createBattle(CONTENT, ["....."], [u("p", "tentacruel", "player", 0, ["water-gun", move]), u("e", "snorlax", "enemy", 2, ["tackle"])], { seed: 1 });
      const s = { ...state, units: state.units.map((x) => (x.id === "e" ? { ...x, hp: Math.round(x.maxHp * left) } : x)) };
      return s.units.find((x) => x.id === "e")!.hp - hp(applyAction(s, CONTENT, { type: "useMove", unitId: "p", moveId: move, target: { x: 2, y: 0 } }), "e");
    };
    expect(dealt("brine", 0.3)).toBeGreaterThan(dealt("brine", 1) * 1.4);
    expect(dealt("wring-out", 1)).toBeGreaterThan(dealt("wring-out", 0.6) * 1.2);
  });

  it("a move's price: recoil hurts the user, Superpower weakens it, Outrage confuses it", () => {
    const use = (move: string) => {
      const { state } = createBattle(CONTENT, ["....."], [u("p", "machamp", "player", 0, ["karate-chop", move]), u("e", "snorlax", "enemy", 1, ["tackle"])], { bond: { player: { start: 6, max: 6 } } });
      return applyAction(state, CONTENT, { type: "useMove", unitId: "p", moveId: move, target: { x: 1, y: 0 } });
    };
    const r = use("double-edge");
    const dealt = (r.events.find((e) => e.type === "damaged" && e.unitId === "e") as { amount: number }).amount;
    expect(r.events).toContainEqual(expect.objectContaining({ type: "damaged", unitId: "p", source: "recoil", amount: Math.max(1, Math.round(dealt * 0.33)) }));
    expect(use("superpower").state.units.find((x) => x.id === "p")!.statuses).toContainEqual(expect.objectContaining({ id: "weakened" }));
    expect(use("outrage").state.units.find((x) => x.id === "p")!.statuses).toContainEqual(expect.objectContaining({ id: "confused" }));
  });

  it("Double Hit lands twice; Chip Away ignores a fortified target's buff", () => {
    const { state } = createBattle(CONTENT, ["....."], [u("p", "machamp", "player", 0, ["karate-chop", "double-hit", "chip-away", "slam"]), u("e", "snorlax", "enemy", 1, ["tackle"])], { seed: 3, bond: { player: { start: 6, max: 6 } } });
    const hitsOn = (r: ReturnType<typeof applyAction>) => r.events.filter((e) => e.type === "damaged" && e.unitId === "e").length;
    expect(hitsOn(applyAction(state, CONTENT, { type: "useMove", unitId: "p", moveId: "double-hit", target: { x: 1, y: 0 } }))).toBe(2);
    const fortified = { ...state, units: state.units.map((x) => (x.id === "e" ? { ...x, statuses: [{ id: "fortified", turnsLeft: 2 }] } : x)) };
    const lost = (s: typeof state, move: string) => s.units.find((x) => x.id === "e")!.hp - hp(applyAction(s, CONTENT, { type: "useMove", unitId: "p", moveId: move, target: { x: 1, y: 0 } }), "e");
    expect(lost(fortified, "chip-away")).toBeGreaterThanOrEqual(lost(state, "chip-away") - 1);
  });

  it("False Swipe never knocks out; Lash Out hits harder while the user has an ailment", () => {
    const { state } = createBattle(CONTENT, ["....."], [u("p", "machamp", "player", 0, ["karate-chop", "false-swipe", "lash-out"]), u("e", "rattata", "enemy", 1, ["tackle"])], { seed: 2, bond: { player: { start: 6, max: 6 } } });
    const low = { ...state, units: state.units.map((x) => (x.id === "e" ? { ...x, hp: 3 } : x)) };
    expect(hp(applyAction(low, CONTENT, { type: "useMove", unitId: "p", moveId: "false-swipe", target: { x: 1, y: 0 } }), "e")).toBe(1);
    const lost = (s: typeof state) => s.units.find((x) => x.id === "e")!.hp - hp(applyAction(s, CONTENT, { type: "useMove", unitId: "p", moveId: "lash-out", target: { x: 1, y: 0 } }), "e");
    const burnt = { ...state, units: state.units.map((x) => (x.id === "p" ? { ...x, statuses: [{ id: "poison", turnsLeft: 2 }] } : x)) };
    expect(lost(burnt)).toBeGreaterThan(lost(state) * 1.5);
  });

  it("Follow Me taunts the foes around the user; Helping Hand boosts the ally and the user", () => {
    const { state } = createBattle(CONTENT, ["......"], [u("p", "clefairy", "player", 1, ["pound", "follow-me", "helping-hand"]), u("a", "rattata", "player", 0, ["tackle"]), u("e", "rattata", "enemy", 2, ["tackle"]), u("f", "rattata", "enemy", 3, ["tackle"])]);
    const pos = (id: string) => state.units.find((x) => x.id === id)!.pos;
    const taunt = applyAction(state, CONTENT, { type: "useMove", unitId: "p", moveId: "follow-me", target: pos("p") });
    const taunted = (id: string) => taunt.state.units.find((x) => x.id === id)!.statuses.some((st) => st.id === "taunted");
    expect(taunt.events.filter((e) => e.type === "statusApplied" || e.type === "statusResisted").map((e) => (e as { unitId: string }).unitId).sort()).toEqual(["e", "f"]);
    expect(taunted("a")).toBe(false);
    const help = applyAction(state, CONTENT, { type: "useMove", unitId: "p", moveId: "helping-hand", target: pos("a") });
    for (const id of ["a", "p"]) expect(help.state.units.find((x) => x.id === id)!.statuses, id).toContainEqual(expect.objectContaining({ id: "helped" }));
  });

  it("Ally Switch trades places and frees both from their engagements; Knock Off strips buffs", () => {
    const { state } = createBattle(CONTENT, ["......"], [u("p", "abra", "player", 0, ["confusion", "ally-switch"]), u("a", "machop", "player", 3, ["karate-chop", "knock-off"]), u("e", "rattata", "enemy", 4, ["tackle"])]);
    const engaged = { ...state, units: state.units.map((x) => ({ ...x, engagedWith: x.id === "a" ? "e" : x.id === "e" ? "a" : null })) };
    const r = applyAction(engaged, CONTENT, { type: "useMove", unitId: "p", moveId: "ally-switch", target: engaged.units.find((x) => x.id === "a")!.pos });
    const at = (id: string) => r.state.units.find((x) => x.id === id)!;
    expect([at("p").pos.x, at("a").pos.x]).toEqual([engaged.units.find((x) => x.id === "a")!.pos.x, engaged.units.find((x) => x.id === "p")!.pos.x]);
    expect(at("a").engagedWith).toBeFalsy();
    expect(at("e").engagedWith).toBeFalsy();
    const buffed = { ...state, turn: { ...state.turn!, unitId: "a" }, units: state.units.map((x) => (x.id === "e" ? { ...x, statuses: [{ id: "fortified", turnsLeft: 3 }, { id: "poison", turnsLeft: 2 }] } : x)) };
    const k = applyAction(buffed, CONTENT, { type: "useMove", unitId: "a", moveId: "knock-off", target: buffed.units.find((x) => x.id === "e")!.pos });
    expect(k.state.units.find((x) => x.id === "e")!.statuses.map((x) => x.id)).toEqual(["poison"]);
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

  it("Smokescreen blinds: ranged reach shrinks by 1, never below the minimum; Confide weakens instead", () => {
    const { state } = createBattle(CONTENT, ["....."], [u("p", "koffing", "player", 0, ["smokescreen"]), u("e", "pidgey", "enemy", 2, ["gust"])]);
    const r = applyAction(state, CONTENT, { type: "useMove", unitId: "p", moveId: "smokescreen", target: { x: 2, y: 0 } });
    const foe = r.state.units.find((x) => x.id === "e")!;
    expect(foe.statuses).toContainEqual(expect.objectContaining({ id: "blinded" }));
    const ranged = { ...CONTENT.moves.gust!, range: { min: 1, max: 3 } };
    expect(moveRange(foe, ranged, CONTENT).max).toBe(moveRange({ ...foe, statuses: [] }, ranged, CONTENT).max - 1);
    expect(moveRange(foe, { ...ranged, range: { min: 2, max: 2 } }, CONTENT)).toEqual({ min: 2, max: 2 });
    expect(CONTENT.moves.confide!.effects).toEqual([expect.objectContaining({ status: "weakened" })]);
  });

  it("canon hooks: Strength Sap heals the user, Memento costs it HP, Thunder Wave does nothing to Ground", () => {
    const at = (moveId: string, foe: string, hpShare = 0.5) => {
      const { state } = createBattle(CONTENT, ["....."], [u("p", "oddish", "player", 0, [moveId]), u("e", foe, "enemy", 1, ["tackle"], { stats: { ...CONTENT.species[foe]!.stats, speed: 1, willpower: 0 } })]);
      const s = { ...state, units: state.units.map((x) => (x.id === "p" ? { ...x, hp: Math.round(x.maxHp * hpShare) } : x)) };
      const before = s.units.find((x) => x.id === "p")!.hp;
      const r = applyAction(s, CONTENT, { type: "useMove", unitId: "p", moveId, target: { x: 1, y: 0 } });
      return { gain: hp(r, "p") - before, foe: r.state.units.find((x) => x.id === "e")!.statuses.map((st) => st.id) };
    };
    const sap = at("strength-sap", "rattata");
    expect(sap.gain).toBeGreaterThan(0);
    expect(sap.foe).toContain("weakened");
    const memento = at("memento", "rattata");
    expect(memento.gain).toBeLessThan(0);
    expect(memento.foe).toEqual(expect.arrayContaining(["weakened", "exposed"]));
    expect(at("memento", "rattata", 0.01).gain).toBe(0); // never below 1 HP
    expect(at("thunder-wave", "geodude").foe).toEqual([]);
    expect(at("thunder-wave", "rattata").foe).toContain("paralysis");
    expect(at("glare", "geodude").foe).toContain("paralysis");
  });

  it("Burn only hurts over time; Fairy moves soften (−15%) instead of weakening", () => {
    expect(CONTENT.statuses.burn!.damageDealt).toBeUndefined();
    expect(CONTENT.types.fairy!.move!.appliesStatus).toEqual({ status: "softened", duration: 1 });
    expect(CONTENT.statuses.softened!.damageDealt).toBe(0.85);
  });
});
