import { describe, expect, it } from "vitest";
import { CAMP, CONTENT, MEALS, PROGRESSION, WORLD, WORLD_CONTENT } from "../../src/content";
import { newWorld } from "../../src/core/expedition";
import { canCook, centerHeal, centerTreatment, centerTreatmentCost, newMember, rest, useRemedy, type GameState } from "../../src/core/party";
import { memberStats } from "../../src/core/progression";

function game(items: Record<string, number>): GameState {
  const m = newMember(CONTENT, PROGRESSION, "charmander", 1, 5);
  return {
    roster: { party: [{ ...m, hp: 10 }], storage: [], fallen: [] },
    inventory: { balls: {}, items },
    nextUid: 2,
    money: 0,
    world: { ...newWorld(WORLD_CONTENT, WORLD, 1), fatigue: 80 },
  };
}
const world = { content: WORLD_CONTENT, def: WORLD };

describe("camp meals", () => {
  it("a meal uses its ingredients, fully rests the team and lasts until the next rest", () => {
    const g = game({ "oran-berry": 3, "cheri-berry": 1 });
    expect(canCook(g, MEALS["hearty-stew"]!)).toBe(true);
    const r = rest(CONTENT, PROGRESSION, world, CAMP, g, MEALS["hearty-stew"]!);
    expect(r.inventory.items).toMatchObject({ "oran-berry": 1, "cheri-berry": 0 });
    expect(r.roster.party[0]!.hp).toBe(memberStats(CONTENT, PROGRESSION, r.roster.party[0]!).maxHp);
    expect(r.world).toMatchObject({ fatigue: 0, meal: { id: "hearty-stew", bond: { startBond: 1 } } });
  });

  it("refuses a meal without enough ingredients", () => {
    expect(() => rest(CONTENT, PROGRESSION, world, CAMP, game({ "oran-berry": 1 }), MEALS["simple-meal"]!)).toThrow(/not enough ingredients/);
  });

  it("resting hungry restores only part of the HP and fatigue, with a Bond penalty", () => {
    const r = rest(CONTENT, PROGRESSION, world, CAMP, game({}), null);
    const max = memberStats(CONTENT, PROGRESSION, r.roster.party[0]!).maxHp;
    expect(r.roster.party[0]!.hp).toBe(Math.round(max * CAMP.hungry.hpFraction));
    expect(r.world.fatigue).toBe(CAMP.hungry.fatigue);
    expect(r.world.meal).toMatchObject({ id: "hungry", bond: { startBond: -1 } });
  });

  it("every meal uses known food items", () => {
    for (const meal of Object.values(MEALS))
      for (const id of Object.keys(meal.ingredients)) expect(PROGRESSION.items[id]?.kind, `${meal.id}: ${id}`).toBe("food");
  });
});

describe("Pokémon Center", () => {
  it("heals everyone to full for free and leaves fatigue alone", () => {
    const g = game({});
    const r = centerHeal(CONTENT, PROGRESSION, g);
    expect(r.roster.party[0]!.hp).toBe(memberStats(CONTENT, PROGRESSION, r.roster.party[0]!).maxHp);
    expect(r.world.fatigue).toBe(80);
    expect(r.money).toBe(0);
  });
});

describe("knockout marks", () => {
  it("a Revival Herb removes one mark; Center treatment removes all for a fee", () => {
    const g = game({ "revival-herb": 1 });
    const marked = { ...g, money: 1000, roster: { ...g.roster, party: [{ ...g.roster.party[0]!, knockouts: 2 }] } };
    const herb = useRemedy(PROGRESSION, marked, marked.roster.party[0]!.uid, "revival-herb");
    expect(herb.roster.party[0]!.knockouts).toBe(1);
    expect(herb.inventory.items["revival-herb"]).toBe(0);
    expect(centerTreatmentCost(marked, CAMP.treatmentPerMark)).toBe(2 * CAMP.treatmentPerMark);
    const treated = centerTreatment(marked, CAMP.treatmentPerMark);
    expect(treated.roster.party[0]!.knockouts).toBe(0);
    expect(treated.money).toBe(1000 - 2 * CAMP.treatmentPerMark);
    expect(() => centerTreatment(treated, CAMP.treatmentPerMark)).toThrow(/no knockout marks/);
  });
});
