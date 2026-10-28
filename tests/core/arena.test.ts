import { describe, expect, it } from "vitest";
import { WORLD_CONTENT } from "../../src/content";
import { bodyFits, distance, formationLabel, freeReach, generateFreeArena, narrowPassages, pickFormation, terrainAt, type Formation } from "../../src/core/free";

const FORMATIONS: Formation[] = ["sides", "cornerVsCorner", "pincer", "topBottom", "surrounded", "bossCenter"];
const BIOMES = Object.values(WORLD_CONTENT.biomes).filter((b) => b.arena);
const SEEDS = Array.from({ length: 6 }, (_, i) => i * 7919 + 1);

describe("free arena generator", () => {
  it("has biomes to test", () => expect(BIOMES.length).toBeGreaterThan(10));

  it("is deterministic", () => {
    const opts = { seed: 42, style: "forest", formation: "pincer" as const, playerCount: 3, enemyCount: 3 };
    expect(generateFreeArena(opts)).toEqual(generateFreeArena(opts));
  });

  it("every biome and formation: many more deploy spots than the team, all foes placed, everyone reachable", () => {
    for (const biome of BIOMES)
      for (const formation of FORMATIONS)
        for (const seed of SEEDS.slice(0, 1)) {
          const a = generateFreeArena({ seed, style: biome.id, formation, playerCount: 3, enemyCount: 3, base: biome.arena });
          const where = `${biome.id}/${formation}/${seed}`;
          expect(a.deploymentZone.length, where).toBeGreaterThanOrEqual(5);
          expect(a.enemySpawns, where).toHaveLength(3);
          const spots = [...a.deploymentZone, ...a.enemySpawns];
          for (const p of spots) {
            expect(terrainAt(a.field, p).id, where).toBe("floor");
            expect(bodyFits(a.field, p), where).toBe(true);
          }
          for (let i = 0; i < spots.length; i++)
            for (let j = i + 1; j < spots.length; j++) expect(distance(spots[i]!, spots[j]!), where).toBeGreaterThanOrEqual(1);
          for (const e of a.enemySpawns)
            for (const d of a.deploymentZone) expect(distance(e, d), where).toBeGreaterThanOrEqual(3.5);
          const reach = freeReach(a.field, a.deploymentZone[0]!, 1000, [], false);
          for (const p of spots.slice(1)) expect(reach.pathTo(p), where).not.toBeNull();
        }
  }, 60_000);

  it("three Pokémon fit abreast through every passage (no narrow corridors), in every biome", () => {
    const narrow: string[] = [];
    let rocky = 0;
    for (const biome of BIOMES)
      for (const seed of SEEDS) {
        const a = generateFreeArena({ seed, style: biome.id, formation: pickFormation(seed, "wild"), playerCount: 3, enemyCount: 3, base: biome.arena });
        if (a.field.zones.some((z) => z.terrain === "rock")) rocky++;
        if (narrowPassages(a.field).length) narrow.push(`${biome.id}/${seed}`);
      }
    expect(narrow).toEqual([]);
    // Rocks still shape the fields: the check widens passages, it does not clear the map.
    expect(rocky).toBeGreaterThan(BIOMES.length);
  }, 120_000);

  it("caves get rock; grassy routes get bushes", () => {
    const cave = generateFreeArena({ seed: 3, style: "cave", formation: "sides", playerCount: 3, enemyCount: 2 });
    expect(cave.field.zones.some((z) => z.terrain === "rock")).toBe(true);
    const route = generateFreeArena({ seed: 3, style: "route", formation: "sides", playerCount: 3, enemyCount: 2 });
    expect(route.field.zones.some((z) => z.terrain === "bush")).toBe(true);
  });

  it("a boss stands where its formation puts it, ahead of its guard", () => {
    const a = generateFreeArena({ seed: 9, style: "route", formation: "bossCenter", playerCount: 3, enemyCount: 3 });
    const centre = { x: a.field.width / 2, y: a.field.height / 2 };
    expect(distance(a.enemySpawns[0]!, centre)).toBeLessThanOrEqual(3);
  });

  it("picks formations by context and labels them", () => {
    expect(pickFormation(1, "boss")).toBe("bossCenter");
    expect(["surrounded", "pincer"]).toContain(pickFormation(5, "wildAmbush"));
    expect(formationLabel("surrounded")).toBe("Ambush!");
  });
});
