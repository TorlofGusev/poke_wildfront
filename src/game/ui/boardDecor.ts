import type Phaser from "phaser";

/** Visual theme of a battle board, from the biome or map id. Decoration only: no rules change. */
export type BoardTheme = "field" | "cave" | "shore" | "indoor" | "gym";

export function boardTheme(id: string | null): BoardTheme {
  const s = id ?? "";
  if (/office|hideout|mansion|lab|hall|dojo|gym|tower|plant|anne/.test(s)) return "indoor";
  if (/cave|tunnel|moon|seafoam|victory|digletts/.test(s)) return "cave";
  if (/sea|coast|shallows|lake|pond|water/.test(s)) return "shore";
  return "field";
}

/** Floor colours per theme; each hex gets one of them, picked by its hash. */
const FLOOR: Record<BoardTheme, readonly number[]> = {
  // Route greens, bright as on the handhelds.
  field: [0x5c9a40, 0x62a044, 0x58933d, 0x66a648],
  cave: [0x4a4440, 0x45403c, 0x4f4843, 0x433d39],
  shore: [0xc2ad74, 0xc9b47a, 0xbba66e, 0xcdb980],
  indoor: [0x4a4d57, 0x474a54, 0x4d505a, 0x44474f],
  gym: [0x6a6a70, 0x66666c, 0x6e6e74, 0x646468],
};

