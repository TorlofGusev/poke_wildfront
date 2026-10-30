import Phaser from "phaser";
import { boardTheme, drawFloorDecor, drawWaterDecor, tileRand } from "./boardDecor";

/** The overworld's tile size; the Town Map draws at it too and scales the result down. */
export const T = 28;

const BIOME_COLORS: Record<string, number> = {
  route: 0x55704a, forest: 0x2f6b34, mountain: 0x7a6a55, cave: 0x4a4038, town: 0x6f8fae, water: 0x2d5a8c, trees: 0x1d3a20,
};
/** Regional biomes are coloured by what their id names: shores and seas, caves, buildings, grass… */
const BIOME_HINTS: [RegExp, number][] = [
  [/sea|coast|pond|lake|water|spring/, 0x3f78a8],
  [/cave|tunnel|digletts|victory|seafoam/, 0x4a4038],
  [/tower|mansion|lab|plant|dojo/, 0x5a5068],
  [/crater|route23|mountain/, 0x7a6a55],
  [/forest|safari|park|route24|route7|route21/, 0x2f6b34],
];
const biomeColor = (id: string): number => BIOME_COLORS[id] ?? BIOME_HINTS.find(([re]) => re.test(id))?.[1] ?? BIOME_COLORS.route!;

/** Each tile a touch lighter or darker than its biome colour, so open ground doesn't read as one flat block. */
function shade(color: number, x: number, y: number): number {
  const k = 0.92 + tileRand(x, y, 11) * 0.14;
  const ch = (s: number) => Math.min(255, Math.round(((color >> s) & 0xff) * k));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Props by what the biome is: grass tufts and flowers outside, pebbles and crystals in caves, ripples on water. */
function decorate(g: Phaser.GameObjects.Graphics, id: string, x: number, y: number, cx: number, cy: number): void {
  if (id === "town" || id === "trees" || id === "mountain") return;
  if (id === "water" || /sea|coast|pond|lake|water|spring/.test(id)) drawWaterDecor(g, x, y, cx, cy);
  else drawFloorDecor(g, boardTheme(id === "route" || id === "forest" ? "field" : id), x, y, cx, cy);
}

/** Towns: houses here and there, the rest paved, with flower beds, lamps and trees between them. */
function drawTownTile(g: Phaser.GameObjects.Graphics, x: number, y: number, left: number, top: number): void {
  const r = tileRand(x, y, 12);
  if (r < 0.4) {
    const roof = [0xc0392b, 0x2e6fb0, 0x3f8a45, 0x8e5a2e][Math.floor(tileRand(x, y, 13) * 4)]!;
    g.fillStyle(0xe8e0d0, 1).fillRect(left + 8, top + 13, 12, 9);
    g.fillStyle(0x5a4030, 1).fillRect(left + 12, top + 17, 4, 5);
    g.fillStyle(roof, 1).fillTriangle(left + 6, top + 14, left + 14, top + 6, left + 22, top + 14);
    return;
  }
  // Paving: a slab seam.
  g.lineStyle(1, 0x000000, 0.12).lineBetween(left, top + T / 2, left + T, top + T / 2).lineBetween(left + T / 2, top, left + T / 2, top + T / 2);
  if (r < 0.5) {
    g.fillStyle(0x3f8a45, 1).fillRect(left + 6, top + 16, 16, 6);
    for (const dx of [8, 13, 18]) g.fillStyle(tileRand(x, y, dx) < 0.5 ? 0xf2e36b : 0xe98bd0, 1).fillCircle(left + dx, top + 18, 1.8);
  } else if (r < 0.57) {
    g.fillStyle(0x2a5a2e, 1).fillCircle(left + 14, top + 12, 7);
    g.fillStyle(0x5a4030, 1).fillRect(left + 13, top + 18, 3, 5);
  } else if (r < 0.62) {
    g.fillStyle(0x30343c, 1).fillRect(left + 13, top + 8, 2, 14);
    g.fillStyle(0xf5d76e, 1).fillCircle(left + 14, top + 8, 2.5);
  }
}

/** One overworld tile of biome `id` with its top-left at (left, top): colour, props and landmark. */
export function drawWorldTile(g: Phaser.GameObjects.Graphics, id: string, x: number, y: number, left: number, top: number): void {
  g.fillStyle(shade(biomeColor(id), x, y), 1).fillRect(left, top, T, T);
  decorate(g, id, x, y, left + T / 2, top + T / 2);
  if (id === "mountain") g.fillStyle(0x9a8a72, 1).fillTriangle(left + 6, top + 22, left + 14, top + 7, left + 22, top + 22);
  if (id === "trees") g.fillStyle(0x2a5a2e, 1).fillCircle(left + 14, top + 14, 10);
  if (id === "forest") g.fillStyle(0x3f8a45, 1).fillTriangle(left + 9, top + 20, left + 14, top + 8, left + 19, top + 20);
  if (id === "town") drawTownTile(g, x, y, left, top);
  if (id === "cave") g.fillStyle(0x221c18, 1).fillCircle(left + 14, top + 16, 6);
}
