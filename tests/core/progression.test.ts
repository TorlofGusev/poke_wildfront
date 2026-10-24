import { describe, expect, it } from "vitest";
import { CONTENT, PROGRESSION } from "../../src/content";
import { applyAction, createBattle } from "../../src/core/battle";
import { allocatePoint, buy, equipItem, newMember, resolveBattle, usePotion, type GameState } from "../../src/core/party";
import {
  chooseRole,
  chooseTalent,
  gainXp,
  memberStats,
  pendingChoice,
  setActiveMoves,
  talentOptions,
  toUnitSetup,
  xpToNext,
} from "../../src/core/progression";
import { content, pm, prog } from "./fixtures";

const starter = (species: string, level = 5) => newMember(CONTENT, PROGRESSION, species, 1, level);

describe("levels and stats", () => {
  it("needs level × xpPerLevel XP per level; stats grow only through spent points", () => {
    expect(xpToNext(PROGRESSION, 5)).toBe(5 * PROGRESSION.rules.xpPerLevel);
    const fresh = starter("charmander", 5);
    expect(fresh.unspentPoints).toBe(4);
    expect(memberStats(CONTENT, PROGRESSION, fresh).stats).toEqual(CONTENT.species.charmander!.stats);
    const up = gainXp(CONTENT, PROGRESSION, fresh, xpToNext(PROGRESSION, 5)).member;
    expect(up.unspentPoints).toBe(5);
    expect(memberStats(CONTENT, PROGRESSION, up).stats).toEqual(CONTENT.species.charmander!.stats);
  });

  it("type profiles give small stats: Fire is a striker, Rock a fortress", () => {
    expect(CONTENT.species.charmander!.stats).toEqual({ hp: 4, attack: 7, defense: 3, speed: 6 });
    // Geodude: Rock/Ground average, +1 Defense nudge.
    expect(CONTENT.species.geodude!.stats).toEqual({ hp: 6, attack: 6, defense: 8, speed: 1 });
    for (const sp of Object.values(CONTENT.species)) for (const v of Object.values(sp.stats)) expect(v).toBeLessThan(10);
  });

  it("levels up, possibly several times, and keeps leftover XP", () => {
    const m = starter("pikachu", 5);
    const need = xpToNext(PROGRESSION, 5) + xpToNext(PROGRESSION, 6);
    const { member, events } = gainXp(CONTENT, PROGRESSION, m, need + 7);
    expect(member.level).toBe(7);
    expect(member.xp).toBe(7);
    expect(events.filter((e) => e.type === "levelUp")).toHaveLength(2);
  });

  it("learns moves from the learnset and auto-activates while there is room", () => {
    const m = { ...starter("pidgey", 8), activeMoves: ["whirlwind"] };
    const { member, events } = gainXp(CONTENT, PROGRESSION, m, xpToNext(PROGRESSION, 8));
    expect(member.level).toBe(9);
    expect(events).toContainEqual({ type: "learned", move: "quick-attack", activated: true });
    expect(member.activeMoves).toEqual(["whirlwind", "quick-attack"]);
  });

  it("evolves at the evolution level and keeps knockouts, role and talents", () => {
    const m = { ...starter("charmander", 15), knockouts: 2, role: "striker", talents: ["brutal"] };
    const { member, events } = gainXp(CONTENT, PROGRESSION, m, xpToNext(PROGRESSION, 15));
    expect(member.speciesId).toBe("charmeleon");
    expect(events).toContainEqual({ type: "evolved", from: "charmander", into: "charmeleon" });
    expect(member).toMatchObject({ knockouts: 2, role: "striker", talents: ["brutal"] });
  });

  it("evolution adds free points and raises current HP by the max HP gained, but never revives", () => {
    const hurt = { ...starter("charmander", 15), hp: 10 };
    const up = gainXp(CONTENT, PROGRESSION, hurt, xpToNext(PROGRESSION, 15)).member;
    expect(up.unspentPoints).toBe(hurt.unspentPoints + 1 + PROGRESSION.rules.evolutionPoints);
    expect(up.hp).toBeGreaterThanOrEqual(10);
    const fainted = gainXp(CONTENT, PROGRESSION, { ...hurt, hp: 0 }, xpToNext(PROGRESSION, 15)).member;
    expect(fainted.hp).toBe(0);
  });
});

