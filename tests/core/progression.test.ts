import { describe, expect, it } from "vitest";
import { CONTENT, PROGRESSION } from "../../src/content";
import { maxHpAt, moveRange, moveUnavailableReason } from "../../src/core/battle";
import { applyAction, createBattle, hexPos } from "./hexFixture";
import { allocatePoint, useRareCandy, buy, equipItem, sell, newMember, resolveBattle, usePotion, type GameState } from "../../src/core/party";
import {
  focusGrowth,
  statOffer,
  chooseFocus,
  chooseTalent,
  focusOptions,
  gainXp,
  memberModifiers,
  memberStats,
  pendingChoice,
  setActiveMoves,
  talentOptions,
  wildForm,
  wildSetup,
  masteryGrid,
  chooseEvolution,
  evolutionChoices,
  resetMasteries,
  toUnitSetup,
  xpToNext,
} from "../../src/core/progression";
import { content, pm, prog } from "./fixtures";

const starter = (species: string, level = 5) => newMember(CONTENT, PROGRESSION, species, 1, level);

describe("levels and stats", () => {
  it("needs level × xpPerLevel XP per level; a level-up only adds points to spend", () => {
    expect(xpToNext(PROGRESSION, 5)).toBe(5 * PROGRESSION.rules.xpPerLevel);
    const fresh = starter("charmander", 5);
    // Points from the 4 levels it arrived with are pre-spent along the Fire playstyle.
    expect(fresh.unspentPoints).toBe(0);
    expect(fresh.statPoints).toEqual({ hp: 1, attack: 2, defense: 0, speed: 1, willpower: 0, crit: 0 });
    const up = gainXp(CONTENT, PROGRESSION, fresh, xpToNext(PROGRESSION, 5)).member;
    expect(up.unspentPoints).toBe(1);
    expect(memberStats(CONTENT, PROGRESSION, up).stats).toEqual(memberStats(CONTENT, PROGRESSION, fresh).stats);
  });

  it("type profiles give small stats: Fire is a striker, Rock a fortress", () => {
    expect(CONTENT.species.charmander!.stats).toEqual({ hp: 4, attack: 9, defense: 4, speed: 5, willpower: 4, crit: 4 });
    // Geodude: Rock/Ground average, +1 Defense nudge, evened out to the same total.
    expect(CONTENT.species.geodude!.stats).toEqual({ hp: 6, attack: 6, defense: 9, speed: 1, willpower: 5, crit: 3 });
    // Every first form has the same total; each evolution stage adds a little.
    const total = (id: string) => Object.values(CONTENT.species[id]!.stats).reduce((a, b) => a + b, 0);
    for (const id of ["bulbasaur", "charmander", "squirtle", "pikachu", "rattata", "geodude"]) expect(total(id), id).toBe(30);
    expect([total("ivysaur"), total("venusaur")]).toEqual([32, 34]);
    for (const sp of Object.values(CONTENT.species)) for (const v of Object.values(sp.stats)) expect(v).toBeLessThanOrEqual(10);
    // Every type spends the same budget; types differ only in where it goes.
    const sums = Object.values(CONTENT.types).map((ty) => Object.values(ty.profile).reduce((a, b) => a + b, 0));
    expect(new Set(sums).size).toBe(1);
  });

  it("the focus gives a bonus, then +1 every 2 levels; max HP grows with level and Defense", () => {
    const m = { ...starter("squirtle", 10), focus: "defense" as const };
    const at = (level: number) => memberStats(CONTENT, PROGRESSION, { ...m, level });
    expect(at(20).stats.defense - at(10).stats.defense).toBe(Math.floor(19 / 2) - Math.floor(9 / 2));
    expect(at(10).stats.defense - memberStats(CONTENT, PROGRESSION, { ...m, focus: null }).stats.defense).toBe(PROGRESSION.rules.focusBonus + Math.floor(9 / 2));
    expect(at(20).stats.speed).toBe(at(10).stats.speed);
    expect(at(20).maxHp).toBeGreaterThan(at(10).maxHp);
    const r = CONTENT.rules;
    // Sturdier species (higher base Defense) gain more HP per level; Defense growth itself does not add HP.
    expect(maxHpAt(CONTENT, 5, 8, 20) - maxHpAt(CONTENT, 5, 3, 20)).toBe(Math.round(19 * (r.hpPerLevel + r.hpPerLevelPerDefense * 8)) - Math.round(19 * (r.hpPerLevel + r.hpPerLevelPerDefense * 3)));
    expect(at(20).maxHp - at(10).maxHp).toBe(maxHpAt(CONTENT, at(20).stats.hp, CONTENT.species.squirtle!.stats.defense, 20) - maxHpAt(CONTENT, at(10).stats.hp, CONTENT.species.squirtle!.stats.defense, 10));
  });

  it("Body Press hits with Defense (the canon exception); other moves use Attack / Sp. Atk", () => {
    const press = Object.values(CONTENT.moves).find((m) => m.name === "Body Press" && m.scaleStat === "defense")!;
    const hit = (defense: number) => {
      const { state } = createBattle(CONTENT, ["....."], [
        { id: "p", speciesId: "snorlax", side: "player", pos: { x: 0, y: 0 }, stats: { ...CONTENT.species.snorlax!.stats, defense, speed: 20 }, moves: ["tackle", press.id] },
        { id: "e", speciesId: "rattata", side: "enemy", pos: { x: 1, y: 0 } },
      ], { bond: { player: { start: 3, max: 6 } } });
      const r = applyAction(state, CONTENT, { type: "useMove", unitId: "p", moveId: press.id, target: { x: 1, y: 0 } });
      return (r.events.find((e) => e.type === "damaged") as { amount: number }).amount;
    };
    expect(hit(15)).toBeGreaterThan(hit(5));
  });

  it("Speed past the movement cap adds momentum after moving; melee hits harder; engaged shooters are hampered", () => {
    const hit = (speed: number, moveFirst: boolean, moveId = "scratch", foeAt = { x: 2, y: 0 }) => {
      let { state } = createBattle(CONTENT, ["......"], [
        { id: "p", speciesId: "charmander", side: "player", pos: { x: 0, y: 0 }, stats: { ...CONTENT.species.charmander!.stats, speed }, moves: ["scratch", "flamethrower"] },
        { id: "e", speciesId: "rattata", side: "enemy", pos: foeAt, stats: { ...CONTENT.species.rattata!.stats, speed: 0 } },
      ]);
      if (moveFirst) state = applyAction(state, CONTENT, { type: "move", unitId: "p", to: { x: 1, y: 0 } }).state;
      else state = { ...state, units: state.units.map((u) => (u.id === "p" ? { ...u, pos: hexPos({ x: 1, y: 0 }) } : u)) };
      const target = state.units.find((u) => u.id === "e")!.pos;
      const r = applyAction(state, CONTENT, { type: "useMove", unitId: "p", moveId, target });
      return (r.events.find((e) => e.type === "damaged") as { amount: number }).amount;
    };
    // Movement caps at 9 Speed; 24 Speed is well past it = more damage after moving; none standing still or at low Speed.
    expect(hit(24, true)).toBeGreaterThan(hit(24, false));
    expect(hit(6, true)).toBe(hit(6, false));
    expect(CONTENT.rules.melee.closeBonus).toBeGreaterThan(1);
    expect(CONTENT.rules.melee.engagedRangedPenalty).toBeLessThan(1);
  });

  it("wild Pokémon appear evolved once their level reaches the evolution level", () => {
    expect(wildForm(CONTENT, "caterpie", 3)).toBe("caterpie");
    expect(wildForm(CONTENT, "caterpie", 6)).toBe("metapod");
    expect(wildForm(CONTENT, "caterpie", 9)).toBe("butterfree");
    expect(wildSetup(CONTENT, PROGRESSION, "weedle", 6).speciesId).toBe("kakuna");
  });

  it("levels up, possibly several times, and keeps leftover XP", () => {
    const m = starter("pikachu", 5);
    const need = xpToNext(PROGRESSION, 5) + xpToNext(PROGRESSION, 6);
    const { member, events } = gainXp(CONTENT, PROGRESSION, m, need + 7);
    expect(member.level).toBe(7);
    expect(member.xp).toBe(7);
    expect(events.filter((e) => e.type === "levelUp")).toHaveLength(2);
  });

  it("levelling up teaches no moves: they come only from the tree", () => {
    const m = starter("pidgey", 8);
    const { member, events } = gainXp(CONTENT, PROGRESSION, m, xpToNext(PROGRESSION, 8));
    expect(member.level).toBe(9);
    expect(events.some((e) => e.type === "learned")).toBe(false);
    expect(member.knownMoves).toEqual(CONTENT.species.pidgey!.moves);
  });

  it("evolves at the evolution level and keeps knockouts, focus and talents", () => {
    const m = { ...starter("charmander", 15), knockouts: 2, focus: "attack" as const, talents: ["blaze"] };
    const { member, events } = gainXp(CONTENT, PROGRESSION, m, xpToNext(PROGRESSION, 15));
    expect(member.speciesId).toBe("charmeleon");
    expect(events).toContainEqual({ type: "evolved", from: "charmander", into: "charmeleon" });
    expect(member).toMatchObject({ knockouts: 2, focus: "attack", talents: ["blaze"] });
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

describe("focus and talents", () => {
  it("asks for a focus at the focus level (learning its Bond skill), then one mastery per reached row", () => {
    let m = { ...starter("charmander", 2), focus: null };
    expect(pendingChoice(CONTENT, PROGRESSION, m)).toBeNull();
    m = { ...m, level: 3 };
    expect(pendingChoice(CONTENT, PROGRESSION, m)).toBe("focus");
    expect(() => chooseFocus(CONTENT, PROGRESSION, m, "skill:frenzy-plant")).toThrow();
    m = chooseFocus(CONTENT, PROGRESSION, m, "skill:flare-blitz") as typeof m;
    expect(m.focus).toBe("attack");
    expect(m.talents).toEqual(["skill:flare-blitz"]);
    expect(m.knownMoves).toContain("flare-blitz");
    expect(pendingChoice(CONTENT, PROGRESSION, m)).toBeNull();
    m = { ...m, level: 4 };
    const [a, b] = talentOptions(CONTENT, PROGRESSION, m);
    m = chooseTalent(CONTENT, PROGRESSION, m, a!) as typeof m;
    expect(() => chooseTalent(CONTENT, PROGRESSION, m, b!)).toThrow(/no talent choice/);
  });

  it("stat talents raise stats and passive talents change battle results", () => {
    const base = pm("a", "fast", 0, 40, { level: 6 });
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
    const m = { ...starter("geodude", 20), knownMoves: ["tackle", "smack-down", "rock-throw", "rock-slide", "earthquake"] };
    expect(setActiveMoves(CONTENT, PROGRESSION, m, ["rock-slide", "earthquake"]).activeMoves).toEqual(["rock-slide", "earthquake"]);
    expect(() => setActiveMoves(CONTENT, PROGRESSION, m, ["smack-down", "rock-throw", "rock-slide", "earthquake"])).toThrow(/at most 3/);
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
    world: { mapId: "route-2", pos: { x: 0, y: 0 }, fatigue: 0, lastCamp: { x: 0, y: 0 }, encounters: [], collected: [], pickups: [], rngState: 1, nextEncounterId: 1, meal: null },
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

  it("sells balls and items back for half their price", () => {
    let g = buy(shopContent, prog, game(), "poke-ball", 2);
    g = sell(shopContent, prog, g, "poke-ball");
    expect(g.money).toBe(500 - 200 + 50);
    expect(g.inventory.balls["poke-ball"]).toBe(1);
    expect(() => sell(shopContent, prog, g, "poke-ball", 2)).toThrow(/not enough in the bag/);
    expect(() => sell(shopContent, prog, g, "rare-candy")).toThrow();
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

  it("spends level-up points on an offered stat, EV upgrades +1 to +2; a Rare Candy gives one level", () => {
    let g: GameState = { ...game(), ev: 7, roster: { ...game().roster, party: [pm("a", "fast", 0, 10, { unspentPoints: 2 })] }, inventory: { balls: {}, items: { candy: 1 } } };
    const offer = statOffer(content, prog, g.roster.party[0]!);
    expect(offer).toHaveLength(3);
    const missing = (["hp", "attack", "defense", "speed", "willpower", "crit"] as const).find((st) => !offer.some((o) => o.stat === st))!;
    g = allocatePoint(content, prog, g, "a", missing, true);
    expect(g.ev).toBe(0);
    expect(g.roster.party[0]!.statPoints[missing]).toBe(2);
    const next = statOffer(content, prog, g.roster.party[0]!);
    const other = (["hp", "attack", "defense", "speed", "willpower", "crit"] as const).find((st) => !next.some((o) => o.stat === st))!;
    expect(() => allocatePoint(content, prog, g, "a", other)).toThrow(/EV/);
    g = allocatePoint(content, prog, g, "a", next[0]!.stat);
    expect(() => allocatePoint(content, prog, g, "a", "hp")).toThrow();
    const real: GameState = { ...game(), roster: { ...game().roster, party: [starter("pidgey", 5)] }, inventory: { balls: {}, items: { candy: 1 } } };
    const uid = real.roster.party[0]!.uid;
    const up = useRareCandy(CONTENT, PROGRESSION, real, uid).game;
    expect(up.roster.party[0]!.level).toBe(6);
    expect(up.inventory.items.candy).toBe(0);
    expect(() => useRareCandy(CONTENT, PROGRESSION, up, uid)).toThrow(/no Rare Candy/);
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

  it("victory pays full XP to deployed Pokémon, half to the bench (Exp. Share), and money by defeated levels", () => {
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
    expect(next.roster.party.find((m) => m.uid === "a")!.xp).toBe(14); // L5 vs an L4 foe: 30% less
    expect(next.roster.party.find((m) => m.uid === "b")!.xp).toBe(7);
  });
});

describe("content", () => {
  it("species start with a basic attack and one more move; evolutions and items reference valid data", () => {
    for (const s of Object.values(CONTENT.species)) {
      // Ditto has only its basic attack: every other move it copies through its tree.
      expect(s.moves, s.id).toHaveLength(s.id === "ditto" ? 1 : 2);
      expect(CONTENT.moves[s.moves[0]!]?.kind, s.id).toBe("basic");
      for (const m of s.moves) expect(CONTENT.moves, `${s.id} starts with ${m}`).toHaveProperty(m);
      if (s.evolution) expect(CONTENT.species, `${s.id} evolves`).toHaveProperty(s.evolution.into);
    }
    for (const b of Object.values(CONTENT.balls)) expect(b.price).toBeGreaterThan(0);
  });
});

describe("mastery grid", () => {
  const charmander = (level: number, talents: string[] = []) => ({ ...starter("charmander", level), focus: "attack" as const, talents: ["skill:flare-blitz", ...talents] });

  it("each line has one hand-made tree: three focuses, then the same rows whatever the focus", () => {
    expect(focusOptions(PROGRESSION, "charmeleon").map((f) => [f.stat, f.second])).toEqual([["attack", undefined], ["attack", "defense"], ["attack", undefined]]);
    expect(masteryGrid(PROGRESSION, "charizard").map((r) => r.level)).toEqual([4, 6, 9, 12, 15, 18, 21, 24, 27, 30]);
    expect(masteryGrid(PROGRESSION, "charmander")).toEqual(masteryGrid(PROGRESSION, "charizard"));
  });

  it("a branching evolution swaps in its form's rows; picks no longer in the tree reopen", () => {
    const forms = Object.keys(PROGRESSION.trees.eevee?.forms ?? {});
    if (!forms.length) return;
    let m: ReturnType<typeof starter> = chooseFocus(CONTENT, PROGRESSION, { ...starter("eevee", 14), focus: null }, focusOptions(PROGRESSION, "eevee")[0]!.skill);
    while (pendingChoice(CONTENT, PROGRESSION, m) === "talent") m = chooseTalent(CONTENT, PROGRESSION, m, talentOptions(CONTENT, PROGRESSION, m)[0]!);
    const grown = gainXp(CONTENT, PROGRESSION, m, xpToNext(PROGRESSION, 14)).member;
    // Eevee waits for the player's pick of its form.
    expect(grown.speciesId).toBe("eevee");
    expect(pendingChoice(CONTENT, PROGRESSION, grown)).toBe("evolution");
    expect(evolutionChoices(CONTENT, grown)).toEqual(["vaporeon", "jolteon", "flareon"]);
    const up = chooseEvolution(CONTENT, PROGRESSION, grown, "vaporeon").member;
    // The evolution swaps Eevee's Quick Attack for Vaporeon's own-type starting move.
    expect(up.knownMoves).toContain("water-pulse");
    expect(up.knownMoves).not.toContain("quick-attack");
    expect(up.speciesId).toBe("vaporeon");
    const tree = new Set([...focusOptions(PROGRESSION, "vaporeon").map((f) => f.skill), ...masteryGrid(PROGRESSION, "vaporeon").flatMap((r) => r.options)]);
    for (const id of up.talents) expect(tree.has(id), id).toBe(true);
  });

  it("Weakened deals less damage; Disabled leaves only the basic attack", () => {
    const setup = (statuses: { id: string; turnsLeft: number }[]) => {
      const { state } = createBattle(CONTENT, ["....."], [
        { id: "p", speciesId: "charmander", side: "player", pos: { x: 0, y: 0 }, stats: { ...CONTENT.species.charmander!.stats, speed: 20 }, moves: ["scratch", "flamethrower"] },
        { id: "e", speciesId: "rattata", side: "enemy", pos: { x: 1, y: 0 } },
      ]);
      return { ...state, units: state.units.map((u) => (u.id === "p" ? { ...u, statuses } : u)) };
    };
    const dmg = (st: ReturnType<typeof setup>) =>
      (applyAction(st, CONTENT, { type: "useMove", unitId: "p", moveId: "scratch", target: { x: 1, y: 0 } }).events.find((e) => e.type === "damaged") as { amount: number }).amount;
    expect(dmg(setup([{ id: "weakened", turnsLeft: 2 }]))).toBeLessThan(dmg(setup([])));
    const sealed = setup([{ id: "disabled", turnsLeft: 2 }]);
    expect(moveUnavailableReason(sealed, CONTENT, "p", "flamethrower")).toMatch(/only its basic attack/);
    expect(dmg(sealed)).toBeGreaterThan(0);
  });

  it("Confused: the next attack hits the nearest unit in reach (an ally on a tie), then it wears off", () => {
    let { state } = createBattle(CONTENT, ["......"], [
      { id: "p", speciesId: "charmander", side: "player", pos: { x: 1, y: 0 }, stats: { ...CONTENT.species.charmander!.stats, speed: 20 }, moves: ["scratch", "flamethrower"] },
      { id: "ally", speciesId: "rattata", side: "player", pos: { x: 0, y: 0 } },
      { id: "e", speciesId: "rattata", side: "enemy", pos: { x: 2, y: 0 } },
    ]);
    state = { ...state, units: state.units.map((u) => (u.id === "p" ? { ...u, statuses: [{ id: "confused", turnsLeft: 2 }] } : u)) };
    const r = applyAction(state, CONTENT, { type: "useMove", unitId: "p", moveId: "scratch", target: { x: 2, y: 0 } });
    expect(r.events).toContainEqual(expect.objectContaining({ type: "damaged", unitId: "ally" }));
    expect(r.events.some((e) => e.type === "damaged" && e.unitId === "e")).toBe(false);
    expect(r.state.units.find((u) => u.id === "p")!.statuses).toEqual([]);
  });

  it("Sleep: no action, and the first hit wakes the sleeper", () => {
    let { state } = createBattle(CONTENT, ["....."], [
      { id: "p", speciesId: "jigglypuff", side: "player", pos: { x: 0, y: 0 }, stats: { ...CONTENT.species.jigglypuff!.stats, speed: 20 }, moves: ["sing", "pound"] },
      { id: "e", speciesId: "rattata", side: "enemy", pos: { x: 1, y: 0 } },
    ]);
    state = applyAction(state, CONTENT, { type: "useMove", unitId: "p", moveId: "sing", target: { x: 1, y: 0 } }).state;
    expect(state.units.find((u) => u.id === "e")!.statuses.map((s) => s.id)).toContain("sleep");
    state = applyAction(state, CONTENT, { type: "useMove", unitId: "p", moveId: "pound", target: { x: 1, y: 0 } }).state;
    expect(state.units.find((u) => u.id === "e")!.statuses.map((s) => s.id)).not.toContain("sleep");
  });

  it("offers the options of every reached row without a pick", () => {
    const grid = masteryGrid(PROGRESSION, "charmander");
    expect(pendingChoice(CONTENT, PROGRESSION, charmander(3))).toBeNull();
    expect(talentOptions(CONTENT, PROGRESSION, charmander(grid[0]!.level))).toEqual(grid[0]!.options);
    expect(talentOptions(CONTENT, PROGRESSION, charmander(grid[1]!.level, [grid[0]!.options[0]!]))).toEqual(grid[1]!.options);
  });

  it("skill masteries teach a new move and activate it when there is room; a reset forgets them", () => {
    const grid = masteryGrid(PROGRESSION, "charmander");
    const skill = grid[1]!.options[1]!;
    const move = PROGRESSION.talents[skill]!.grantsMove!;
    const m = { ...charmander(grid[1]!.level, [grid[0]!.options[0]!]), activeMoves: ["ember"] };
    const next = chooseTalent(CONTENT, PROGRESSION, m, skill);
    expect(next.knownMoves).toContain(move);
    expect(next.activeMoves).toEqual(["ember", move]);
    const r = resetMasteries(CONTENT, next);
    expect(r.focus).toBeNull();
    expect(r.talents).toEqual([]);
    expect(r.knownMoves).not.toContain(move);
    expect(r.activeMoves).toEqual(["ember"]);
    expect(pendingChoice(CONTENT, PROGRESSION, r)).toBe("focus");
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

});

describe("level-gap XP", () => {
  it("gives less above the foes' level and more below it, within bounds", async () => {
    const { scaledXp } = await import("../../src/core/progression");
    expect(scaledXp(100, 10, [10, 10])).toBe(100);
    expect(scaledXp(100, 12, [10])).toBe(40);
    expect(scaledXp(100, 20, [10])).toBe(10);
    expect(scaledXp(100, 7, [10])).toBe(130);
    expect(scaledXp(100, 1, [10])).toBe(150);
  });
});

describe("EV rewards", () => {
  it("badges pay most, trainers some, helpful NPCs a little; the Rare Candy is not sold", async () => {
    const { completeNpc } = await import("../../src/core/story");
    const ev = PROGRESSION.rules.ev;
    const g = { roster: { party: [], storage: [], fallen: [] }, inventory: { balls: {}, items: {} }, nextUid: 1, money: 0, ev: 0 } as unknown as GameState;
    expect(completeNpc(g, { id: "l", kind: "leader" } as never, undefined, ev).ev).toBe(ev.badge);
    expect(completeNpc(g, { id: "t", kind: "trainer", team: [] } as never, undefined, ev).ev).toBe(ev.trainerWin);
    expect(completeNpc(g, { id: "q", kind: "talk", reward: { money: 10 } } as never, undefined, ev).ev).toBe(ev.quest);
    expect(() => buy(CONTENT, PROGRESSION, { ...g, money: 99999 }, "candy")).toThrow(/not sold/);
  });
});

describe("mixed focus", () => {
  it("splits its growth between the two stats, the main one taking the odd point", () => {
    expect(focusGrowth(PROGRESSION, "attack", 1)).toMatchObject({ attack: PROGRESSION.rules.focusBonus, defense: 0 });
    const lv = 1 + PROGRESSION.rules.focusGrowthEvery;
    const total = PROGRESSION.rules.focusBonus + 1;
    expect(focusGrowth(PROGRESSION, "attack", lv, "defense")).toMatchObject({ attack: Math.ceil(total / 2), defense: Math.floor(total / 2) });
  });
});
