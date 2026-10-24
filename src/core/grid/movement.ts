import type { Grid } from "./Grid";
import { key, type Point } from "./types";

/**
 * Who stands where, from the moving unit's point of view.
 * Units may pass through allies but never through enemies,
 * and may never end their move on an occupied tile.
 */
export interface Occupancy {
  isAlly(p: Point): boolean;
  isEnemy(p: Point): boolean;
}

export const EMPTY_OCCUPANCY: Occupancy = { isAlly: () => false, isEnemy: () => false };

export interface Reachable {
  /** Movement points spent to reach each tile, keyed by `key(point)`. */
  readonly cost: ReadonlyMap<string, number>;
  /** Tiles the unit may end its move on (excludes start and occupied tiles). */
  readonly destinations: readonly Point[];
  /** Shortest path from start (exclusive) to `to` (inclusive), or null. */
  pathTo(to: Point): Point[] | null;
}

/** Dijkstra flood fill limited by movement points. Deterministic tie-breaking. */
export function reachableTiles(
  grid: Grid,
  start: Point,
  movePoints: number,
  occupancy: Occupancy = EMPTY_OCCUPANCY,
): Reachable {
  const cost = new Map<string, number>([[key(start), 0]]);
  const prev = new Map<string, Point>();
  const points = new Map<string, Point>([[key(start), start]]);
  const frontier: Point[] = [start];

  while (frontier.length > 0) {
    // Small grids: a sorted array is fast enough and keeps order deterministic.
    frontier.sort((a, b) => cost.get(key(a))! - cost.get(key(b))! || a.y - b.y || a.x - b.x);
    const current = frontier.shift()!;
    const currentCost = cost.get(key(current))!;

    for (const next of grid.neighbors(current)) {
      const step = grid.terrainAt(next).moveCost;
      if (step === null || occupancy.isEnemy(next)) continue;
      const nextCost = currentCost + step;
      if (nextCost > movePoints) continue;
      const k = key(next);
      if (nextCost < (cost.get(k) ?? Infinity)) {
        cost.set(k, nextCost);
        prev.set(k, current);
        points.set(k, next);
        frontier.push(next);
      }
    }
  }

  const startKey = key(start);
  const destinations = [...points.entries()]
    .filter(([k, p]) => k !== startKey && !occupancy.isAlly(p))
    .map(([, p]) => p);

  return {
    cost,
    destinations,
    pathTo(to: Point): Point[] | null {
      const k = key(to);
      if (k === startKey || !destinations.some((d) => key(d) === k)) return null;
      const path: Point[] = [];
      let cur: Point | undefined = to;
      while (cur && key(cur) !== startKey) {
        path.unshift(cur);
        cur = prev.get(key(cur));
      }
      return path;
    },
  };
}