describe("roles and talents", () => {
  it("asks for a role at the role level, then one talent per level", () => {
    let m = pm("a", "fast", 0, 40, { level: 4 });
    const fastWithRoles = { ...content, species: { ...content.species, fast: { ...content.species.fast!, roles: ["striker", "tank"] } } };
    expect(pendingChoice(prog, m)).toBeNull();
    m = { ...m, level: 5 };
    expect(pendingChoice(prog, m)).toBe("role");
    expect(() => chooseRole(fastWithRoles, prog, m, "healer")).toThrow();
    m = chooseRole(fastWithRoles, prog, m, "striker");
    expect(pendingChoice(prog, m)).toBeNull();
    m = { ...m, level: 7 };
    expect(talentOptions(prog, m)).toEqual(["brutal", "power"]);
    m = chooseTalent(prog, m, "brutal");
    expect(talentOptions(prog, m)).toEqual(["power"]);
    m = chooseTalent(prog, m, "power");
    expect(pendingChoice(prog, m)).toBeNull();
    expect(() => chooseTalent(prog, m, "power")).toThrow(/no talent choice/);
  });

  it("stat talents raise stats and role talents change battle results", () => {
    const base = pm("a", "fast", 0, 40, { level: 6, role: "striker" });
    expect(memberStats(content, prog, { ...base, talents: ["power"] }).stats.attack).toBe(60);
    const fight = (talents: string[]) => {
      const setup = toUnitSetup(content, prog, { ...base, talents, activeMoves: [] });
      const { state } = createBattle(content, ["..."], [
        { ...setup, id: "p", side: "player", pos: { x: 0, y: 0 } },
        { id: "e", speciesId: "slow", side: "enemy", pos: { x: 1, y: 0 } },
      ]);
      const r = applyAction(state, content, { type: "useMove", unitId: "p", moveId: "tackle", target: { x: 1, y: 0 } });
      return (r.events.find((e) => e.type === "damaged") as { amount: number }).amount;
    };
    expect(fight(["brutal"])).toBe(fight([]) * 2);
  });
});

describe("move loadout", () => {
  it("allows up to 3 known moves besides the basic attack", () => {
    const m = starter("geodude", 20);
    expect(setActiveMoves(CONTENT, PROGRESSION, m, ["rock-slide", "earthquake"]).activeMoves).toEqual(["rock-slide", "earthquake"]);
    expect(() => setActiveMoves(CONTENT, PROGRESSION, m, ["rollout", "rock-throw", "rock-slide", "earthquake"])).toThrow(/at most 3/);
    expect(() => setActiveMoves(CONTENT, PROGRESSION, m, ["thunder"])).toThrow(/does not know/);
    expect(() => setActiveMoves(CONTENT, PROGRESSION, m, ["tackle"])).toThrow(/basic attack/);
    expect(toUnitSetup(CONTENT, PROGRESSION, m).moves![0]).toBe("tackle");
  });
});

