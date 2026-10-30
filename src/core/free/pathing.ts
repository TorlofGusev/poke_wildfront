import type { Point } from "../grid/types";
import { ALLY_GAP, bodyFits, distance, terrainAt, UNIT_RADIUS, type FreeField } from "./field";

/** Path-finding resolution: the field is sampled on a lattice this fine (in hex widths). */
export const CELL = 0.125;

/** Other bodies on the field, as the walker sees them. */
export interface FreeBody {
  readonly pos: Point;
  /** Allies can be walked through (not stopped on); foes block. */
  readonly passable: boolean;
}

export interface FreeReach {
  /** Movement points needed to stop at `p` (null: out of reach, or no room to stand). */
  costTo(p: Point): number | null;
  /** The (smoothed) walk to `p`, starting after the walker's position and ending at `p`; null if unreachable. */
  pathTo(p: Point): Point[] | null;
  /** Centres of the lattice cells the walker can stop in. */
  readonly cells: readonly Point[];
}

interface Lattice {
  readonly cols: number;
  readonly rows: number;
  /** Terrain cost per unit walked at each node, or null where a body does not fit. */
  readonly cost: readonly (number | null)[];
}

// Battle states are cloned on every action, so the same field arrives as a new object each time:
// lattices are keyed by the field's content (worked out once per object), not its identity.
const fieldKeys = new WeakMap<FreeField, string>();
const latticeCache = new Map<string, { walk?: Lattice; fly?: Lattice }>();

function latticeFor(field: FreeField, flies: boolean): Lattice {
  let key = fieldKeys.get(field);
  if (key === undefined) fieldKeys.set(field, (key = JSON.stringify(field)));
  if (!latticeCache.has(key) && latticeCache.size >= 8) latticeCache.clear();
  const entry = latticeCache.get(key) ?? latticeCache.set(key, {}).get(key)!;
  const hit = flies ? entry.fly : entry.walk;
  if (hit) return hit;
  const cols = Math.floor(field.width / CELL);
  const rows = Math.floor(field.height / CELL);
  const cost: (number | null)[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const p = { x: (c + 0.5) * CELL, y: (r + 0.5) * CELL };
      const t = terrainAt(field, p);
      cost.push(bodyFits(field, p) ? (flies ? t.flyCost : t.moveCost) : null);
    }
  const lattice = { cols, rows, cost };
  if (flies) entry.fly = lattice;
  else entry.walk = lattice;
  return lattice;
}

/** Neighbour steps: the 8 surrounding cells and the 8 knight's moves, so walks bend close to straight lines. */
const STEPS: readonly (readonly [number, number])[] = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
  [2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2],
];

/** Movement cost of the straight walk a→b over the terrain, or null if it crosses ground the body cannot pass. */
function segmentCost(field: FreeField, lat: Lattice, a: Point, b: Point, blocked: (p: Point) => boolean): number | null {
  const len = distance(a, b);
  const n = Math.max(1, Math.ceil(len / 0.1));
  let total = 0;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    const c = Math.floor(p.x / CELL);
    const r = Math.floor(p.y / CELL);
    const k = lat.cost[r * lat.cols + c];
    if (c < 0 || r < 0 || c >= lat.cols || r >= lat.rows || k == null || blocked(p)) return null;
    total += (k * len) / n;
  }
  return total;
}

/**
 * Where a walker at `from` can get with `budget` movement points: Dijkstra over a fine lattice, where each
 * unit walked costs the terrain's moveCost (mud and water twice). Foes block; allies can be crossed but not stopped on.
 */
export function freeReach(field: FreeField, from: Point, budget: number, bodies: readonly FreeBody[], flies: boolean): FreeReach {
  // A pure function of its inputs, asked again and again with the same ones (the AI simulates every spot and
  // move from the same position; the UI redraws): answers are remembered per field content and walker.
  let fk = fieldKeys.get(field);
  if (fk === undefined) fieldKeys.set(field, (fk = JSON.stringify(field)));
  let id = fieldIds.get(fk);
  if (id === undefined) {
    if (fieldIds.size >= 8) fieldIds.clear();
    fieldIds.set(fk, (id = nextFieldId++));
  }
  const key = `${id}|${from.x},${from.y}|${budget}|${flies ? 1 : 0}|${bodies.map((b) => `${b.pos.x},${b.pos.y},${b.passable ? 1 : 0}`).join(";")}`;
  const hit = reachCache.get(key);
  if (hit) return hit;
  if (reachCache.size >= 512) reachCache.clear();
  const reach = computeReach(field, from, budget, bodies, flies);
  reachCache.set(key, reach);
  return reach;
}

const fieldIds = new Map<string, number>();
let nextFieldId = 0;
const reachCache = new Map<string, FreeReach>();

