import { describe, expect, it } from "vitest";
import { CONTENT, WORLD_CONTENT, WORLDS } from "../../src/content";
import { deploySlotsFor, spawnSpotNear, spawnsAt } from "../../src/core/expedition";
import { turnSpent } from "../../src/core/free";
import type { BattleState } from "../../src/core/battle";
import { trainerLook } from "../../src/game/trainerLook";
import { createFreeBattle } from "./freeFixture";

/** p1 (Charmander) on turn, having acted, with `left` movement; foes far unless one is moved into reach. */
const onTurn = (left: number, patch: Partial<NonNullable<BattleState["turn"]>> = {}, foeNextTo = false): BattleState => {
  const { state } = createFreeBattle(CONTENT);
  const p1 = state.units.find((u) => u.id === "p1")!;
  const units = state.units.map((u) => (u.id === "e2" && foeNextTo ? { ...u, pos: { x: p1.pos.x + 2, y: p1.pos.y } } : u));
  return { ...state, units, turn: { unitId: "p1", movePointsLeft: left, actionUsed: true, basicUsed: true, fresh: false, ...patch } };
};

describe("logic behind the screens", () => {
  it("a turn is spent once movement is a sliver and no move has anything in reach", () => {
    expect(turnSpent(onTurn(0.1), CONTENT)).toBe(true);
    expect(turnSpent(onTurn(0.6), CONTENT)).toBe(false); // can still walk
    expect(turnSpent(onTurn(0.1, { fresh: true }), CONTENT)).toBe(false); // has done nothing yet
    expect(turnSpent(onTurn(0.1, { basicUsed: false }, true), CONTENT)).toBe(false); // a foe is in reach of its moves
  });

  it("deploy slots: 3 before the first badge, one more per badge, never past the map's size", () => {
    expect(deploySlotsFor(4, 0)).toBe(3);
    expect(deploySlotsFor(4, 1)).toBe(4);
    expect(deploySlotsFor(4, 3)).toBe(4);
    expect(deploySlotsFor(5, 2)).toBe(5);
    expect(deploySlotsFor(3, 8)).toBe(3);
  });

  it("the wild list off spawn ground uses the nearest spawn spot of the map", () => {
    const def = WORLDS["route-3"]!;
    const spot = def.spawnZones[0]!.points[0]!;
    expect(spawnSpotNear(WORLD_CONTENT, def, spot)).toEqual(spot);
    const path = def.start;
    expect(spawnsAt(WORLD_CONTENT, def, path)).toEqual([]);
    const near = spawnSpotNear(WORLD_CONTENT, def, path);
    expect(spawnsAt(WORLD_CONTENT, def, near).length).toBeGreaterThan(0);
    const all = def.spawnZones.flatMap((z) => z.points);
    const d = (q: { x: number; y: number }) => Math.hypot(q.x - path.x, q.y - path.y);
    expect(d(near)).toBe(Math.min(...all.map(d)));
  });

  it("trainers dress by the first word of their name, else by their kind", () => {
    expect(trainerLook("Bug Catcher Rick", "trainer")).toBe("bug");
    expect(trainerLook("Youngster Ben", "trainer")).toBe("youngster");
    expect(trainerLook("Team Rocket Grunt", "rocket")).toBe("rocket");
    expect(trainerLook("Brock", "leader")).toBe("leader");
    expect(trainerLook("Lorelei", "elite")).toBe("elite");
    expect(trainerLook("Mystery Man", "trainer")).toBe("trainer");
    // Every map trainer gets a look of its own class, not the generic one.
    const generic = Object.values(WORLDS).flatMap((w) => w.npcs ?? [])
      .filter((n) => n.kind === "trainer" && !n.sprite && trainerLook(n.name, n.kind) === "trainer").map((n) => n.name);
    expect(generic).toEqual([]);
  });
});
