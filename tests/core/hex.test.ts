import { describe, expect, it } from "vitest";
import { fromCube, hexDistance, hexLine, hexNeighbors, hexReachable, toCube } from "../../src/core/grid/hex";

describe("hex grid", () => {
  it("round-trips offset and cube coordinates", () => {
    for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) expect(fromCube(toCube({ x, y }))).toEqual({ x, y });
  });

  it("has six neighbours, all at distance 1", () => {
    for (const p of [{ x: 3, y: 2 }, { x: 3, y: 3 }]) {
      const ns = hexNeighbors(p);
      expect(new Set(ns.map((n) => `${n.x},${n.y}`)).size).toBe(6);
      expect(ns.every((n) => hexDistance(p, n) === 1)).toBe(true);
    }
  });

  it("draws gap-free lines", () => {
    const line = hexLine({ x: 0, y: 0 }, { x: 7, y: 5 });
    expect(line.length).toBe(hexDistance({ x: 0, y: 0 }, { x: 7, y: 5 }) + 1);
    for (let i = 1; i < line.length; i++) expect(hexDistance(line[i - 1]!, line[i]!)).toBe(1);
  });

  it("reaches a hexagon on open ground and pays terrain costs", () => {
    const open = hexReachable(20, 20, { x: 10, y: 10 }, 2, () => 1);
    expect(open.size).toBe(1 + 6 + 12);
    const mud = hexReachable(20, 20, { x: 10, y: 10 }, 2, () => 2);
    expect(mud.size).toBe(1 + 6);
  });
});