function computeReach(field: FreeField, from: Point, budget: number, bodies: readonly FreeBody[], flies: boolean): FreeReach {
  const lat = latticeFor(field, flies);
  const { cols, rows } = lat;
  const near = (p: Point, d: number, list: readonly FreeBody[]) => list.some((b) => distance(b.pos, p) < d);
  const foes = bodies.filter((b) => !b.passable);
  const blocked = (p: Point) => near(p, UNIT_RADIUS * 2, foes);
  const centre = (i: number): Point => ({ x: ((i % cols) + 0.5) * CELL, y: (Math.floor(i / cols) + 0.5) * CELL });
  // Cells a walker may pass: open ground, clear of foes' bodies (worked out once, not per step).
  const open = new Uint8Array(cols * rows);
  for (let i = 0; i < open.length; i++) open[i] = lat.cost[i] != null ? 1 : 0;
  const reachCells = Math.ceil((UNIT_RADIUS * 2) / CELL) + 1;
  for (const f of foes) {
    const fc = Math.floor(f.pos.x / CELL);
    const fr = Math.floor(f.pos.y / CELL);
    for (let r = Math.max(0, fr - reachCells); r <= Math.min(rows - 1, fr + reachCells); r++)
      for (let c = Math.max(0, fc - reachCells); c <= Math.min(cols - 1, fc + reachCells); c++)
        if (open[r * cols + c] && blocked(centre(r * cols + c))) open[r * cols + c] = 0;
  }
  const walkable = (i: number) => open[i] === 1;

  const dist = new Float64Array(cols * rows).fill(Infinity);
  const prev = new Int32Array(cols * rows).fill(-1);
  const startCol = Math.min(cols - 1, Math.max(0, Math.floor(from.x / CELL)));
  const startRow = Math.min(rows - 1, Math.max(0, Math.floor(from.y / CELL)));
  const start = startRow * cols + startCol;
  dist[start] = 0;
  // The lattice measures between cell centres, the real walk between exact points: search a little further.
  const limit = budget + CELL * 4;
  // Binary heap of [cost, node].
  const heap: [number, number][] = [[0, start]];
  const push = (item: [number, number]) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p]![0] <= heap[i]![0]) break;
      [heap[p], heap[i]] = [heap[i]!, heap[p]!];
      i = p;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
        if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i]!, heap[m]!];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, i] = pop();
    if (d > dist[i]! || d > limit) continue;
    const c = i % cols;
    const r = Math.floor(i / cols);
    for (const [dc, dr] of STEPS) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const j = nr * cols + nc;
      if (!walkable(j)) continue;
      // Longer steps must not clip a corner: the cells they cut through must be open too.
      if (dc && dr && (!walkable(r * cols + (c + Math.sign(dc))) || !walkable((r + Math.sign(dr)) * cols + c))) continue;
      if (Math.abs(dc) + Math.abs(dr) === 3 && !walkable((r + (Math.abs(dr) === 2 ? Math.sign(dr) : 0)) * cols + c + (Math.abs(dc) === 2 ? Math.sign(dc) : 0))) continue;
      const step = Math.hypot(dc, dr) * CELL * ((lat.cost[i]! + lat.cost[j]!) / 2);
      const nd = d + step;
      if (nd < dist[j]! && nd <= limit) {
        dist[j] = nd;
        prev[j] = i;
        push([nd, j]);
      }
    }
  }

  const allies = bodies.filter((b) => b.passable);
  const canStand = (p: Point) => bodyFits(field, p) && !blocked(p) && !near(p, ALLY_GAP, allies);
  const nodeOf = (p: Point) => {
    const c = Math.floor(p.x / CELL);
    const r = Math.floor(p.y / CELL);
    return c < 0 || r < 0 || c >= cols || r >= rows ? -1 : r * cols + c;
  };

  const pathTo = (p: Point): Point[] | null => {
    const n = nodeOf(p);
    if (n < 0 || !Number.isFinite(dist[n]!) || !canStand(p)) return null;
    const chain: Point[] = [];
    for (let i = n; i !== start && i >= 0; i = prev[i]!) chain.unshift(centre(i));
    chain.push(p);
    // String pulling: skip corners when the straight walk is open and no dearer than the lattice walk.
    const out: Point[] = [];
    const chainCost = (from: number, to: number, pts: Point[]) => {
      let s = 0;
      for (let k = from; k < to; k++) s += segmentCost(field, lat, pts[k]!, pts[k + 1]!, () => false) ?? Infinity;
      return s;
    };
    const pts = [from, ...chain];
    let at = 0;
    while (at < pts.length - 1) {
      let best = at + 1;
      for (let k = pts.length - 1; k > at + 1; k--) {
        const direct = segmentCost(field, lat, pts[at]!, pts[k]!, blocked);
        if (direct !== null && direct <= chainCost(at, k, pts) + 1e-6) {
          best = k;
          break;
        }
      }
      out.push(pts[best]!);
      at = best;
    }
    return out;
  };

  /** Points spent stopping at `p`: the cost of the smoothed walk, which must fit the budget. */
  const costTo = (p: Point): number | null => {
    const path = pathTo(p);
    if (!path) return null;
    let s = 0;
    let a = from;
    for (const b of path) {
      s += segmentCost(field, lat, a, b, () => false) ?? Infinity;
      a = b;
    }
    return s <= budget + 1e-6 ? s : null;
  };

  const cells: Point[] = [];
  for (let i = 0; i < dist.length; i++) {
    // A walkable cell centre already fits a body and is clear of foes; only allies remain to check.
    if (dist[i]! <= budget && i !== start && open[i] && !near(centre(i), ALLY_GAP, allies)) cells.push(centre(i));
  }
  return { costTo, pathTo, cells };
}
