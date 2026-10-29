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

/**
 * Cover as the games' tall grass: a soft-edged darker patch packed with rows of pointed blades, each row
 * a little lower in front, dark at the root and light at the tips.
 */
/** Cover colours per theme: tall grass on routes, moss in caves, dune grass on the shore. */
const GRASS: Record<BoardTheme, { edge: number; base: number; dark: number; mid: number; tip: number }> = {
  field: { edge: 0x1c4a1e, base: 0x2c6a2a, dark: 0x1a4a1c, mid: 0x3f8a36, tip: 0x78c050 },
  cave: { edge: 0x1e2a24, base: 0x2e4034, dark: 0x1f2e26, mid: 0x46604a, tip: 0x7a9a78 },
  shore: { edge: 0x5a5a26, base: 0x7d7a36, dark: 0x5c5a28, mid: 0x9a9a44, tip: 0xd2d07a },
  indoor: { edge: 0x1c4a1e, base: 0x2c6a2a, dark: 0x1a4a1c, mid: 0x3f8a36, tip: 0x78c050 },
};

export function drawBush(g: Phaser.GameObjects.Graphics, pts: V[], seed: number, theme: BoardTheme = "field"): void {
  const c = GRASS[theme];
  const rim = rimOf(pts, 7);
  g.fillStyle(0x000000, 0.18);
  rim.forEach((p) => g.fillCircle(p.x + 2, p.y + 4, 6));
  g.fillPoints(shift(pts, 2, 4), true);
  g.fillStyle(c.edge, 1);
  rim.forEach((p) => g.fillCircle(p.x, p.y, 7));
  g.fillPoints(pts, true);
  g.fillStyle(c.base, 1);
  rim.forEach((p) => g.fillCircle(p.x, p.y, 5.5));
  g.fillPoints(shrink(pts, 0.97), true);
  // Blade tufts on a staggered grid, back rows first.
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs) - 6, x1 = Math.max(...xs) + 6, y0 = Math.min(...ys) - 4, y1 = Math.max(...ys) + 6;
  let row = 0;
  for (let y = y0; y <= y1; y += 8, row++) {
    for (let x = x0 + (row % 2) * 6; x <= x1; x += 12) {
      const jx = x + (tileRand(Math.round(x), Math.round(y), seed) - 0.5) * 3;
      if (!inside(pts, jx, y - 2) && !inside(pts, jx, y + 3)) continue;
      const h = 10 + tileRand(Math.round(x), Math.round(y), seed + 1) * 3;
      // Three blades: a dark body, a lit left edge, a bright tip.
      for (const [dx, lean] of [[-4, -2.5], [0, 0], [4, 2.5]] as const) {
        const bx = jx + dx, by = y + 3;
        g.fillStyle(c.dark, 1).fillTriangle(bx - 2.5, by, bx + 2.5, by, bx + lean, by - h);
        g.fillStyle(c.mid, 1).fillTriangle(bx - 1.5, by - 1, bx + 0.5, by - 1, bx + lean, by - h + 2);
        g.fillStyle(c.tip, 1).fillTriangle(bx + lean - 1, by - h + 4, bx + lean + 0.5, by - h + 4, bx + lean, by - h);
      }
    }
  }
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
