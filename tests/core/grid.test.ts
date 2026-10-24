import { describe, expect, it } from "vitest";
import {
  Grid,
  hasLineOfSight,
  key,
  reachableTiles,
  tilesBetween,
  type Occupancy,
  type Point,
} from "../../src/core/grid";

const keys = (ps: readonly Point[]) => ps.map(key).sort();

const occupancy = (allies: Point[], enemies: Point[]): Occupancy => ({
  isAlly: (p) => allies.some((a) => key(a) === key(p)),
  isEnemy: (p) => enemies.some((e) => key(e) === key(p)),
});

describe("Grid", () => {
  it("parses ASCII maps and reports terrain", () => {
    const g = Grid.fromAscii([".#", '"~']);
    expect(g.width).toBe(2);
    expect(g.terrainAt({ x: 1, y: 0 }).id).toBe("wall");
    expect(g.terrainAt({ x: 0, y: 1 }).id).toBe("grass");
    expect(g.isPassable({ x: 1, y: 1 })).toBe(false);
    expect(g.isPassable({ x: 5, y: 5 })).toBe(false);
  });

  it("rejects ragged rows and unknown characters", () => {
    expect(() => Grid.fromAscii(["..", "."])).toThrow();
    expect(() => Grid.fromAscii(["?"])).toThrow();
  });
});

describe("reachableTiles", () => {
  it("returns a diamond on open ground", () => {
    const g = Grid.fromAscii([".....", ".....", ".....", ".....", "....."]);
    const r = reachableTiles(g, { x: 2, y: 2 }, 2);
    expect(r.destinations).toHaveLength(12);
    expect(r.cost.get("0,2")).toBe(2);
    expect(r.cost.has("0,0")).toBe(false);
  });

  it("does not enter walls or water and pays extra for mud", () => {
    const g = Grid.fromAscii(["..#..", ".m~..", "....."]);
    const r = reachableTiles(g, { x: 0, y: 0 }, 3);
    expect(r.cost.has("2,0")).toBe(false);
    expect(r.cost.has("2,1")).toBe(false);
    expect(r.cost.get("1,1")).toBe(3); // 1 floor step + 2 to enter mud
    expect(r.cost.get("1,2")).toBe(3); // around the mud via floor, not through it (would be 4)
  });

  it("walks around walls with a shortest path", () => {
    const g = Grid.fromAscii(["...", ".#.", "..."]);
    const r = reachableTiles(g, { x: 0, y: 1 }, 4);
    const path = r.pathTo({ x: 2, y: 1 })!;
    expect(path).toHaveLength(4);
    expect(key(path[path.length - 1]!)).toBe("2,1");
    expect(path.every((p) => g.isPassable(p))).toBe(true);
  });

  it("passes through allies but cannot stop on them", () => {
    const g = Grid.fromAscii(["....."]);
    const r = reachableTiles(g, { x: 0, y: 0 }, 3, occupancy([{ x: 1, y: 0 }], []));
    expect(keys(r.destinations)).toEqual(["2,0", "3,0"]);
    expect(r.pathTo({ x: 1, y: 0 })).toBeNull();
  });

  it("is blocked by enemies", () => {
    const g = Grid.fromAscii(["....."]);
    const r = reachableTiles(g, { x: 0, y: 0 }, 4, occupancy([], [{ x: 2, y: 0 }]));
    expect(keys(r.destinations)).toEqual(["1,0"]);
  });

  it("returns null paths for unreachable or start tiles", () => {
    const g = Grid.fromAscii(["..#.."]);
    const r = reachableTiles(g, { x: 0, y: 0 }, 5);
    expect(r.pathTo({ x: 4, y: 0 })).toBeNull();
    expect(r.pathTo({ x: 0, y: 0 })).toBeNull();
  });

  it("is deterministic", () => {
    const g = Grid.fromAscii(["....", "....", "...."]);
    const a = reachableTiles(g, { x: 0, y: 0 }, 5).pathTo({ x: 3, y: 2 });
    const b = reachableTiles(g, { x: 0, y: 0 }, 5).pathTo({ x: 3, y: 2 });
    expect(a).toEqual(b);
  });
});

describe("line of sight", () => {
  const g = Grid.fromAscii([
    ".....",
    "..#..",
    ".....",
    '.."".',
  ]);

  it("is blocked by walls in a straight line", () => {
    expect(hasLineOfSight(g, { x: 2, y: 0 }, { x: 2, y: 2 })).toBe(false);
    expect(hasLineOfSight(g, { x: 0, y: 1 }, { x: 4, y: 1 })).toBe(false);
  });

  it("is clear in open ground and through grass", () => {
    expect(hasLineOfSight(g, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(true);
    expect(hasLineOfSight(g, { x: 0, y: 3 }, { x: 4, y: 3 })).toBe(true);
  });

  it("is symmetric", () => {
    for (let ax = 0; ax < 5; ax++)
      for (let ay = 0; ay < 4; ay++)
        for (let bx = 0; bx < 5; bx++)
          for (let by = 0; by < 4; by++) {
            const a = { x: ax, y: ay };
            const b = { x: bx, y: by };
            if (g.terrainAt(a).blocksSight || g.terrainAt(b).blocksSight) continue;
            expect(hasLineOfSight(g, a, b)).toBe(hasLineOfSight(g, b, a));
          }
  });

  it("treats exact corners conservatively", () => {
    expect(keys(tilesBetween({ x: 0, y: 0 }, { x: 2, y: 2 }))).toEqual(["0,1", "1,0", "1,1", "1,2", "2,1"]);
    // Diagonal past the wall corner at (2,1) is blocked.
    expect(hasLineOfSight(g, { x: 1, y: 0 }, { x: 3, y: 2 })).toBe(false);
  });

  it("adjacent tiles always see each other", () => {
    expect(tilesBetween({ x: 0, y: 0 }, { x: 1, y: 0 })).toEqual([]);
  });
});
