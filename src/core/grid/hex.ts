import type { Point } from "./types";

/**
 * Hex grid helpers for the hex battle prototype: pointy-top hexes in "odd-r" offset layout
 * (every odd row is shifted half a hex to the right), so maps stay plain width × height arrays.
 * Distances and lines are computed in cube coordinates.
 */

interface Cube {
  readonly q: number;
  readonly r: number;
  readonly s: number;
}

export const toCube = (p: Point): Cube => {
  const q = p.x - (p.y - (p.y & 1)) / 2;
  return { q, r: p.y, s: -q - p.y };
};

export const fromCube = (c: Cube): Point => ({ x: c.q + (c.r - (c.r & 1)) / 2, y: c.r });

export const hexDistance = (a: Point, b: Point): number => {
  const ca = toCube(a), cb = toCube(b);
  return Math.max(Math.abs(ca.q - cb.q), Math.abs(ca.r - cb.r), Math.abs(ca.s - cb.s));
};

const CUBE_DIRS: readonly Cube[] = [
  { q: 1, r: 0, s: -1 }, { q: 1, r: -1, s: 0 }, { q: 0, r: -1, s: 1 },
  { q: -1, r: 0, s: 1 }, { q: -1, r: 1, s: 0 }, { q: 0, r: 1, s: -1 },
];

/** The six neighbours (some may be off the map). */
export const hexNeighbors = (p: Point): Point[] => {
  const c = toCube(p);
  return CUBE_DIRS.map((d) => fromCube({ q: c.q + d.q, r: c.r + d.r, s: c.s + d.s }));
};

const roundCube = (q: number, r: number, s: number): Cube => {
  let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  else rs = -rq - rr;
  return { q: rq, r: rr, s: rs };
};

/** Hexes on the straight line from a to b, both ends included. */
export const hexLine = (a: Point, b: Point): Point[] => {
  const n = hexDistance(a, b);
  const ca = toCube(a), cb = toCube(b);
  // A tiny nudge keeps the line off hex edges, so it never wobbles between two neighbours.
  const e = 1e-6;
  const out: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n;
    out.push(fromCube(roundCube(ca.q + (cb.q - ca.q) * t + e, ca.r + (cb.r - ca.r) * t + e, ca.s + (cb.s - ca.s) * t - 2 * e)));
  }
  return out;
};

/**
 * Movement points needed to reach each hex from start (Dijkstra). `cost` gives a hex's entry cost or null
 * when impassable; `blocked` hexes can be neither entered nor crossed.
 */
export function hexReachable(
  width: number,
  height: number,
  start: Point,
  movePoints: number,
  cost: (p: Point) => number | null,
  blocked: (p: Point) => boolean = () => false,
): Map<string, number> {
  const k = (p: Point) => `${p.x},${p.y}`;
  const best = new Map<string, number>([[k(start), 0]]);
  const open: { p: Point; c: number }[] = [{ p: start, c: 0 }];
  while (open.length) {
    open.sort((a, b) => a.c - b.c);
    const { p, c } = open.shift()!;
    if (c > (best.get(k(p)) ?? Infinity)) continue;
    for (const n of hexNeighbors(p)) {
      if (n.x < 0 || n.y < 0 || n.x >= width || n.y >= height || blocked(n)) continue;
      const step = cost(n);
      if (step === null) continue;
      const nc = c + step;
      if (nc > movePoints || nc >= (best.get(k(n)) ?? Infinity)) continue;
      best.set(k(n), nc);
      open.push({ p: n, c: nc });
    }
  }
  return best;
}

/** Centre of a hex in units of hex width (for direction maths). */
const pixel = (p: Point) => ({ x: p.x + (p.y & 1 ? 0.5 : 0), y: p.y * (Math.sqrt(3) / 2) });

/** The neighbour of `p` in direction `dir` (0–5; dir + 3 is the opposite one). */
export const hexStep = (p: Point, dir: number): Point => {
  const c = toCube(p), d = CUBE_DIRS[((dir % 6) + 6) % 6]!;
  return fromCube({ q: c.q + d.q, r: c.r + d.r, s: c.s + d.s });
};

/** Which of the six directions points most closely from `from` towards `to`. */
export const hexDirToward = (from: Point, to: Point): number => {
  const a = pixel(from), b = pixel(to);
  const vx = b.x - a.x, vy = b.y - a.y;
  let best = 0, bestDot = -Infinity;
  for (let i = 0; i < 6; i++) {
    const n = pixel(hexStep(from, i));
    const dot = (n.x - a.x) * vx + (n.y - a.y) * vy;
    if (dot > bestDot + 1e-9) {
      bestDot = dot;
      best = i;
    }
  }
  return best;
};

/** True if b lies on one of the six straight lines through a. */
export const hexOnAxis = (a: Point, b: Point): boolean => {
  const ca = toCube(a), cb = toCube(b);
  return ca.q === cb.q || ca.r === cb.r || ca.s === cb.s;
};

/**
 * Hexes strictly between a and b on the straight line. When the line runs exactly along a hex edge,
 * both hexes beside it count, so edges block conservatively and the result is symmetric.
 */
export const hexBetween = (a: Point, b: Point): Point[] => {
  const n = hexDistance(a, b);
  if (n <= 1) return [];
  const ca = toCube(a), cb = toCube(b);
  const seen = new Map<string, Point>();
  for (const e of [1e-6, -1e-6])
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const p = fromCube(roundCube(ca.q + (cb.q - ca.q) * t + e, ca.r + (cb.r - ca.r) * t + e, ca.s + (cb.s - ca.s) * t - 2 * e));
      seen.set(`${p.x},${p.y}`, p);
    }
  return [...seen.values()];
};
