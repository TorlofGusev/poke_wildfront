import { describe, expect, it } from "vitest";
import { createBattle, movementPoints, moveRange, threatZone, unitById } from "../../src/core/battle";
import { gridDistance, key } from "../../src/core/grid";
import { content } from "./fixtures";

const OPEN = Array(9).fill("...............");

describe("threatZone", () => {
  it("covers the foe's full move and the reach of its damaging moves beyond it", () => {
    const species = Object.keys(content.species);
    const state = createBattle(content, OPEN, [
      { id: "p", speciesId: species[0]!, side: "player", pos: { x: 0, y: 0 } },
      { id: "e", speciesId: species[1]!, side: "enemy", pos: { x: 7, y: 4 } },
    ]).state;
    const foe = unitById(state, "e");
    const { reach, strike } = threatZone(state, content, "e");
    const mp = movementPoints(content, foe, state);
    expect(reach.length).toBeGreaterThan(0);
    expect(reach.every((p) => gridDistance(p, foe.pos) <= mp)).toBe(true);
    const maxRange = Math.max(...foe.moves.map((m) => content.moves[m]!).filter((m) => m.power > 0).map((m) => moveRange(foe, m).max));
    expect(strike.every((p) => reach.some((s) => gridDistance(s, p) <= maxRange) || gridDistance(foe.pos, p) <= maxRange)).toBe(true);
    // Strike tiles extend the reach, never overlap it.
    const reachKeys = new Set(reach.map(key));
    expect(strike.some((p) => reachKeys.has(key(p)))).toBe(false);
  });
});
