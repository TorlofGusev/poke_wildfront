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
  world: { mapId: "route-2", pos: { x: 3, y: 13 }, fatigue: 42, lastCamp: { x: 3, y: 13 }, encounters: [{ id: "wild1", pos: { x: 5, y: 5 }, biome: "route", species: ["fast"], levels: [3] }], collected: ["grove-balls"], rngState: 77, nextEncounterId: 2, meal: null },
};

const roundTrip = (g: GameState) => loadSaveFile(content, JSON.stringify(toSaveFile(g, new Date("2026-10-24T12:00:00Z"))));

describe("save/load", () => {
  it("round-trips knockouts, fallen Pokémon, storage and inventory", () => {
    const save = roundTrip(game);
    expect(save.version).toBe(SAVE_VERSION);
    expect(save.game).toEqual(game);
  });

  it("rejects saves from other prototype versions instead of migrating them", () => {
    const old = { ...toSaveFile(game, new Date()), version: SAVE_VERSION + 1 };
    expect(() => loadSaveFile(content, JSON.stringify(old))).toThrow(/another prototype version/);
  });

  it("rejects corrupt or invalid saves with readable errors", () => {
    expect(() => loadSaveFile(content, "{")).toThrow(/not valid JSON/);
    expect(() => loadSaveFile(content, "{}")).toThrow(/no version/);
    expect(() => loadSaveFile(content, JSON.stringify({ version: 99 }))).toThrow(/another prototype version/);
    const bad = (patch: Partial<GameState["roster"]>) => roundTrip({ ...game, roster: { ...game.roster, ...patch } });
    const seven = Array.from({ length: 7 }, (_, i) => pm(`x${i}`, "fast", 0, 1));
    expect(() => bad({ party: seven })).toThrow(/max 6/);
    expect(() => bad({ party: [pm("pk1", "fast", 3, 1)] })).toThrow(/not fallen/);
    expect(() => bad({ fallen: [pm("pk3", "mid", 1, 0)] })).toThrow(/fallen without/);
    expect(() => bad({ storage: [pm("pk1", "slow", 0, 1)] })).toThrow(/duplicate/);
    expect(() => bad({ party: [pm("z", "missingno", 0, 1)] })).toThrow(/unknown species/);
  });
});
