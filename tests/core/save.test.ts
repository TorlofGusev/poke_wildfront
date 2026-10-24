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
};

const roundTrip = (g: GameState) => loadSaveFile(content, JSON.stringify(toSaveFile(g, new Date("2026-10-24T12:00:00Z"))));

describe("save/load", () => {
  it("round-trips knockouts, fallen Pokémon, storage and inventory", () => {
    const save = roundTrip(game);
    expect(save.version).toBe(SAVE_VERSION);
    expect(save.game).toEqual(game);
  });

  it("rejects corrupt or invalid saves with readable errors", () => {
    expect(() => loadSaveFile(content, "{")).toThrow(/not valid JSON/);
    expect(() => loadSaveFile(content, "{}")).toThrow(/no version/);
    expect(() => loadSaveFile(content, JSON.stringify({ version: 99 }))).toThrow(/newer game version/);
    const bad = (patch: Partial<GameState["roster"]>) => roundTrip({ ...game, roster: { ...game.roster, ...patch } });
    const seven = Array.from({ length: 7 }, (_, i) => ({ uid: `x${i}`, speciesId: "fast", hp: 1, knockouts: 0 }));
    expect(() => bad({ party: seven })).toThrow(/max 6/);
    expect(() => bad({ party: [{ uid: "pk1", speciesId: "fast", hp: 1, knockouts: 3 }] })).toThrow(/not fallen/);
    expect(() => bad({ fallen: [{ uid: "pk3", speciesId: "mid", hp: 0, knockouts: 1 }] })).toThrow(/fallen without/);
    expect(() => bad({ storage: [{ uid: "pk1", speciesId: "slow", hp: 1, knockouts: 0 }] })).toThrow(/duplicate/);
    expect(() => bad({ party: [{ uid: "z", speciesId: "missingno", hp: 1, knockouts: 0 }] })).toThrow(/unknown species/);
  });
});