/** A stable 0..1 value per hex and salt, so a board always looks the same. */
export const tileRand = (x: number, y: number, salt: number): number => {
  let h = Math.imul(x * 374761393 + y * 668265263 + salt * 2147483647, 1274126177) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export function floorColor(theme: BoardTheme, x: number, y: number): number {
  const set = FLOOR[theme];
  return set[Math.floor(tileRand(x, y, 1) * set.length)]!;
}

/**
 * Small props on an open floor tile, drawn around its centre (cx, cy). On the battle board (`battle`) flowers come
 * in clusters instead (drawFlowerClusters), the floor tiles carry no crates, and a cave crystal is returned so it
 * can glow.
 */
export function drawFloorDecor(g: Phaser.GameObjects.Graphics, theme: BoardTheme, x: number, y: number, cx: number, cy: number, battle = false): { x: number; y: number; color: number } | null {
  const r = tileRand(x, y, 2);
  const ox = (tileRand(x, y, 3) - 0.5) * 20, oy = (tileRand(x, y, 4) - 0.5) * 14;
  const px = cx + ox, py = cy + oy;
  if (theme === "gym") return null;
  if (theme === "indoor") {
    // Floor tiles: a faint seam; now and then a crate or a scuff. The battle board has its own panels.
    if (battle) {
      if (r < 0.12) g.fillStyle(0x000000, 0.15).fillEllipse(px, py, 10, 4);
      return null;
    }
    g.lineStyle(1, 0x000000, 0.18).lineBetween(cx - 10, cy, cx + 10, cy);
    if (r < 0.08) g.fillStyle(0x6b5233, 1).fillRect(px - 5, py - 5, 10, 10).lineStyle(1, 0x3a2c1c, 1).strokeRect(px - 5, py - 5, 10, 10);
    else if (r < 0.2) g.fillStyle(0x000000, 0.15).fillEllipse(px, py, 10, 4);
    return null;
  }
  // Caves: loose stones lie about on many more of the tiles (decoration only).
  // Battle caves: half as many (the floor read as a carpet of pebbles).
  if (theme === "cave" && r > 0.45 && r < (battle ? 0.62 : 0.8)) {
    stone(g, px, py, 3 + tileRand(x, y, 8) * 4);
    if (tileRand(x, y, 9) < 0.5) stone(g, px + 9, py + 5, 2 + tileRand(x, y, 10) * 2);
    return null;
  }
  if (r > 0.45) return null;
  if (theme === "field") {
    if (r < 0.2) tuft(g, px, py, 0x3a6528);
    else if (r < 0.3) battle ? tuft(g, px, py, 0x4a7e34) : flowers(g, px, py, tileRand(x, y, 5) < 0.5 ? 0xf2e36b : 0xe98bd0);
    else if (r < 0.38) pebbles(g, px, py, 0x7d7a70);
    else tuft(g, px, py, 0x6ea24a);
  } else if (theme === "cave") {
    if (r < 0.18) pebbles(g, px, py, 0x6e6660);
    else if (r < 0.3) g.lineStyle(1, 0x2a2624, 0.8).lineBetween(px - 6, py - 2, px, py + 1).lineBetween(px, py + 1, px + 5, py - 3);
    else if (r < 0.37) {
      const color = tileRand(x, y, 5) < 0.5 ? 0x8fd3ff : 0xc59bff;
      crystal(g, px, py, color);
      return { x: px, y: py - 2, color };
    } else g.fillStyle(0x2e2a28, 0.5).fillEllipse(px, py, 10, 4);
  } else {
    if (r < 0.2) pebbles(g, px, py, 0x9c9378);
    else if (r < 0.3) g.fillStyle(0xf0e2c8, 1).fillTriangle(px - 3, py + 2, px + 3, py + 2, px, py - 3);
    else if (r < 0.4) tuft(g, px, py, 0x7b8a4a);
    else g.lineStyle(1, 0x857c5c, 0.8).lineBetween(px - 6, py, px + 6, py);
  }
  return null;
}

/** Ripples on a water hex. */
export function drawWaterDecor(g: Phaser.GameObjects.Graphics, x: number, y: number, cx: number, cy: number): void {
  const oy = (tileRand(x, y, 7) - 0.5) * 8;
  g.lineStyle(1, 0x6fa3d6, 0.7);
  g.lineBetween(cx - 10, cy - 4 + oy, cx - 3, cy - 6 + oy).lineBetween(cx - 3, cy - 6 + oy, cx + 4, cy - 4 + oy);
  g.lineBetween(cx - 2, cy + 6 + oy, cx + 5, cy + 4 + oy).lineBetween(cx + 5, cy + 4 + oy, cx + 11, cy + 6 + oy);
}

function tuft(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number): void {
  g.lineStyle(1.5, color, 1).lineBetween(x, y, x - 3, y - 6).lineBetween(x, y, x, y - 7).lineBetween(x, y, x + 3, y - 6);
}

function flowers(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number): void {
  for (const [dx, dy] of [[0, 0], [5, 3], [-4, 4]] as const) {
    g.fillStyle(color, 1).fillCircle(x + dx, y + dy, 1.8);
    g.fillStyle(0xffffff, 0.8).fillCircle(x + dx, y + dy, 0.7);
  }
}

/** A loose stone: a shadow, a body and a lit top. */
function stone(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number): void {
  g.fillStyle(0x000000, 0.35).fillEllipse(x + 1.5, y + 2, r * 2.2, r * 1.5);
  g.fillStyle(0x5e554c, 1).fillEllipse(x, y, r * 2.2, r * 1.6);
  g.fillStyle(0x8a7e70, 1).fillEllipse(x - r * 0.25, y - r * 0.3, r * 1.2, r * 0.8);
}

function pebbles(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number): void {
  g.fillStyle(color, 1).fillEllipse(x, y, 6, 4).fillEllipse(x + 6, y + 3, 4, 3).fillEllipse(x - 5, y + 3, 3, 2);
}

function crystal(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number): void {
  g.fillStyle(color, 0.9).fillTriangle(x - 3, y + 3, x, y - 7, x + 3, y + 3).fillTriangle(x + 2, y + 3, x + 5, y - 3, x + 7, y + 3);
}

/** A board rectangle in screen pixels. */
export interface BoardRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Route grass as on the Gen 3 handhelds: short blades in a regular stipple, every other row offset. */
export function drawGrassStipple(g: Phaser.GameObjects.Graphics, b: BoardRect, open: (x: number, y: number) => boolean): void {
  for (let y = b.y + 4, row = 0; y < b.y + b.h - 2; y += 8, row++)
    for (let x = b.x + 3 + (row % 2) * 4; x < b.x + b.w - 3; x += 8) {
      if (!open(x, y)) continue;
      const k = tileRand(x, y, 61);
      g.fillStyle(k < 0.5 ? 0x4a8a34 : 0x528f38, 0.8).fillRect(x, y, 1, 2).fillRect(x + 2, y - 1, 1, 3);
      if (k > 0.85) g.fillStyle(0x86c45c, 0.7).fillRect(x + 1, y - 2, 1, 1);
    }
}

/**
 * A worn dirt path from one side's start to the other's, wobbling a little: soft-edged dirt with a lighter
 * trodden middle. Drawn under the patches, so rocks and grass sit on top of it.
 */
export function drawPath(g: Phaser.GameObjects.Graphics, from: { x: number; y: number }, to: { x: number; y: number }, seed: number, theme: BoardTheme): void {
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  if (len < 60) return;
  const nx = -(to.y - from.y) / len, ny = (to.x - from.x) / len;
  const bend = (tileRand(seed, 3, 70) - 0.5) * len * 0.35;
  const outer = theme === "shore" ? 0xa89462 : 0xb39258, inner = theme === "shore" ? 0xd8c690 : 0xcaa86c;
  const steps = Math.ceil(len / 5);
  const at = (t: number) => {
    const b = Math.sin(t * Math.PI) * bend;
    return { x: from.x + (to.x - from.x) * t + nx * b, y: from.y + (to.y - from.y) * t + ny * b };
  };
  for (const [color, alpha, width] of [[outer, 0.55, 11], [outer, 1, 8], [inner, 0.9, 4.5]] as const)
    for (let i = 0; i <= steps; i++) {
      const p = at(i / steps);
      const w = width + (tileRand(i, seed, 71) - 0.5) * 3;
      g.fillStyle(color, alpha).fillEllipse(p.x, p.y, w * 1.4, w);
    }
  // A few pebbles kicked to its sides.
  for (let i = 0; i < steps; i += 4) {
    const p = at(i / steps), s = tileRand(i, seed, 72) < 0.5 ? -1 : 1;
    if (tileRand(i, seed, 73) < 0.5) g.fillStyle(0x8a7a5a, 1).fillEllipse(p.x + nx * 8 * s, p.y + ny * 8 * s, 3, 2);
  }
}

/** Flowers in a handful of clusters instead of an even sprinkle. */
export function drawFlowerClusters(g: Phaser.GameObjects.Graphics, b: BoardRect, open: (x: number, y: number) => boolean, seed: number): void {
  const n = 4 + Math.floor(tileRand(seed, 1, 80) * 3);
  for (let c = 0; c < n; c++) {
    const cx = b.x + 20 + tileRand(seed, c, 81) * (b.w - 40), cy = b.y + 20 + tileRand(seed, c, 82) * (b.h - 40);
    const color = [0xf2e36b, 0xe98bd0, 0xffffff, 0xf08a6a][Math.floor(tileRand(seed, c, 83) * 4)]!;
    const count = 5 + Math.floor(tileRand(seed, c, 84) * 6);
    for (let i = 0; i < count; i++) {
      const a = tileRand(c, i, 85) * Math.PI * 2, r = tileRand(c, i, 86) * 16;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.7;
      if (!open(x, y)) continue;
      g.fillStyle(0x2e5a22, 1).fillRect(x - 0.5, y, 1, 3);
      g.fillStyle(color, 1).fillRect(x - 1.5, y - 1.5, 3, 3);
      g.fillStyle(0xfff6c0, 1).fillRect(x - 0.5, y - 0.5, 1, 1);
    }
  }
}

/** Indoor floor: bevelled panels on both axes, and in Rocket rooms now and then a red R on the floor. */
export function drawIndoorFloor(g: Phaser.GameObjects.Graphics, b: BoardRect, cell: number, rocket: boolean): void {
  for (let y = b.y, j = 0; y < b.y + b.h; y += cell, j++)
    for (let x = b.x, i = 0; x < b.x + b.w; x += cell, i++) {
      const w = Math.min(cell, b.x + b.w - x), h = Math.min(cell, b.y + b.h - y);
      g.fillStyle((i + j) % 2 ? 0x50535e : 0x4a4d58, 1).fillRect(x, y, w, h);
      g.fillStyle(0xffffff, 0.08).fillRect(x + 1, y + 1, w - 2, 2).fillRect(x + 1, y + 1, 2, h - 2);
      g.fillStyle(0x000000, 0.25).fillRect(x, y + h - 1, w, 1).fillRect(x + w - 1, y, 1, h);
      // Rivets in the corners.
      g.fillStyle(0x6a6e7a, 1).fillRect(x + 4, y + 4, 2, 2).fillRect(x + w - 6, y + 4, 2, 2).fillRect(x + 4, y + h - 6, 2, 2).fillRect(x + w - 6, y + h - 6, 2, 2);
      if (rocket && tileRand(i, j, 90) < 0.03) rocketR(g, x + w / 2, y + h / 2);
    }
}

function rocketR(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
  g.fillStyle(0xb02028, 0.55).fillCircle(x, y, 12);
  g.fillStyle(0xffffff, 0.55);
  g.fillRect(x - 5, y - 7, 3, 14).fillRect(x - 5, y - 7, 8, 3).fillRect(x + 2, y - 6, 3, 5).fillRect(x - 5, y - 1, 8, 3);
  g.fillTriangle(x, y + 2, x + 3, y + 2, x + 6, y + 7).fillTriangle(x, y + 2, x + 6, y + 7, x + 3, y + 7);
}

/**
 * A Gym's battle court: stone slabs in a shade of the leader's type, a white boundary, a centre line and a centre
 * circle with a Poké Ball emblem, statues on pedestals in the corners.
 */
export function drawGymCourt(g: Phaser.GameObjects.Graphics, b: BoardRect, cell: number, typeColor: number, vertical: boolean): void {
  const mix = (c: number, to: number, k: number) => {
    const ch = (s: number) => Math.round(((c >> s) & 255) * (1 - k) + ((to >> s) & 255) * k);
    return (ch(16) << 16) | (ch(8) << 8) | ch(0);
  };
  const a = mix(typeColor, 0x7a7a80, 0.62), c2 = mix(typeColor, 0x6a6a70, 0.66);
  for (let y = b.y, j = 0; y < b.y + b.h; y += cell, j++)
    for (let x = b.x, i = 0; x < b.x + b.w; x += cell, i++) {
      const w = Math.min(cell, b.x + b.w - x), h = Math.min(cell, b.y + b.h - y);
      g.fillStyle((i + j) % 2 ? a : c2, 1).fillRect(x, y, w, h);
      g.fillStyle(0xffffff, 0.07).fillRect(x + 1, y + 1, w - 2, 2);
      g.fillStyle(0x000000, 0.2).fillRect(x, y + h - 1, w, 1).fillRect(x + w - 1, y, 1, h);
    }
  const m = 26;
  const line = 0xf4f4f4;
  g.lineStyle(3, line, 0.85).strokeRect(b.x + m, b.y + m, b.w - 2 * m, b.h - 2 * m);
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  if (vertical) g.lineBetween(b.x + m, cy, b.x + b.w - m, cy);
  else g.lineBetween(cx, b.y + m, cx, b.y + b.h - m);
  g.strokeCircle(cx, cy, 46);
  // The Poké Ball in the centre circle.
  g.fillStyle(0xd84040, 0.55).slice(cx, cy, 26, Math.PI, 0, false).fillPath();
  g.fillStyle(0xf4f4f4, 0.5).slice(cx, cy, 26, 0, Math.PI, false).fillPath();
  g.lineStyle(3, 0x20242c, 0.6).lineBetween(cx - 26, cy, cx + 26, cy).strokeCircle(cx, cy, 26);
  g.fillStyle(0xf4f4f4, 0.8).fillCircle(cx, cy, 6);
  g.lineStyle(2, 0x20242c, 0.7).strokeCircle(cx, cy, 6);
  // Corner statues: a pedestal and a Poké Ball-topped pillar.
  for (const [sx, sy] of [[b.x + 13, b.y + 24], [b.x + b.w - 13, b.y + 24], [b.x + 13, b.y + b.h - 8], [b.x + b.w - 13, b.y + b.h - 8]] as const) {
    g.fillStyle(0x000000, 0.3).fillEllipse(sx + 2, sy + 6, 18, 8);
    g.fillStyle(0x5a5e68, 1).fillRect(sx - 8, sy - 2, 16, 8);
    g.fillStyle(0x8a8e98, 1).fillRect(sx - 6, sy - 14, 12, 13);
    g.fillStyle(0xb0b4be, 1).fillRect(sx - 6, sy - 14, 4, 13);
    g.fillStyle(0xd84040, 1).slice(sx, sy - 17, 5, Math.PI, 0, false).fillPath();
    g.fillStyle(0xf4f4f4, 1).slice(sx, sy - 17, 5, 0, Math.PI, false).fillPath();
    g.lineStyle(1, 0x20242c, 1).strokeCircle(sx, sy - 17, 5);
  }
}
