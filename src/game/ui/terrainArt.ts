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
  gym: { side: 0x3a3634, top: 0x6a645e, light: 0x9a948a },
};

/** Boulders (machines indoors): a shadow, a side, a lit top with a second highlight band, varied creases, a 1 px outline. */
export function drawRock(g: Phaser.GameObjects.Graphics, pts: V[], theme: BoardTheme, seed = 0): void {
  if (theme === "indoor") return drawMachine(g, pts, seed);
  const c = ROCK[theme];
  g.fillStyle(0x000000, 0.35).fillPoints(shift(pts, 4, 7), true);
  g.fillStyle(c.side, 1).fillPoints(pts, true);
  const top = shrink(pts, 0.8, -1, -5);
  g.fillStyle(c.top, 1).fillPoints(top, true);
  // A second, lighter band towards the top left: two tones, as hand-shaded pixel rocks have.
  g.fillStyle(c.light, 0.28).fillPoints(shrink(top, 0.62, -3, -3), true);
  // Light from the top left: edges facing up or left catch it.
  for (let i = 0; i < top.length; i++) {
    const a = top[i]!, b = top[(i + 1) % top.length]!;
    const nx = b.y - a.y, ny = -(b.x - a.x);
    if (ny + nx * 0.5 < 0) g.lineStyle(2, c.light, 0.9).lineBetween(a.x, a.y, b.x, b.y);
  }
  // Creases: 2–4, from points on the top's rim inwards at their own angles (no two rocks alike).
  const mid = centroid(top);
  const n = 2 + Math.floor(tileRand(seed, 1, 50) * 3);
  for (let k = 0; k < n; k++) {
    const i = Math.floor(tileRand(seed, k, 51) * top.length);
    const a = top[i]!, b = top[(i + 1) % top.length]!;
    const t = 0.25 + tileRand(seed, k, 52) * 0.5;
    const sx = a.x + (b.x - a.x) * t, sy = a.y + (b.y - a.y) * t;
    const reach = 0.35 + tileRand(seed, k, 53) * 0.35;
    const bend = (tileRand(seed, k, 54) - 0.5) * 10;
    const mx = sx + (mid.x - sx) * reach * 0.5 + bend, my = sy + (mid.y - sy) * reach * 0.5 - bend * 0.5;
    const ex = sx + (mid.x - sx) * reach, ey = sy + (mid.y - sy) * reach;
    g.lineStyle(1.2, 0x000000, 0.32).lineBetween(sx, sy, mx, my).lineBetween(mx, my, ex, ey);
    g.lineStyle(1, c.light, 0.35).lineBetween(sx + 1, sy, mx + 1, my);
  }
  // Moss on route rocks, cracks in caves, salt on the shore.
  const xs = top.map((p) => p.x), ys = top.map((p) => p.y);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0;
  if ((theme === "field" || theme === "gym") && tileRand(seed, 2, 55) < 0.6) {
    for (let k = 0; k < 5; k++) {
      const px = x0 + w * (0.15 + k * 0.08), py = y0 + 3 + tileRand(seed, k, 56) * 4;
      if (inside(top, px, py)) g.fillStyle(k % 2 ? 0x5a8a3a : 0x6ea248, 1).fillEllipse(px, py, 5, 3);
    }
  } else if (theme === "cave" && tileRand(seed, 2, 55) < 0.7) {
    let px = mid.x - 6, py = mid.y - 4;
    g.lineStyle(1, 0x14100e, 0.7);
    for (let k = 0; k < 4; k++) {
      const nx2 = px + 3 + tileRand(seed, k, 57) * 3, ny2 = py + (k % 2 ? -2 : 3);
      g.lineBetween(px, py, nx2, ny2);
      px = nx2;
      py = ny2;
    }
  }
  g.lineStyle(1.5, 0x16161c, 0.9).strokePoints(pts, true, true);
}

/** Indoors a "rock" is a machine or a crate stack: a metal block with a lit top, a hazard stripe, bolts and a lamp. */
function drawMachine(g: Phaser.GameObjects.Graphics, pts: V[], seed: number): void {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs) + 2, x1 = Math.max(...xs) - 2, y0 = Math.min(...ys) + 2, y1 = Math.max(...ys) - 2;
  const w = x1 - x0, h = y1 - y0;
  g.fillStyle(0x000000, 0.35).fillRect(x0 + 4, y0 + 7, w, h);
  g.fillStyle(0x2c3038, 1).fillRect(x0, y0, w, h);
  g.fillStyle(0x5a6270, 1).fillRect(x0, y0, w, h - 8);
  g.fillStyle(0x7a8290, 1).fillRect(x0, y0, w, 3);
  // The hazard stripe along its front.
  for (let x = x0; x < x1 - 4; x += 8) g.fillStyle(0xe8c030, 1).fillTriangle(x, y1 - 2, x + 4, y1 - 8, x + 8, y1 - 8).fillTriangle(x, y1 - 2, x + 8, y1 - 8, x + 4, y1 - 2);
  // Panels, bolts and a lamp (green or red).
  g.lineStyle(1, 0x2c3038, 1);
  for (let x = x0 + 14; x < x1 - 6; x += 16) g.lineBetween(x, y0 + 4, x, y1 - 10);
  g.fillStyle(0x9aa2b0, 1).fillRect(x0 + 2, y0 + 5, 2, 2).fillRect(x1 - 4, y0 + 5, 2, 2);
  g.fillStyle(tileRand(seed, 0, 58) < 0.5 ? 0x60e070 : 0xf05050, 1).fillCircle(x0 + w / 2, y0 + 8, 2.5);
  g.lineStyle(1.5, 0x16161c, 0.9).strokeRect(x0, y0, w, h);
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
  gym: { edge: 0x1c4a1e, base: 0x2c6a2a, dark: 0x1a4a1c, mid: 0x3f8a36, tip: 0x78c050 },
};

