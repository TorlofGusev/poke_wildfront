import { describe, expect, it } from "vitest";
import { WORLD_CONTENT, WORLDS } from "../../src/content";
import { spawnsAt } from "../../src/core/expedition";
import { knownSpecies } from "../../src/core/party";
import { newGame } from "../../src/game/session";

describe("spawn info", () => {
  it("lists an area's species with shares summing to 1 and the map's levels", () => {
    const def = WORLDS["route-2"]!;
    const zone = def.spawnZones[0]!;
    const list = spawnsAt(WORLD_CONTENT, def, zone.points[0]!);
    expect(list.length).toBeGreaterThan(0);
    expect(list.reduce((s, e) => s + e.chance, 0)).toBeCloseTo(1);
    expect(list.map((e) => e.chance)).toEqual([...list.map((e) => e.chance)].sort((a, b) => b - a));
    const lv = zone.levels ?? WORLD_CONTENT.biomes[zone.biome]!.encounters!.levels;
    expect(list[0]!.levels.min).toBeLessThanOrEqual(lv.min);
  });

  it("knows the species the player owns or has met", () => {
    const g = newGame(["bulbasaur"]);
    expect([...knownSpecies(g)]).toEqual(["bulbasaur"]);
    expect(knownSpecies({ ...g, seen: ["zubat"] }).has("zubat")).toBe(true);
  });
});
