import type { Grid } from "./Grid";
import { hexNeighbors } from "./hex";
import { key, NEIGHBOR_OFFSETS, type Point } from "./types";

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

/**
 * Dijkstra flood fill limited by movement points. Deterministic tie-breaking.
 * With `hex`, the grid is read as hexes (battles): six neighbours, each step paying the terrain cost.
 * Without it, four-directional squares (the overworld).
 */
export function reachableTiles(
  grid: Grid,
  start: Point,
  movePoints: number,
  occupancy: Occupancy = EMPTY_OCCUPANCY,
  hex = false,
): Reachable {
  type Node = { readonly p: Point; readonly odd: boolean };
  const nodeKey = (n: Node) => `${key(n.p)}|${n.odd ? 1 : 0}`;
  const best = new Map<string, number>([[nodeKey({ p: start, odd: false }), 0]]);
  const prevNode = new Map<string, Node>();
  const cost = new Map<string, number>([[key(start), 0]]);
  const bestNode = new Map<string, Node>([[key(start), { p: start, odd: false }]]);
  const points = new Map<string, Point>([[key(start), start]]);
  const frontier: Node[] = [{ p: start, odd: false }];

  while (frontier.length > 0) {
    // Small grids: a sorted array is fast enough and keeps order deterministic.
    frontier.sort((a, b) => best.get(nodeKey(a))! - best.get(nodeKey(b))! || a.p.y - b.p.y || a.p.x - b.p.x || Number(a.odd) - Number(b.odd));
    const current = frontier.shift()!;
    const currentCost = best.get(nodeKey(current))!;

    const nexts = hex ? hexNeighbors(current.p) : NEIGHBOR_OFFSETS.map((o) => ({ x: current.p.x + o.x, y: current.p.y + o.y }));
    for (const next of nexts) {
      if (!grid.inBounds(next)) continue;
      const step = grid.terrainAt(next).moveCost;
      if (step === null || occupancy.isEnemy(next)) continue;
      const nextCost = currentCost + step;
      if (nextCost > movePoints) continue;
      const node: Node = { p: next, odd: false };
      const nk = nodeKey(node);
      if (nextCost < (best.get(nk) ?? Infinity)) {
        best.set(nk, nextCost);
        prevNode.set(nk, current);
        frontier.push(node);
        const k = key(next);
        if (nextCost < (cost.get(k) ?? Infinity)) {
          cost.set(k, nextCost);
          bestNode.set(k, node);
          points.set(k, next);
        }
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
      let cur: Node | undefined = bestNode.get(k);
      while (cur && key(cur.p) !== startKey) {
        path.unshift(cur.p);
        cur = prevNode.get(nodeKey(cur));
      }
      return path;
    },
  };
}
