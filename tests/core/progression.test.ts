import { describe, expect, it } from "vitest";
import { CONTENT, PROGRESSION } from "../../src/content";
import { applyAction, createBattle, isSpecialMove, maxHpAt, moveRange } from "../../src/core/battle";
import { allocatePoint, buy, equipItem, sell, newMember, resolveBattle, usePotion, type GameState } from "../../src/core/party";
import {
  chooseRole,
  chooseTalent,
  gainXp,
  memberModifiers,
  memberStats,
  pendingChoice,
  setActiveMoves,
  talentFor,
  talentOptions,
  wildForm,
  wildSetup,
  masteryGrid,
  chooseEvolution,
  evolutionChoices,
  memberGrid,
  pathOf,
  pathOptions,
  pathStartSkill,
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
    expect(fresh.statPoints).toEqual({ hp: 1, attack: 1, defense: 0, spAttack: 2, spDefense: 0, speed: 0 });
    const up = gainXp(CONTENT, PROGRESSION, fresh, xpToNext(PROGRESSION, 5)).member;
    expect(up.unspentPoints).toBe(1);
    expect(memberStats(CONTENT, PROGRESSION, up).stats).toEqual(memberStats(CONTENT, PROGRESSION, fresh).stats);
  });

  it("type profiles give small stats: Fire is a striker, Rock a fortress", () => {
    expect(CONTENT.species.charmander!.stats).toEqual({ hp: 4, attack: 7, defense: 3, spAttack: 8, spDefense: 5, speed: 6 });
    // Geodude: Rock/Ground average, +1 Defense nudge.
    expect(CONTENT.species.geodude!.stats).toEqual({ hp: 6, attack: 6, defense: 8, spAttack: 3, spDefense: 4, speed: 1 });
    for (const sp of Object.values(CONTENT.species)) for (const v of Object.values(sp.stats)) expect(v).toBeLessThanOrEqual(10);
  });

  it("grows the chosen role's stats every level, and max HP with level and Defense", () => {
    const m = { ...starter("squirtle", 10), role: "tank" };
    const at = (level: number) => memberStats(CONTENT, PROGRESSION, { ...m, level });
    const growth = PROGRESSION.roles.tank!.growth;
    expect(at(20).stats.defense - at(10).stats.defense).toBe(Math.floor(growth.defense! * 19) - Math.floor(growth.defense! * 9));
    expect(at(20).stats.speed).toBe(at(10).stats.speed);
    expect(at(20).maxHp).toBeGreaterThan(at(10).maxHp);
    const r = CONTENT.rules;
    // Sturdier species (higher base Defense) gain more HP per level; Defense growth itself does not add HP.
    expect(maxHpAt(CONTENT, 5, 8, 20) - maxHpAt(CONTENT, 5, 3, 20)).toBe(Math.round(19 * (r.hpPerLevel + r.hpPerLevelPerDefense * 8)) - Math.round(19 * (r.hpPerLevel + r.hpPerLevelPerDefense * 3)));
    expect(at(20).maxHp - at(10).maxHp).toBe(maxHpAt(CONTENT, at(20).stats.hp, CONTENT.species.squirtle!.stats.defense, 20) - maxHpAt(CONTENT, at(10).stats.hp, CONTENT.species.squirtle!.stats.defense, 10));
  });

  it("splits moves by type: Fire/Water/Grass/... use Sp. Atk vs Sp. Def, the rest Attack vs Defense", () => {
    expect(isSpecialMove(CONTENT, CONTENT.moves.ember!)).toBe(true);
    expect(isSpecialMove(CONTENT, CONTENT.moves.tackle!)).toBe(false);
    expect(isSpecialMove(CONTENT, { ...CONTENT.moves.tackle!, category: "special" })).toBe(true);
  });

  it("Sharpshooter: ranged moves reach further, melee moves do not; strong at distance", () => {
    const m = { ...starter("pikachu", 10), role: "sharpshooter", talents: ["long-shot"] };
    const unit = toUnitSetup(CONTENT, PROGRESSION, m) as { mods: ReturnType<typeof memberModifiers> };
    expect(moveRange(unit, CONTENT.moves["thunder-shock"]!)).toEqual({ min: 1, max: 3 });
    expect(unit.mods.shootOver).toBe(true);
    expect(moveRange(unit, CONTENT.moves["quick-attack"]!)).toEqual({ min: 1, max: 1 });
    expect(unit.mods.farDamage).toBeGreaterThan(1);
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
  it("asks for a path at the role level, then one mastery per reached row", () => {
    let m = { ...starter("charmander", 2), role: null };
    expect(pendingChoice(CONTENT, PROGRESSION, m)).toBeNull();
    m = { ...m, level: 3 };
    expect(pendingChoice(CONTENT, PROGRESSION, m)).toBe("role");
    expect(() => chooseRole(CONTENT, PROGRESSION, m, "tank:fire")).toThrow();
    m = chooseRole(CONTENT, PROGRESSION, m, "striker:fire") as typeof m;
    expect(pendingChoice(CONTENT, PROGRESSION, m)).toBeNull();
    m = { ...m, level: 4 };
    const [a, b] = talentOptions(CONTENT, PROGRESSION, m);
    m = chooseTalent(CONTENT, PROGRESSION, m, a!) as typeof m;
    expect(() => chooseTalent(CONTENT, PROGRESSION, m, b!)).toThrow(/no talent choice/);
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
  it("roles, talents, items and learnsets reference valid data", () => {
    for (const s of Object.values(CONTENT.species)) {
      for (const r of s.roles ?? []) expect(PROGRESSION.roles, `${s.id} role ${r}`).toHaveProperty(r);
      for (const l of s.learnset ?? []) expect(CONTENT.moves, `${s.id} learns ${l.move}`).toHaveProperty(l.move);
      if (s.evolution) expect(CONTENT.species, `${s.id} evolves`).toHaveProperty(s.evolution.into);
      expect(s.roles?.length, `${s.id} roles`).toBe(2);
    }
    for (const b of Object.values(CONTENT.balls)) expect(b.price).toBeGreaterThan(0);
  });
});

describe("mastery grid", () => {
  const charmander = (level: number, talents: string[] = []) => ({ ...starter("charmander", level), role: "striker", talents });

  it("one tree per path: dual types have a fixed role and choose a type, single types choose a role", () => {
    expect(pathOptions(CONTENT, PROGRESSION, { speciesId: "bulbasaur" })).toEqual(["tank:grass", "tank:poison"]);
    expect(pathOptions(CONTENT, PROGRESSION, { speciesId: "charmander" })).toEqual(["striker:fire", "sharpshooter:fire"]);
    // Every tree: 10 rows of 2 from the role and type kits, one kind per row, no repeats, a start skill.
    for (const sp of Object.values(CONTENT.species))
      for (const path of pathOptions(CONTENT, PROGRESSION, { speciesId: sp.id })) {
        const rows = masteryGrid(CONTENT, PROGRESSION, sp.id, path);
        expect(rows.map((r) => r.level), `${sp.id}/${path}`).toEqual([4, 6, 9, 12, 15, 18, 21, 24, 27, 30]);
        const ids = rows.flatMap((r) => r.options);
        expect(new Set(ids).size, `${sp.id}/${path} repeats a mastery`).toBe(ids.length);
        for (const row of rows) {
          expect(row.options.length).toBe(2);
          for (const o of row.options) expect(PROGRESSION.talents, o).toHaveProperty(o);
          const kinds = new Set(row.options.map((o) => Boolean(PROGRESSION.talents[o]!.grantsMove)));
          expect(kinds.size, `${sp.id}/${path} Lv ${row.level} mixes skills and passives`).toBe(1);
        }
        const start = pathStartSkill(PROGRESSION, path)!;
        expect(CONTENT.moves, start).toHaveProperty(PROGRESSION.talents[start]!.grantsMove!);
      }
    // The path keeps role + type and grants its starting skill.
    const m = chooseRole(CONTENT, PROGRESSION, { ...starter("bulbasaur", 3), role: null }, "tank:poison");
    expect(m).toMatchObject({ role: "tank", focus: "poison" });
    expect(m.talents).toEqual([pathStartSkill(PROGRESSION, "tank:poison")]);
    expect(pathOf(CONTENT, m)).toBe("tank:poison");
  });

  it("an evolution that drops the path's type moves the path to the new type and keeps only masteries still in the tree", () => {
    let m: ReturnType<typeof starter> = chooseRole(CONTENT, PROGRESSION, { ...starter("eevee", 14), role: null }, pathOptions(CONTENT, PROGRESSION, { speciesId: "eevee" })[0]!);
    while (pendingChoice(CONTENT, PROGRESSION, m) === "talent") m = chooseTalent(CONTENT, PROGRESSION, m, talentOptions(CONTENT, PROGRESSION, m)[0]!);
    const grown = gainXp(CONTENT, PROGRESSION, m, xpToNext(PROGRESSION, 14)).member;
    // Eevee waits for the player's pick of its form.
    expect(grown.speciesId).toBe("eevee");
    expect(pendingChoice(CONTENT, PROGRESSION, grown)).toBe("evolution");
    expect(evolutionChoices(CONTENT, grown)).toEqual(["vaporeon", "jolteon", "flareon"]);
    const up = chooseEvolution(CONTENT, PROGRESSION, grown, "vaporeon").member;
    expect(up.speciesId).toBe("vaporeon");
    expect(up.focus).toBe("water");
    const tree = new Set([pathStartSkill(PROGRESSION, pathOf(CONTENT, up)!, "vaporeon"), ...masteryGrid(CONTENT, PROGRESSION, "vaporeon", pathOf(CONTENT, up)).flatMap((r) => r.options)]);
    for (const id of up.talents) expect(tree.has(id), id).toBe(true);
  });

  it("an evolution that adds a type opens a gift row from that type's kit; Sleep ends on a hit", () => {
    let m: ReturnType<typeof starter> = chooseRole(CONTENT, PROGRESSION, { ...starter("charmeleon", 19), role: null }, "striker:fire");
    while (pendingChoice(CONTENT, PROGRESSION, m) === "talent") m = chooseTalent(CONTENT, PROGRESSION, m, talentOptions(CONTENT, PROGRESSION, m)[0]!);
    const up = gainXp(CONTENT, PROGRESSION, m, xpToNext(PROGRESSION, 19)).member;
    expect(up.speciesId).toBe("charizard");
    expect(up.bonusType).toEqual({ type: "flying", level: up.level });
    const gift = memberGrid(CONTENT, PROGRESSION, up).find((r) => r.options.includes(PROGRESSION.kits!.types.flying!.start));
    expect(gift).toBeDefined();
    expect(talentOptions(CONTENT, PROGRESSION, up)).toEqual(expect.arrayContaining([...gift!.options]));
    // Sleep: no action, and the first hit wakes the sleeper.
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
    const grid = masteryGrid(CONTENT, PROGRESSION, "charmander", "striker:fire");
    expect(pendingChoice(CONTENT, PROGRESSION, charmander(3))).toBeNull();
    expect(talentOptions(CONTENT, PROGRESSION, charmander(grid[0]!.level))).toEqual(grid[0]!.options);
    expect(talentOptions(CONTENT, PROGRESSION, charmander(grid[1]!.level, [grid[0]!.options[0]!]))).toEqual(grid[1]!.options);
  });

  it("skill masteries teach a new move and activate it when there is room", () => {
    const grid = masteryGrid(CONTENT, PROGRESSION, "charmander", "striker:fire");
    const skillRow = grid.findIndex((r) => r.options.includes("skill-focus-energy"));
    const before = grid.slice(0, skillRow).map((r) => r.options[0]!);
    const m = { ...charmander(grid[skillRow]!.level, before), activeMoves: ["ember"] };
    const next = chooseTalent(CONTENT, PROGRESSION, m, "skill-focus-energy");
    expect(next.knownMoves).toContain("focus-energy--fire");
    // A Fire Pokémon learns the Fire version of the skill (Sunny Day), named after it.
    expect(talentFor(CONTENT, PROGRESSION, "skill-focus-energy", ["fire"]).name).toBe("Sunny Day");
    expect(talentFor(CONTENT, PROGRESSION, "skill-focus-energy", ["normal"]).name).toBe("Focus Energy");
    expect(next.activeMoves).toEqual(["ember", "focus-energy--fire"]);
  });

  it("a reset forgets the role, masteries and the moves they taught", () => {
    const grid = masteryGrid(CONTENT, PROGRESSION, "charmander", "striker:fire");
    const skillRow = grid.findIndex((r) => r.options.includes("skill-focus-energy"));
    const m = chooseTalent(CONTENT, PROGRESSION, { ...charmander(grid[skillRow]!.level, grid.slice(0, skillRow).map((r) => r.options[0]!)), activeMoves: ["ember"] }, "skill-focus-energy");
    const r = resetMasteries(CONTENT, m);
    expect(r.role).toBeNull();
    expect(r.talents).toEqual([]);
    expect(r.knownMoves).not.toContain("focus-energy--fire");
    expect(r.activeMoves).toEqual(["ember"]);
    expect(pendingChoice(CONTENT, PROGRESSION, r)).toBe("role");
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
