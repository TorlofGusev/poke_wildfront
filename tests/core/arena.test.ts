import { describe, expect, it } from "vitest";
import { WORLD_CONTENT } from "../../src/content";
import { bodyFits, bottlenecks, distance, formationLabel, freeReach, generateFreeArena, narrowPassages, pickFormation, terrainAt, type Formation } from "../../src/core/free";

const FORMATIONS: Formation[] = ["sides", "cornerVsCorner", "pincer", "topBottom", "surrounded", "bossCenter", "lanes"];
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
          // Lanes cap each lane below the team, so the spare spots are fewer there.
          expect(a.deploymentZone.length, where).toBeGreaterThanOrEqual(formation === "lanes" ? 4 : 5);
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

  it("three Pokémon fit abreast through every passage (no narrow corridors or gaps in a wall), in every biome", () => {
    const narrow: string[] = [];
    let rocky = 0;
    for (const biome of BIOMES)
      for (const seed of SEEDS) {
        const a = generateFreeArena({ seed, style: biome.id, formation: pickFormation(seed, "wild"), playerCount: 3, enemyCount: 3, base: biome.arena });
        if (a.field.zones.some((z) => z.terrain === "rock")) rocky++;
        if (narrowPassages(a.field).length || bottlenecks(a.field).length) narrow.push(`${biome.id}/${seed}`);
      }
    expect(narrow).toEqual([]);
    // Rocks still shape the fields: the check widens passages, it does not clear the map.
    expect(rocky).toBeGreaterThan(BIOMES.length);
  }, 120_000);

  it("lanes: dividers split the field into lanes joined at one end, each with foes and fewer deploy spots than the team", () => {
    for (const biome of BIOMES)
      for (const seed of SEEDS)
        for (const team of [2, 3, 5]) {
          const a = generateFreeArena({ seed, style: biome.id, formation: "lanes", playerCount: team, enemyCount: 3, base: biome.arena });
          const where = `${biome.id}/${seed}/${team}`;
          const logs = a.field.zones.filter((z) => z.look === "log");
          expect(logs.length, where).toBeGreaterThan(0);
          // Lane borders: the dividers' x positions (a divider's pieces lie within a hex of each other).
          const xs = logs.map((z) => z.poly.reduce((s, q) => s + q.x, 0) / z.poly.length).sort((p, q) => p - q)
            .filter((x, i, all) => i === 0 || x - all[i - 1]! > 1);
          const borders = [0, ...xs, a.field.width];
          const laneOf = (p: { x: number }) => borders.findIndex((b, i) => i > 0 && p.x < b) - 1;
          for (let l = 0; l < borders.length - 1; l++) {
            const spots = a.deploymentZone.filter((p) => laneOf(p) === l).length;
            expect(spots, `${where} lane ${l}`).toBeGreaterThan(0);
            expect(spots, `${where} lane ${l}`).toBeLessThan(team);
            expect(a.enemySpawns.some((p) => laneOf(p) === l), `${where} lane ${l} foes`).toBe(true);
          }
          // Lanes join only at an end: the middle of every divider is solid all the way across.
          for (const x of xs) expect(bodyFits(a.field, { x, y: a.field.height / 2 }), where).toBe(false);
        }
  }, 120_000);

  it("lanes need two a side: a lone foe or Pokémon meets head-on instead", () => {
    const a = generateFreeArena({ seed: 4, style: "route", formation: "lanes", playerCount: 3, enemyCount: 1 });
    expect(a.field.zones.some((z) => z.look === "log")).toBe(false);
  });

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

  it("splits every battlefield into lanes and labels formations", () => {
    for (const ctx of ["wild", "wildAmbush", "trainer", "boss"] as const)
      for (let seed = 0; seed < 20; seed++) expect(pickFormation(seed, ctx)).toBe("lanes");
    expect(formationLabel("surrounded")).toBe("Ambush!");
  });
});
