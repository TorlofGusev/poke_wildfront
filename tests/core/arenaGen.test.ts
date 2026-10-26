import { describe, expect, it } from "vitest";
import { WORLD_CONTENT } from "../../src/content";
import { formationLabel, generateArena, pickFormation, type Formation } from "../../src/core/battle/arenaGen";
import { ASCII_LEGEND } from "../../src/core/grid/Grid";
import { gridDistance, key, type Point } from "../../src/core/grid/types";

const FORMATIONS: Formation[] = ["sides", "cornerVsCorner", "pincer", "topBottom", "surrounded", "bossCenter"];
const BIOMES = Object.values(WORLD_CONTENT.biomes).filter((b) => b.arena);
const SEEDS = Array.from({ length: 20 }, (_, i) => i * 7919 + 1);

const passable = (rows: string[], p: Point) => ASCII_LEGEND[rows[p.y]![p.x]!]!.moveCost !== null;

function component(rows: string[], start: Point): Set<string> {
  const seen = new Set([key(start)]);
  const q = [start];
  while (q.length) {
    const p = q.shift()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = { x: p.x + dx!, y: p.y + dy! };
      if (n.x < 0 || n.y < 0 || n.y >= rows.length || n.x >= rows[0]!.length) continue;
      if (seen.has(key(n)) || !passable(rows, n)) continue;
      seen.add(key(n));
      q.push(n);
    }
  }
  return seen;
}

describe("generateArena", () => {
  it("has biomes to test", () => expect(BIOMES.length).toBeGreaterThan(10));

  for (const biome of BIOMES) {
    it(`meets guarantees for ${biome.id}`, () => {
      const base = biome.arena!;
      for (const formation of FORMATIONS) {
        for (const seed of SEEDS) {
          const playerCount = 3 + (seed % 4);
          const enemyCount = 2 + (seed % 5);
          const opts = { seed, style: biome.id, formation, playerCount, enemyCount, base };
          const a = generateArena(opts);
          expect(generateArena(opts)).toEqual(a);
          expect(a.mapRows.length).toBe(base.mapRows.length);
          for (const r of a.mapRows) {
            expect(r.length).toBe(16);
            for (const c of r) expect(ASCII_LEGEND[c]).toBeDefined();
          }
          expect(a.deploymentZone.length).toBeGreaterThanOrEqual(playerCount + 2);
          expect(a.enemySpawns.length).toBe(enemyCount);
          const all = [...a.deploymentZone, ...a.enemySpawns];
          expect(new Set(all.map(key)).size).toBe(all.length);
          const comp = component(a.mapRows, a.deploymentZone[0]!);
          for (const p of all) {
            expect(a.mapRows[p.y]![p.x]).toBe(".");
            expect(comp.has(key(p))).toBe(true);
          }
          const min = Math.min(...a.deploymentZone.flatMap((d) => a.enemySpawns.map((e) => gridDistance(d, e))));
          expect(min).toBeGreaterThanOrEqual(formation === "surrounded" ? 2 : 3);
          const nonFloor = a.mapRows.join("").split("").filter((c) => c !== ".").length / (16 * a.mapRows.length);
          expect(nonFloor).toBeLessThan(0.45);
        }
      }
    });
  }

  it("varies across seeds", () => {
    const base = BIOMES[0]!.arena!;
    const maps = new Set(SEEDS.map((seed) => generateArena({ seed, style: "x", formation: "sides", playerCount: 4, enemyCount: 3, base }).mapRows.join("\n")));
    expect(maps.size).toBeGreaterThan(15);
  });

  it("works without a base arena", () => {
    const a = generateArena({ seed: 5, style: "cave", formation: "pincer", playerCount: 4, enemyCount: 4 });
    expect(a.mapRows.length).toBe(10);
    expect(a.enemySpawns.length).toBe(4);
  });
});

describe("pickFormation", () => {
  it("respects the context pools", () => {
    for (let s = 0; s < 50; s++) {
      expect(["sides", "cornerVsCorner", "pincer", "topBottom"]).toContain(pickFormation(s, "wild"));
      expect(["surrounded", "pincer"]).toContain(pickFormation(s, "wildAmbush"));
      expect(["sides", "topBottom"]).toContain(pickFormation(s, "trainer"));
      expect(pickFormation(s, "boss")).toBe("bossCenter");
    }
    expect(formationLabel("surrounded")).toBe("Ambush!");
  });
});
