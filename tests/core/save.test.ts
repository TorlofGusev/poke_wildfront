import { describe, expect, it } from "vitest";
import { type GameState } from "../../src/core/party";
import { loadSaveFile, SAVE_VERSION, toSaveFile } from "../../src/core/save";
import { content, pm } from "./fixtures";

const game: GameState = {
  roster: {
    party: [pm("pk1", "fast", 2, 12)],
    storage: [pm("pk2", "slow", 0, 40)],
    fallen: [pm("pk3", "mid", 3, 0)],
  },
  inventory: { balls: { "poke-ball": 4 }, items: {} },
  money: 120,
  nextUid: 4,
  world: { pos: { x: 3, y: 13 }, fatigue: 42, lastCamp: { x: 3, y: 13 }, encounters: [{ id: "wild1", pos: { x: 5, y: 5 }, biome: "route", species: ["fast"], levels: [3] }], collected: ["grove-balls"], rngState: 77, nextEncounterId: 2 },
};

const upgradeMember = (m: { uid: string; speciesId: string; hp: number; knockouts: number }) => pm(m.uid, m.speciesId, m.knockouts, m.hp, { level: 5 });
const ctx = { freshWorld: () => game.world, startPos: { x: 3, y: 13 }, upgradeMember };

const roundTrip = (g: GameState) => loadSaveFile(content, JSON.stringify(toSaveFile(g, new Date("2026-10-24T12:00:00Z"))), ctx);

describe("save/load", () => {
  it("round-trips knockouts, fallen Pokémon, storage and inventory", () => {
    const save = roundTrip(game);
    expect(save.version).toBe(SAVE_VERSION);
    expect(save.game).toEqual(game);
  });

  /** The game as a version 3 save stored it: no progression fields, money or wild levels. */
  const legacyGame = () => {
    const strip = (m: GameState["roster"]["party"][number]) => ({ uid: m.uid, speciesId: m.speciesId, hp: m.hp, knockouts: m.knockouts });
    return {
      roster: { party: game.roster.party.map(strip), storage: game.roster.storage.map(strip), fallen: game.roster.fallen.map(strip) },
      inventory: { balls: game.inventory.balls },
      nextUid: game.nextUid,
      world: { ...game.world, encounters: game.world.encounters.map(({ levels: _l, ...e }) => e) },
    };
  };

  it("migrates a version 1 save (Phase 3) and keeps party, knockouts and bag", () => {
    const { world: _world, ...v1game } = legacyGame();
    const v1 = { version: 1, savedAt: "2026-10-24T10:00:00Z", game: v1game };
    const save = loadSaveFile(content, JSON.stringify(v1), { ...ctx, freshWorld: () => ({ ...game.world, fatigue: 0 }) });
    expect(save.version).toBe(SAVE_VERSION);
    expect(save.game.roster.party).toEqual([pm("pk1", "fast", 2, 12, { level: 5 })]);
    expect(save.game.roster.fallen[0]!.knockouts).toBe(3);
    expect(save.game.inventory.balls).toEqual(game.inventory.balls);
    expect(save.game.world.fatigue).toBe(0);
  });

  it("migrates a version 2 save: fixed camp site becomes a camp tile", () => {
    const v2 = { version: 2, savedAt: "2026-10-24T11:00:00Z", game: { ...legacyGame(), world: { ...legacyGame().world, lastCamp: "forest-clearing" } } };
    const save = loadSaveFile(content, JSON.stringify(v2), ctx);
    expect(save.game.world.lastCamp).toEqual({ x: 3, y: 13 });
    expect(save.game.world.fatigue).toBe(42);
  });

  it("migrates a version 3 save: adds levels, money, bag items and wild levels", () => {
    const save = loadSaveFile(content, JSON.stringify({ version: 3, savedAt: "x", game: legacyGame() }), ctx);
    expect(save.game.money).toBe(300);
    expect(save.game.inventory.items).toEqual({});
    expect(save.game.roster.storage[0]).toMatchObject({ uid: "pk2", level: 5, knockouts: 0 });
    expect(save.game.world.encounters[0]!.levels).toEqual([4]);
  });

  it("rejects corrupt or invalid saves with readable errors", () => {
    expect(() => loadSaveFile(content, "{", ctx)).toThrow(/not valid JSON/);
    expect(() => loadSaveFile(content, "{}", ctx)).toThrow(/no version/);
    expect(() => loadSaveFile(content, JSON.stringify({ version: 99 }), ctx)).toThrow(/newer game version/);
    const bad = (patch: Partial<GameState["roster"]>) => roundTrip({ ...game, roster: { ...game.roster, ...patch } });
    const seven = Array.from({ length: 7 }, (_, i) => pm(`x${i}`, "fast", 0, 1));
    expect(() => bad({ party: seven })).toThrow(/max 6/);
    expect(() => bad({ party: [pm("pk1", "fast", 3, 1)] })).toThrow(/not fallen/);
    expect(() => bad({ fallen: [pm("pk3", "mid", 1, 0)] })).toThrow(/fallen without/);
    expect(() => bad({ storage: [pm("pk1", "slow", 0, 1)] })).toThrow(/duplicate/);
    expect(() => bad({ party: [pm("z", "missingno", 0, 1)] })).toThrow(/unknown species/);
  });
});
