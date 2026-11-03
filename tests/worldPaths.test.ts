import { expect, it } from "vitest";
import { WORLDS, WORLD_CONTENT } from "../src/content";
import { travelPath, worldGrid, type WorldState } from "../src/core/expedition/world";
import { key, type Point } from "../src/core/grid/types";

/**
 * Standing NPCs block their tile, so a careless placement can wall off a map (the Nugget Bridge Camper did).
 * From every way into a map, every exit, pickup and NPC must stay reachable with all trainers in place. Wild
 * bosses (Snorlax, the ghost) are deliberate gates that vanish once beaten, and obstacles open with progress,
 * so neither counts. A goal fails when it is reachable with no NPCs but not with them standing, with or without Surf.
 */
it("no standing NPC walls off part of a map", () => {
  const stuck: string[] = [];
  for (const def of Object.values(WORLDS)) {
    const npcs = (def.npcs ?? []).filter((n) => n.kind !== "wild").map((n) => key(n.pos));
    const grid = worldGrid(WORLD_CONTENT, def);
    const starts = [def.start, ...Object.values(WORLDS).flatMap((w) => (w.exits ?? []).filter((e) => e.to === def.id).map((e) => e.arrive))];
    const side = (p: Point) => [{ x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 }];
    const goals: [string, Point[]][] = [
      ...(def.exits ?? []).map((e): [string, Point[]] => [`exit ${e.name}`, [e.pos]]),
      ...(def.pickups ?? []).map((p): [string, Point[]] => [`pickup ${p.id}`, [p.pos]]),
      ...(def.npcs ?? []).map((n): [string, Point[]] => [`npc ${n.id}`, side(n.pos)]),
    ];
    for (const s of starts) {
      const world = { mapId: def.id, pos: s, encounters: [], fatigue: 0, collected: [], pickups: [] } as unknown as WorldState;
      const blocked = new Set(npcs.filter((k) => k !== key(s)));
      const reach = (spots: Point[], b: Set<string>, surf: boolean) =>
        spots.some((t) => grid.inBounds(t) && (key(t) === key(s) || travelPath(WORLD_CONTENT, def, world, t, { blocked: new Set([...b].filter((k) => k !== key(t))), surf })));
      for (const surf of [false, true])
        for (const [name, spots] of goals)
          if (reach(spots, new Set(), surf) && !reach(spots, blocked, surf)) stuck.push(`${def.id}: ${key(s)} → ${name}${surf ? " (Surf)" : ""}`);
    }
  }
  expect(stuck).toEqual([]);
});