describe("money, shop and items", () => {
  const game = (): GameState => ({
    roster: { party: [pm("a", "fast", 0, 10, { level: 5 })], storage: [], fallen: [] },
    inventory: { balls: {}, items: {} },
    nextUid: 2,
    money: 500,
    world: { pos: { x: 0, y: 0 }, fatigue: 0, lastCamp: { x: 0, y: 0 }, encounters: [], collected: [], rngState: 1, nextEncounterId: 1 },
  });
  const shopContent = { ...content, balls: { ...content.balls, "poke-ball": { ...content.balls["poke-ball"]!, price: 100 } } };

  it("buys balls and items, refusing when money runs out", () => {
    let g = buy(shopContent, prog, game(), "poke-ball", 3);
    expect(g.money).toBe(200);
    expect(g.inventory.balls["poke-ball"]).toBe(3);
    g = buy(shopContent, prog, g, "potion");
    expect(g.inventory.items.potion).toBe(1);
    expect(() => buy(shopContent, prog, g, "claw")).toThrow(/not enough money/);
    expect(() => buy(shopContent, prog, g, "rare-candy")).toThrow(/not sold/);
  });

  it("equips one held item, swapping the old one back into the bag", () => {
    let g: GameState = { ...game(), inventory: { balls: {}, items: { claw: 1 } } };
    g = equipItem(prog, g, "a", "claw");
    expect(g.roster.party[0]!.heldItem).toBe("claw");
    expect(g.inventory.items.claw).toBe(0);
    expect(() => equipItem(prog, g, "a", "claw")).toThrow(/no Claw/);
    g = equipItem(prog, g, "a", null);
    expect(g.inventory.items.claw).toBe(1);
    expect(() => equipItem(prog, g, "a", "potion")).toThrow(/cannot be held/);
  });

  it("spends level-up points on any stat; a Candy makes one count double", () => {
    let g: GameState = { ...game(), roster: { ...game().roster, party: [pm("a", "fast", 0, 10, { unspentPoints: 2 })] }, inventory: { balls: {}, items: { candy: 1 } } };
    g = allocatePoint(prog, g, "a", "speed");
    g = allocatePoint(prog, g, "a", "attack", true);
    expect(g.roster.party[0]!.statPoints).toMatchObject({ speed: 1, attack: 2 });
    expect(g.roster.party[0]!.unspentPoints).toBe(0);
    expect(g.inventory.items.candy).toBe(0);
    expect(() => allocatePoint(prog, g, "a", "hp")).toThrow(/no stat points/);
    const more = { ...g, roster: { ...g.roster, party: [{ ...g.roster.party[0]!, unspentPoints: 1 }] } };
    expect(() => allocatePoint(prog, more, "a", "hp", true)).toThrow(/no Candy/);
  });

  it("held items change battle stats", () => {
    const m = pm("a", "fast", 0, 40, { heldItem: "claw" });
    expect(toUnitSetup(content, prog, m).mods?.moveBonus).toBe(1);
  });

  it("potions heal outside battle but cannot revive", () => {
    let g: GameState = { ...game(), inventory: { balls: {}, items: { potion: 2 } } };
    g = usePotion(content, prog, g, "a", "potion");
    expect(g.roster.party[0]!.hp).toBe(30);
    expect(g.inventory.items.potion).toBe(1);
    const fainted = { ...g, roster: { ...g.roster, party: [{ ...g.roster.party[0]!, hp: 0 }] } };
    expect(() => usePotion(content, prog, fainted, "a", "potion")).toThrow(/fainted/);
  });

  it("victory pays XP to deployed Pokémon and money by defeated levels", () => {
    const g = { ...game(), roster: { ...game().roster, party: [pm("a", "fast", 0, 40, { level: 5 }), pm("b", "fast", 0, 40, { level: 5 })] } };
    let { state } = createBattle(content, ["..."], [
      { id: "a", speciesId: "fast", side: "player", pos: { x: 0, y: 0 } },
      { id: "e", speciesId: "slow", side: "enemy", pos: { x: 1, y: 0 }, hp: 1, level: 4 },
    ]);
    state = applyAction(state, content, { type: "useMove", unitId: "a", moveId: "tackle", target: { x: 1, y: 0 } }).state;
    expect(state.outcome).toBe("victory");
    const { game: next, summary } = resolveBattle(content, prog, g, state);
    expect(summary).toMatchObject({ xp: 20, money: 40, candies: 1 });
    expect(next.inventory.items.candy).toBe(1);
    expect(next.money).toBe(540);
    expect(next.roster.party.find((m) => m.uid === "a")!.xp).toBe(20);
    expect(next.roster.party.find((m) => m.uid === "b")!.xp).toBe(0);
  });
});

