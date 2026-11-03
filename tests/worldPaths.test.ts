import { expect, it } from "vitest";
import { WORLDS, WORLD_CONTENT } from "../src/content";
import { worldGrid } from "../src/core/expedition/world";
import { key, type Point } from "../src/core/grid/types";

const side = (p: Point): Point[] => [{ x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 }];

/**
 * Standing NPCs block their tile, so a careless placement can wall off a map (the Nugget Bridge Camper did).
 * From every way into a map, every exit, pickup and NPC must stay reachable with all trainers in place. Wild
 * bosses (Snorlax, the ghost) are deliberate gates that vanish once beaten, and obstacles open with progress,
 * so neither counts. A goal fails when it is reachable with no NPCs but not with them standing, with or without Surf.
 * One flood fill per start keeps it fast.
 */
it("no standing NPC walls off part of a map", () => {
  const stuck: string[] = [];
  for (const def of Object.values(WORLDS)) {
    const npcs = new Set((def.npcs ?? []).filter((n) => n.kind !== "wild").map((n) => key(n.pos)));
    const starts: Point[] = [def.start, ...Object.values(WORLDS).flatMap((w) => (w.exits ?? []).filter((e) => e.to === def.id).map((e) => e.arrive))].filter((p): p is Point => !!p);
    const goals: [string, Point[]][] = [
      ...(def.exits ?? []).map((e): [string, Point[]] => [`exit ${e.name}`, [e.pos]]),
      ...(def.pickups ?? []).map((p): [string, Point[]] => [`pickup ${p.id}`, [p.pos]]),
      ...(def.npcs ?? []).map((n): [string, Point[]] => [`npc ${n.id}`, side(n.pos)]),
    ];
    for (const surf of [false, true]) {
      const grid = worldGrid(WORLD_CONTENT, def, { blocked: new Set(), surf });
      // Every tile reachable from s; a blocked tile is never entered.
      const flood = (s: Point, blocked: Set<string>) => {
        const seen = new Set([key(s)]), queue = [s];
        while (queue.length) for (const n of grid.neighbors(queue.pop()!)) {
          const k = key(n);
          if (seen.has(k) || blocked.has(k) || !grid.isPassable(n)) continue;
          seen.add(k);
          queue.push(n);
        }
        return seen;
      };
      for (const s of starts) {
        const free = flood(s, new Set()), held = flood(s, new Set([...npcs].filter((k) => k !== key(s))));
        for (const [name, spots] of goals) {
          const hit = (seen: Set<string>) => spots.some((t) => seen.has(key(t)));
          if (hit(free) && !hit(held)) stuck.push(`${def.id}: ${key(s)} → ${name}${surf ? " (Surf)" : ""}`);
        }
      }
    }
  }
  expect(stuck).toEqual([]);
}, 20000);
