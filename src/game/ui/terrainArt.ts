import Phaser from "phaser";
import { tileRand, type BoardTheme } from "./boardDecor";

/**
 * Terrain patches on the battle board, drawn with depth instead of flat fills: rocks with a shadow, a lit
 * top face and facets; bushes as a canopy of leafy clumps; water deepening towards the middle with a
 * foamy shore; mud with a wet centre and glossy spots. Everything is seeded, so a board always looks the same.
 */

type V = Phaser.Math.Vector2;
const vec = (x: number, y: number) => new Phaser.Math.Vector2(x, y);

const centroid = (pts: V[]): V => vec(pts.reduce((s, p) => s + p.x, 0) / pts.length, pts.reduce((s, p) => s + p.y, 0) / pts.length);
const shift = (pts: V[], dx: number, dy: number) => pts.map((p) => vec(p.x + dx, p.y + dy));
const shrink = (pts: V[], k: number, dx = 0, dy = 0) => {
  const c = centroid(pts);
  return pts.map((p) => vec(c.x + (p.x - c.x) * k + dx, c.y + (p.y - c.y) * k + dy));
};

function inside(pts: V[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!, b = pts[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/** Points on a jittered grid inside the patch. */
function scatter(pts: V[], step: number, seed: number): V[] {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const out: V[] = [];
  for (let y = Math.min(...ys); y <= Math.max(...ys); y += step)
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += step) {
      const jx = x + (tileRand(Math.round(x), Math.round(y), seed) - 0.5) * step * 0.8;
      const jy = y + (tileRand(Math.round(x), Math.round(y), seed + 1) - 0.5) * step * 0.8;
      if (inside(pts, jx, jy)) out.push(vec(jx, jy));
    }
  return out;
}

const ROCK: Record<BoardTheme, { side: number; top: number; light: number }> = {
  field: { side: 0x34373e, top: 0x5c606a, light: 0x8a909c },
  cave: { side: 0x2e2824, top: 0x5e544a, light: 0x8a7e70 },
  shore: { side: 0x4a4436, top: 0x7a705a, light: 0xa89c80 },
  indoor: { side: 0x30333c, top: 0x555a66, light: 0x7d8290 },
};

export function drawRock(g: Phaser.GameObjects.Graphics, pts: V[], theme: BoardTheme): void {
  const c = ROCK[theme];
  g.fillStyle(0x000000, 0.35).fillPoints(shift(pts, 4, 7), true);
  g.fillStyle(c.side, 1).fillPoints(pts, true);
  const top = shrink(pts, 0.8, -1, -5);
  g.fillStyle(c.top, 1).fillPoints(top, true);
  // Light from the top left: edges facing up or left catch it.
  for (let i = 0; i < top.length; i++) {
    const a = top[i]!, b = top[(i + 1) % top.length]!;
    const nx = b.y - a.y, ny = -(b.x - a.x);
    if (ny + nx * 0.5 < 0) g.lineStyle(2, c.light, 0.9).lineBetween(a.x, a.y, b.x, b.y);
  }
  // Facets: a few creases from the middle of the top face.
  const mid = centroid(top);
  g.lineStyle(1, 0x000000, 0.3);
  top.forEach((p, i) => {
    if (i % 3 === 0) g.lineBetween(mid.x, mid.y, mid.x + (p.x - mid.x) * 0.7, mid.y + (p.y - mid.y) * 0.7);
  });
  g.lineStyle(2, 0x0e0f12, 0.75).strokePoints(pts, true, true);
}

export function drawBush(g: Phaser.GameObjects.Graphics, pts: V[], seed: number): void {
  // Round leafy silhouette: clumps along the edge instead of the polygon's straight sides.
  const rim: V[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
    const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 8));
    for (let k = 0; k < n; k++) rim.push(vec(a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n));
  }
  const r = (i: number) => 6 + tileRand(i, seed, 3) * 3;
  g.fillStyle(0x000000, 0.28);
  rim.forEach((p, i) => g.fillCircle(p.x + 3, p.y + 6, r(i)));
  g.fillPoints(shift(pts, 3, 6), true);
  g.fillStyle(0x10301a, 1);
  rim.forEach((p, i) => g.fillCircle(p.x, p.y, r(i) + 1.5));
  g.fillPoints(pts, true);
  g.fillStyle(0x1f4826, 1);
  rim.forEach((p, i) => g.fillCircle(p.x, p.y, r(i)));
  g.fillPoints(pts, true);
  // The canopy: round clumps, each lit on its top left.
  const clumps = scatter(shrink(pts, 0.92), 10, seed).concat(rim.filter((_, i) => i % 2 === 0));
  clumps.forEach((p, i) => {
    const cr = 5 + tileRand(i, seed, 3) * 4;
    g.fillStyle(0x2a6232, 1).fillCircle(p.x, p.y, cr);
    g.fillStyle(0x3f8a45, 1).fillCircle(p.x - cr * 0.25, p.y - cr * 0.3, cr * 0.6);
    if (tileRand(i, seed, 4) < 0.35) g.fillStyle(0x86c96e, 0.9).fillCircle(p.x - cr * 0.4, p.y - cr * 0.5, 1.4);
  });
}

/** Points every `step` px along the patch's edge. */
function rimOf(pts: V[], step: number): V[] {
  const rim: V[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
    const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 0; k < n; k++) rim.push(vec(a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n));
  }
  return rim;
}

/** A soft-edged area: the polygon a bit inset, rounded off by circles along its edge. */
function rounded(g: Phaser.GameObjects.Graphics, pts: V[], color: number, alpha: number, r: number): void {
  const inner = shrink(pts, 0.94);
  g.fillStyle(color, alpha).fillPoints(inner, true);
  for (const p of rimOf(inner, r)) g.fillCircle(p.x, p.y, r);
}

export function drawWater(g: Phaser.GameObjects.Graphics, pts: V[], seed: number): void {
  rounded(g, pts, 0xbfe3ff, 0.35, 7);
  rounded(g, pts, 0x3a72a8, 1, 6);
  // Deeper towards the middle, in soft overlapping pools.
  for (const p of scatter(shrink(pts, 0.72), 9, seed)) g.fillStyle(0x2d5a8c, 1).fillCircle(p.x, p.y, 8);
  for (const p of scatter(shrink(pts, 0.45), 9, seed + 1)) g.fillStyle(0x234a78, 1).fillCircle(p.x, p.y, 8);
  // Foam where it meets the ground.
  for (const [i, p] of rimOf(shrink(pts, 0.94), 7).entries()) if (tileRand(i, seed, 2) < 0.6) g.fillStyle(0xffffff, 0.5).fillCircle(p.x, p.y, 1.8);
}

export function drawMud(g: Phaser.GameObjects.Graphics, pts: V[], seed: number): void {
  rounded(g, pts, 0x3a2a18, 1, 7);
  rounded(g, shrink(pts, 0.97), 0x6b5233, 1, 6);
  for (const p of scatter(shrink(pts, 0.7), 9, seed)) g.fillStyle(0x4f3a22, 1).fillCircle(p.x, p.y, 8);
  scatter(pts, 13, seed + 2).forEach((p, i) => {
    if (tileRand(i, seed, 5) < 0.5) g.fillStyle(0xa8865a, 0.45).fillEllipse(p.x, p.y, 7, 3);
  });
}