describe("content", () => {
  it("roles, talents, items and learnsets reference valid data", () => {
    for (const r of Object.values(PROGRESSION.roles)) for (const t of r.talents) expect(PROGRESSION.talents).toHaveProperty(t);
    for (const s of Object.values(CONTENT.species)) {
      for (const r of s.roles ?? []) expect(PROGRESSION.roles, `${s.id} role ${r}`).toHaveProperty(r);
      for (const l of s.learnset ?? []) expect(CONTENT.moves, `${s.id} learns ${l.move}`).toHaveProperty(l.move);
      if (s.evolution) expect(CONTENT.species, `${s.id} evolves`).toHaveProperty(s.evolution.into);
      expect(s.roles?.length, `${s.id} roles`).toBe(2);
    }
    for (const b of Object.values(CONTENT.balls)) expect(b.price).toBeGreaterThan(0);
  });
});

describe("talent trees", () => {
  const charmander = (level: number) => ({ ...starter("charmander", level), role: "striker" });

  it("offers role talents by level, type talents from level 8, and stat talents always", () => {
    const at6 = talentOptions(PROGRESSION, charmander(6), ["fire"]);
    expect(at6).toContain("brutal");
    expect(at6).not.toContain("skill-focus-energy");
    expect(at6).not.toContain("type-fire");
    expect(at6).toEqual(expect.arrayContaining(["vigor", "power", "guard", "agility"]));
    const at8 = talentOptions(PROGRESSION, charmander(8), ["fire"]);
    expect(at8).toEqual(expect.arrayContaining(["skill-focus-energy", "type-fire"]));
    expect(at8).not.toContain("type-water");
  });

  it("skill talents teach a new move and activate it when there is room", () => {
    const m = { ...charmander(7), activeMoves: ["ember"] };
    const next = chooseTalent(PROGRESSION, m, "skill-focus-energy", ["fire"]);
    expect(next.knownMoves).toContain("focus-energy");
    expect(next.activeMoves).toEqual(["ember", "focus-energy"]);
  });

  it("Protect blocks all damage until the user's next turn ends", () => {
    const setup = toUnitSetup(CONTENT, PROGRESSION, { ...starter("geodude", 7), activeMoves: ["protect"], knownMoves: ["tackle", "protect"] });
    let { state } = createBattle(CONTENT, ["....."], [
      { ...setup, id: "p", side: "player", pos: { x: 0, y: 0 }, stats: { ...setup.stats!, speed: 9 } },
      { id: "e", speciesId: "rattata", side: "enemy", pos: { x: 1, y: 0 } },
    ]);
    state = applyAction(state, CONTENT, { type: "useMove", unitId: "p", moveId: "protect", target: { x: 0, y: 0 } }).state;
    state = applyAction(state, CONTENT, { type: "endTurn", unitId: "p" }).state;
    const r = applyAction(state, CONTENT, { type: "useMove", unitId: "e", moveId: "tackle", target: { x: 0, y: 0 } });
    expect(r.events).toContainEqual(expect.objectContaining({ type: "damaged", unitId: "p", amount: 0 }));
  });

  it("every talent, role and skill references valid data", () => {
    for (const t of Object.values(PROGRESSION.talents)) {
      if (t.grantsMove) expect(CONTENT.moves, t.id).toHaveProperty(t.grantsMove);
      if (t.requiresType) expect(CONTENT.types, t.id).toHaveProperty(t.requiresType);
    }
    for (const id of Object.keys(CONTENT.types)) expect(Object.values(PROGRESSION.talents).some((t) => t.requiresType === id), id).toBe(true);
  });
});
