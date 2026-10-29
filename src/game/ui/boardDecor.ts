import type Phaser from "phaser";

/** Visual theme of a battle board, from the biome or map id. Decoration only: no rules change. */
export type BoardTheme = "field" | "cave" | "shore" | "indoor";

export function boardTheme(id: string | null): BoardTheme {
  const s = id ?? "";
  if (/office|hideout|mansion|lab|hall|dojo|gym|tower|plant|anne/.test(s)) return "indoor";
  if (/cave|tunnel|moon|seafoam|victory|digletts/.test(s)) return "cave";
  if (/sea|coast|shallows|lake|pond|water/.test(s)) return "shore";
  return "field";
}

/** Floor colours per theme; each hex gets one of them, picked by its hash. */
const FLOOR: Record<BoardTheme, readonly number[]> = {
  field: [0x4e7a36, 0x52803a, 0x4a7433, 0x55853d],
  cave: [0x4a4440, 0x45403c, 0x4f4843, 0x433d39],
  shore: [0xc2ad74, 0xc9b47a, 0xbba66e, 0xcdb980],
  indoor: [0x4a4d57, 0x474a54, 0x4d505a, 0x44474f],
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

/** Small props on an open floor hex, drawn around its centre (cx, cy). */
export function drawFloorDecor(g: Phaser.GameObjects.Graphics, theme: BoardTheme, x: number, y: number, cx: number, cy: number): void {
  const r = tileRand(x, y, 2);
  const ox = (tileRand(x, y, 3) - 0.5) * 20, oy = (tileRand(x, y, 4) - 0.5) * 14;
  const px = cx + ox, py = cy + oy;
  if (theme === "indoor") {
    // Floor tiles: a faint seam; now and then a crate or a scuff.
    g.lineStyle(1, 0x000000, 0.18).lineBetween(cx - 10, cy, cx + 10, cy);
    if (r < 0.08) g.fillStyle(0x6b5233, 1).fillRect(px - 5, py - 5, 10, 10).lineStyle(1, 0x3a2c1c, 1).strokeRect(px - 5, py - 5, 10, 10);
    else if (r < 0.2) g.fillStyle(0x000000, 0.15).fillEllipse(px, py, 10, 4);
    return;
  }
  // Caves: loose stones lie about on many more of the tiles (decoration only).
  if (theme === "cave" && r > 0.45 && r < 0.8) {
    stone(g, px, py, 3 + tileRand(x, y, 8) * 4);
    if (tileRand(x, y, 9) < 0.5) stone(g, px + 9, py + 5, 2 + tileRand(x, y, 10) * 2);
    return;
  }
  if (r > 0.45) return;
  if (theme === "field") {
    if (r < 0.2) tuft(g, px, py, 0x3a6528);
    else if (r < 0.3) flowers(g, px, py, tileRand(x, y, 5) < 0.5 ? 0xf2e36b : 0xe98bd0);
    else if (r < 0.38) pebbles(g, px, py, 0x7d7a70);
    else tuft(g, px, py, 0x6ea24a);
  } else if (theme === "cave") {
    if (r < 0.18) pebbles(g, px, py, 0x6e6660);
    else if (r < 0.3) g.lineStyle(1, 0x2a2624, 0.8).lineBetween(px - 6, py - 2, px, py + 1).lineBetween(px, py + 1, px + 5, py - 3);
    else if (r < 0.37) crystal(g, px, py, tileRand(x, y, 5) < 0.5 ? 0x8fd3ff : 0xc59bff);
    else g.fillStyle(0x2e2a28, 0.5).fillEllipse(px, py, 10, 4);
  } else {
    if (r < 0.2) pebbles(g, px, py, 0x9c9378);
    else if (r < 0.3) g.fillStyle(0xf0e2c8, 1).fillTriangle(px - 3, py + 2, px + 3, py + 2, px, py - 3);
    else if (r < 0.4) tuft(g, px, py, 0x7b8a4a);
    else g.lineStyle(1, 0x857c5c, 0.8).lineBetween(px - 6, py, px + 6, py);
  }
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