export function drawBush(g: Phaser.GameObjects.Graphics, pts: V[], seed: number, theme: BoardTheme = "field"): void {
  // Indoors and in Gyms cover is a bank of potted plants.
  if (theme === "indoor" || theme === "gym") return drawPlanters(g, pts, seed);
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

/** Indoors cover is a bank of potted plants: terracotta pots with round leafy crowns, back rows first. */
function drawPlanters(g: Phaser.GameObjects.Graphics, pts: V[], seed: number): void {
  g.fillStyle(0x000000, 0.2).fillPoints(shift(pts, 2, 4), true);
  g.fillStyle(0x3a3d46, 1).fillPoints(pts, true);
  g.lineStyle(1.5, 0x16161c, 0.8).strokePoints(pts, true, true);
  const spots = scatter(shrink(pts, 0.85), 14, seed).sort((a, b) => a.y - b.y);
  // No two alike: crowns of their own size and green, now and then a flowering one.
  const crowns = [[0x1f5a24, 0x2f7a30, 0x5aaa48], [0x245a30, 0x347a40, 0x68b858], [0x2a5420, 0x40702a, 0x86b850]] as const;
  spots.forEach((p, i) => {
    const k = tileRand(i, seed, 60), r = 5 + k * 4;
    const [dark, mid, light] = crowns[Math.floor(tileRand(i, seed, 61) * 3)]!;
    g.fillStyle(0x000000, 0.3).fillEllipse(p.x + 1, p.y + 6, 12, 4);
    g.fillStyle(0xa0522d, 1).fillRect(p.x - 5, p.y, 10, 7);
    g.fillStyle(0xc0703c, 1).fillRect(p.x - 6, p.y - 1, 12, 3);
    g.fillStyle(dark, 1).fillCircle(p.x, p.y - r + 2, r);
    g.fillStyle(mid, 1).fillCircle(p.x - 2, p.y - r, r * 0.7);
    g.fillStyle(light, 1).fillCircle(p.x - 3, p.y - r - 2, 2);
    if (tileRand(i, seed, 62) < 0.25) g.fillStyle(tileRand(i, seed, 63) < 0.5 ? 0xf06a8a : 0xf5e070, 1).fillCircle(p.x + 2, p.y - r - 1, 2);
  });
}

/** Chaikin's corner cutting: a hard polygon becomes a smooth, natural outline. */
function smooth(pts: V[], rounds = 3): V[] {
  let out = pts;
  for (let r = 0; r < rounds; r++) {
    const next: V[] = [];
    out.forEach((a, i) => {
      const b = out[(i + 1) % out.length]!;
      next.push(vec(a.x * 0.75 + b.x * 0.25, a.y * 0.75 + b.y * 0.25), vec(a.x * 0.25 + b.x * 0.75, a.y * 0.25 + b.y * 0.75));
    });
    out = next;
  }
  return out;
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
  const shore = smooth(pts);
  // A dark line where the bank drops, a pale wet rim, then water deepening in two smooth bands.
  g.fillStyle(0x1a2a3a, 0.55).fillPoints(smooth(shrink(pts, 1.03)), true);
  g.fillStyle(0x8ec8ee, 1).fillPoints(shore, true);
  g.fillStyle(0x3a78b0, 1).fillPoints(smooth(shrink(pts, 0.93)), true);
  g.fillStyle(0x2d6098, 1).fillPoints(smooth(shrink(pts, 0.7, 1, 1)), true);
  g.fillStyle(0x234c80, 1).fillPoints(smooth(shrink(pts, 0.45, 1, 2)), true);
  // Foam: one unbroken pale line inset from the shore.
  g.lineStyle(2, 0xdff4ff, 0.85).strokePoints(smooth(shrink(pts, 0.95)), true, true);
  // Sparse highlight streaks on the surface.
  scatter(shrink(pts, 0.75), 16, seed).forEach((p, i) => {
    if (tileRand(i, seed, 3) < 0.45) g.lineStyle(1.5, 0xcfeaff, 0.55).lineBetween(p.x - 5, p.y, p.x + 4, p.y);
  });
  g.lineStyle(1, 0x16222e, 0.8).strokePoints(smooth(shrink(pts, 1.03)), true, true);
}

export function drawMud(g: Phaser.GameObjects.Graphics, pts: V[], seed: number): void {
  rounded(g, pts, 0x3a2a18, 1, 7);
  rounded(g, shrink(pts, 0.97), 0x6b5233, 1, 6);
  for (const p of scatter(shrink(pts, 0.7), 9, seed)) g.fillStyle(0x4f3a22, 1).fillCircle(p.x, p.y, 8);
  scatter(pts, 13, seed + 2).forEach((p, i) => {
    if (tileRand(i, seed, 5) < 0.5) g.fillStyle(0xa8865a, 0.45).fillEllipse(p.x, p.y, 7, 3);
  });
}
