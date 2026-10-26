import type { Grid } from "./Grid";
import { DIAGONAL_OFFSETS, key, NEIGHBOR_OFFSETS, type Point } from "./types";

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
 * With `diagonal`, units also step diagonally: every second diagonal step costs 1 extra
 * (matching `gridDistance`), and a diagonal step may not cut the corner of impassable terrain.
 */
export function reachableTiles(
  grid: Grid,
  start: Point,
  movePoints: number,
  occupancy: Occupancy = EMPTY_OCCUPANCY,
  diagonal = false,
): Reachable {
  // Search state: tile plus whether an odd number of diagonal steps was taken (the next one costs extra).
  type Node = { readonly p: Point; readonly odd: boolean };
  const nodeKey = (n: Node) => `${key(n.p)}|${n.odd ? 1 : 0}`;
  const best = new Map<string, number>([[nodeKey({ p: start, odd: false }), 0]]);
  const prevNode = new Map<string, Node>();
  const cost = new Map<string, number>([[key(start), 0]]);
  const bestNode = new Map<string, Node>([[key(start), { p: start, odd: false }]]);
  const points = new Map<string, Point>([[key(start), start]]);
  const frontier: Node[] = [{ p: start, odd: false }];
  const offsets = diagonal ? [...NEIGHBOR_OFFSETS, ...DIAGONAL_OFFSETS] : NEIGHBOR_OFFSETS;

  while (frontier.length > 0) {
    // Small grids: a sorted array is fast enough and keeps order deterministic.
    frontier.sort((a, b) => best.get(nodeKey(a))! - best.get(nodeKey(b))! || a.p.y - b.p.y || a.p.x - b.p.x || Number(a.odd) - Number(b.odd));
    const current = frontier.shift()!;
    const currentCost = best.get(nodeKey(current))!;

    for (const o of offsets) {
      const next = { x: current.p.x + o.x, y: current.p.y + o.y };
      if (!grid.inBounds(next)) continue;
      const step = grid.terrainAt(next).moveCost;
      if (step === null || occupancy.isEnemy(next)) continue;
      const isDiagonal = o.x !== 0 && o.y !== 0;
      if (isDiagonal) {
        const sideA = { x: current.p.x + o.x, y: current.p.y };
        const sideB = { x: current.p.x, y: current.p.y + o.y };
        if (grid.terrainAt(sideA).moveCost === null || grid.terrainAt(sideB).moveCost === null) continue;
      }
      const nextCost = currentCost + step + (isDiagonal && current.odd ? 1 : 0);
      if (nextCost > movePoints) continue;
      const node: Node = { p: next, odd: isDiagonal ? !current.odd : current.odd };
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
