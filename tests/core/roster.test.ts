import { describe, expect, it } from "vitest";
import { applyAction, createBattle, type BattleState } from "../../src/core/battle";
import {
  addPokemon,
  moveBetweenPartyAndStorage,
  newMember,
  resolveBattle,
  restAll,
  type GameState,
  type PartyMember,
} from "../../src/core/party";
import { content, pm, prog } from "./fixtures";

const member = (uid: string, knockouts = 0, hp = 40): PartyMember => pm(uid, "fast", knockouts, hp);

function game(party: PartyMember[], storage: PartyMember[] = []): GameState {
  return { roster: { party, storage, fallen: [] }, inventory: { balls: { "poke-ball": 2 }, items: {} }, nextUid: 100, money: 0,
    world: { pos: { x: 0, y: 0 }, fatigue: 0, lastCamp: { x: 0, y: 0 }, encounters: [], collected: [], rngState: 1, nextEncounterId: 1 },
  };
}

/** A battle where player unit `a` (hp 1) is knocked out by the enemy's first move. */
function battleWhereAFaints(extra: { id: string }[] = []): BattleState {
  let { state } = createBattle(content, [".....", "....."], [
    { id: "a", speciesId: "slow", side: "player", pos: { x: 0, y: 0 }, hp: 1 },
    ...extra.map((e, i) => ({ id: e.id, speciesId: "slow", side: "player" as const, pos: { x: 0, y: 1 + i }, hp: 40 })),
    { id: "e", speciesId: "fast", side: "enemy", pos: { x: 1, y: 0 } },
  ], { balls: { "poke-ball": 2 } });
  state = applyAction(state, content, { type: "useMove", unitId: "e", moveId: "tackle", target: { x: 0, y: 0 } }).state;
  if (state.outcome === "ongoing") state = applyAction(state, content, { type: "endTurn", unitId: "e" }).state;
  return state;
}

describe("party limits", () => {
  it("adds to the party until 6, then to storage", () => {
    let g = game([1, 2, 3, 4, 5].map((i) => member(`m${i}`)));
    let r = addPokemon(g, member("m6"));
    expect(r.to).toBe("party");
    r = addPokemon(r.game, member("m7"));
    expect(r.to).toBe("storage");
    expect(r.game.roster.party).toHaveLength(6);
    g = r.game;
    expect(() => moveBetweenPartyAndStorage(g.roster, "m7")).toThrow(/full/);
    const swapped = moveBetweenPartyAndStorage(moveBetweenPartyAndStorage(g.roster, "m1"), "m7");
    expect(swapped.party.map((m) => m.uid)).toContain("m7");
    expect(swapped.storage.map((m) => m.uid)).toEqual(["m1"]);
  });

  it("never empties the party", () => {
    expect(() => moveBetweenPartyAndStorage(game([member("a")]).roster, "a")).toThrow(/at least one/);
  });
});

describe("knockouts and permanent death", () => {
  it("increments the counter only for Pokémon that fainted", () => {
    const g = game([member("a"), member("b"), member("c")]);
    let state = battleWhereAFaints([{ id: "b" }]);
    state = applyAction(state, content, { type: "retreat", unitId: "b" }).state;
    const { game: next, summary } = resolveBattle(content, prog, g, state);
    expect(summary.knockedOut).toEqual(["a"]);
    const ko = Object.fromEntries(next.roster.party.map((m) => [m.uid, m.knockouts]));
    expect(ko).toEqual({ a: 1, b: 0, c: 0 });
  });

  it("moves a Pokémon to fallen on its third knockout, permanently", () => {
    const g = game([member("a", 2), member("b")]);
    let state = battleWhereAFaints([{ id: "b" }]);
    state = applyAction(state, content, { type: "retreat", unitId: "b" }).state;
    const { game: next, summary } = resolveBattle(content, prog, g, state);
    expect(summary.fallen).toEqual(["a"]);
    expect(next.roster.party.map((m) => m.uid)).toEqual(["b"]);
    expect(next.roster.fallen).toEqual([pm("a", "fast", 3, 0)]);
    const rested = restAll(content, prog, next.roster);
    expect(rested.fallen[0]!.hp).toBe(0);
    expect(rested.party.map((m) => m.uid)).toEqual(["b"]);
  });

  it("does not reset knockouts on rest", () => {
    const r = restAll(content, prog, game([member("a", 2, 3)]).roster);
    expect(r.party[0]).toMatchObject({ hp: 40, knockouts: 2 });
  });

  it("ignores knockouts in scripted battles", () => {
    const g = game([member("a", 2), member("b")]);
    let state = battleWhereAFaints([{ id: "b" }]);
    state = applyAction(state, content, { type: "retreat", unitId: "b" }).state;
    const { game: next } = resolveBattle(content, prog, g, state, { countsKnockouts: false });
    expect(next.roster.party.find((m) => m.uid === "a")!.knockouts).toBe(2);
  });

  it("on defeat records knockouts and rests the party at camp", () => {
    const g = game([member("a", 0)]);
    const state = battleWhereAFaints();
    expect(state.outcome).toBe("defeat");
    const { game: next } = resolveBattle(content, prog, g, state);
    expect(next.roster.party[0]).toMatchObject({ knockouts: 1, hp: 40 });
  });

  it("refuses to resolve an unfinished battle", () => {
    const { state } = createBattle(content, ["..."], [
      { id: "a", speciesId: "fast", side: "player", pos: { x: 0, y: 0 } },
      { id: "e", speciesId: "slow", side: "enemy", pos: { x: 2, y: 0 } },
    ]);
    expect(() => resolveBattle(content, prog, game([member("a")]), state)).toThrow(/not finished/);
  });
});

describe("captured Pokémon after battle", () => {
  it("joins the party or storage at its battle HP, with fresh ids, and balls are updated", () => {
    let { state } = createBattle(content, ["....."], [
      { id: "a", speciesId: "fast", side: "player", pos: { x: 0, y: 0 } },
      { id: "e", speciesId: "slow", side: "enemy", pos: { x: 1, y: 0 }, hp: 3 },
    ], { captureAllowed: true, balls: { "poke-ball": 1 } });
    state = { ...state, units: state.units.map((u) => (u.id === "e" ? { ...u, captured: true } : u)), outcome: "victory", balls: { "poke-ball": 0 } };
    const full = game([1, 2, 3, 4, 5, 6].map((i) => member(`m${i}`)).map((m, i) => (i === 0 ? { ...m, uid: "a" } : m)));
    const { game: next, summary } = resolveBattle(content, prog, full, state);
    expect(summary.captured).toEqual([{ member: pm("pk100", "slow", 0, 3, { activeMoves: ["ember"] }), to: "storage" }]);
    expect(next.nextUid).toBe(101);
    expect(next.inventory.balls["poke-ball"]).toBe(0);
    expect(newMember(content, prog, "mid", 5, 1)).toMatchObject({ uid: "pk5", speciesId: "mid", hp: 40, knockouts: 0, level: 1 });
  });
});
