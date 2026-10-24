import { describe, expect, it } from "vitest";
import { type GameState } from "../../src/core/party";
import { loadSaveFile, SAVE_VERSION, toSaveFile } from "../../src/core/save";
import { content } from "./fixtures";

const game: GameState = {
  roster: {
    party: [{ uid: "pk1", speciesId: "fast", hp: 12, knockouts: 2 }],
    storage: [{ uid: "pk2", speciesId: "slow", hp: 40, knockouts: 0 }],
    fallen: [{ uid: "pk3", speciesId: "mid", hp: 0, knockouts: 3 }],
  },
  inventory: { balls: { "poke-ball": 4 } },
  nextUid: 4,
  world: { pos: { x: 3, y: 13 }, fatigue: 42, lastCamp: { x: 3, y: 13 }, encounters: [{ id: "wild1", pos: { x: 5, y: 5 }, biome: "route", species: ["fast"] }], collected: ["grove-balls"], rngState: 77, nextEncounterId: 2 },
};

const ctx = { freshWorld: () => game.world, startPos: { x: 3, y: 13 } };

const roundTrip = (g: GameState) => loadSaveFile(content, JSON.stringify(toSaveFile(g, new Date("2026-10-24T12:00:00Z"))), ctx);

describe("save/load", () => {
  it("round-trips knockouts, fallen Pokémon, storage and inventory", () => {
    const save = roundTrip(game);
    expect(save.version).toBe(SAVE_VERSION);
    expect(save.game).toEqual(game);
  });

  it("migrates a version 1 save (Phase 3) and keeps party, knockouts and bag", () => {
    const { world: _world, ...v1game } = game;
    const v1 = { version: 1, savedAt: "2026-10-24T10:00:00Z", game: v1game };
    const save = loadSaveFile(content, JSON.stringify(v1), { freshWorld: () => ({ ...game.world, fatigue: 0 }), startPos: { x: 3, y: 13 } });
    expect(save.version).toBe(SAVE_VERSION);
    expect(save.game.roster).toEqual(game.roster);
    expect(save.game.inventory).toEqual(game.inventory);
    expect(save.game.world.fatigue).toBe(0);
  });

  it("migrates a version 2 save: fixed camp site becomes a camp tile", () => {
    const v2 = { version: 2, savedAt: "2026-10-24T11:00:00Z", game: { ...game, world: { ...game.world, lastCamp: "forest-clearing" } } };
    const save = loadSaveFile(content, JSON.stringify(v2), ctx);
    expect(save.game.world.lastCamp).toEqual({ x: 3, y: 13 });
    expect(save.game.world.fatigue).toBe(42);
  });

  it("rejects corrupt or invalid saves with readable errors", () => {
    expect(() => loadSaveFile(content, "{", ctx)).toThrow(/not valid JSON/);
    expect(() => loadSaveFile(content, "{}", ctx)).toThrow(/no version/);
    expect(() => loadSaveFile(content, JSON.stringify({ version: 99 }), ctx)).toThrow(/newer game version/);
    const bad = (patch: Partial<GameState["roster"]>) => roundTrip({ ...game, roster: { ...game.roster, ...patch } });
    const seven = Array.from({ length: 7 }, (_, i) => ({ uid: `x${i}`, speciesId: "fast", hp: 1, knockouts: 0 }));
    expect(() => bad({ party: seven })).toThrow(/max 6/);
    expect(() => bad({ party: [{ uid: "pk1", speciesId: "fast", hp: 1, knockouts: 3 }] })).toThrow(/not fallen/);
    expect(() => bad({ fallen: [{ uid: "pk3", speciesId: "mid", hp: 0, knockouts: 1 }] })).toThrow(/fallen without/);
    expect(() => bad({ storage: [{ uid: "pk1", speciesId: "slow", hp: 1, knockouts: 0 }] })).toThrow(/duplicate/);
    expect(() => bad({ party: [{ uid: "z", speciesId: "missingno", hp: 1, knockouts: 0 }] })).toThrow(/unknown species/);
  });
});
