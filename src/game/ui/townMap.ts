import Phaser from "phaser";
import { WORLDS } from "../../content";
import { t } from "../i18n";
import { Button } from "./Button";
import { panel, screenTitle } from "./frames";
import { pixText } from "./pixelFont";
import { RichText } from "./RichText";
import { tag } from "./markup";
import { drawWorldTile, T } from "./worldTiles";
import type { GameState } from "../../core/party/roster";
import { goalMap, mapInfo, visitedMaps } from "./townMapInfo";

/** Where each map sits on the Town Map, in Kanto grid cells (the handhelds' layout, roughly). */
const LAYOUT: Readonly<Record<string, readonly [number, number]>> = {
  "pallet-town": [4, 15], "route-1": [4, 13], "viridian-city": [4, 11], "route-22": [2.4, 11], "route-23": [1, 8.5],
  "victory-road": [1, 6], "indigo-plateau": [1, 3.5], "route-2": [4, 9], "viridian-forest": [5.2, 8.2], "pewter-city": [4, 6],
  "route-3": [6.5, 6], "mt-moon-1f": [8.6, 5.2], "mt-moon-b2f": [9.6, 4.6], "route-4": [11, 4], "cerulean-city": [13, 4],
  "cerulean-cave": [11.8, 2.8], "route-24": [13, 2.2], "route-25": [15, 1.4], "route-5": [13, 6], "saffron-city": [13, 8.5],
  "silph-co": [14, 9.3], "fighting-dojo": [12, 9.3], "route-6": [13, 11], "vermilion-city": [13, 13], "ss-anne": [12, 14.4],
  "route-11": [15.5, 13], "digletts-cave": [17, 13.8], "route-9": [15.5, 4], "route-10": [18, 5.4], "power-plant": [19.2, 5.4],
  "rock-tunnel": [18, 6.8], "lavender-town": [18, 8.5], "pokemon-tower": [19.2, 9.2], "route-8": [15.7, 8.5], "route-7": [10.6, 8.5],
  "celadon-city": [8.6, 8.5], "rocket-hideout": [8.6, 7.2], "route-12": [18, 11], "route-13": [17, 13.5], "route-14": [16, 15],
  "route-15": [13.2, 15.8], "fuchsia-city": [11, 15.8], "safari-zone": [11, 14.2], "route-16": [6.6, 8.5], "route-17": [6.6, 12.5],
  "route-18": [8.6, 15.8], "route-19": [11, 17.6], "route-20": [8.3, 18.6], "seafoam-islands": [6.2, 18.6], "route-21": [4, 17],
  "cinnabar-island": [4, 18.6], "pokemon-mansion": [2.8, 18.6],
};


type Kind = "city" | "route" | "cave" | "building";
const kindOf = (id: string): Kind =>
  id.startsWith("route-") ? "route"
  : /-(city|town|island|plateau)$/.test(id) ? "city"
  : /cave|tunnel|moon|road|seafoam|forest/.test(id) ? "cave" : "building";

/** Routes over the sea: their lanes stay water. */
const SEA_ROUTES = new Set(["route-19", "route-20", "route-21"]);

/** Kanto's coast in layout cells, clockwise; the islands south of it (centre, radii). */
const MAINLAND: readonly (readonly [number, number])[] = [
  [0.2, 2.2], [1.4, 0.7], [5, 0.9], [9, 1.5], [11, 0.5], [14.5, 0.3], [17.5, 0.4], [19.9, 1.2], [20, 7], [19.9, 12.5],
  [19, 15.6], [16.5, 16.3], [14.5, 16.7], [12, 16.9], [9.5, 16.8], [7.5, 16.5], [5.5, 16.1], [3.2, 16], [1.2, 15.2], [0.2, 13],
];
const ISLANDS: readonly (readonly [number, number, number, number])[] = [[3.5, 18.6, 1.7, 0.8], [6.2, 18.6, 0.8, 0.6]];
/** Mountain ranges and woods, in cells. */
const PEAKS: readonly (readonly [number, number])[] = [
  [7.8, 4.4], [8.8, 3.9], [9.9, 4.1], [10.6, 5.1], [8.2, 5.9], [0.5, 5.2], [1.8, 5.5], [0.6, 6.9], [1.9, 7.2],
  [17.3, 6.2], [18.8, 6.4], [17.6, 7.4], [19.2, 7.5], [11.2, 2.4], [12.4, 2.1], [3, 4.5], [5.4, 4.8],
];
const WOODS: readonly (readonly [number, number])[] = [
  [5.4, 7.4], [6, 8], [5.6, 8.9], [4.9, 7.6], [6.2, 9.2], [10.4, 13.4], [11.8, 13.6], [10.6, 14.6], [11.6, 14.8],
  [15, 2.2], [16.2, 2.6], [2.4, 12.4], [2, 9.6], [7.6, 10.5], [8.2, 11.4], [15.4, 10.5], [16.4, 11.2],
];

/** Tiles per layout cell, and the chart's size in tiles. */
const PER = 2, COLS = 41, ROWS = 40;

const inside = (pts: readonly (readonly [number, number])[], x: number, y: number): boolean => {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!, [xj, yj] = pts[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};
const segDist = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  const k = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
  return Math.hypot(px - ax - k * dx, py - ay - k * dy);
};

/** The roads between maps (from their exits), in cells; `sea` for lanes over water. */
function roads(): { a: readonly [number, number]; b: readonly [number, number]; sea: boolean }[] {
  const out: { a: readonly [number, number]; b: readonly [number, number]; sea: boolean }[] = [];
  const seen = new Set<string>();
  for (const w of Object.values(WORLDS)) {
    if (!LAYOUT[w.id]) continue;
    for (const e of w.exits ?? []) {
      if (!e.to || !LAYOUT[e.to] || !WORLDS[e.to]) continue;
      const key = [w.id, e.to].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ a: LAYOUT[w.id]!, b: LAYOUT[e.to]!, sea: SEA_ROUTES.has(w.id) || SEA_ROUTES.has(e.to) });
    }
  }
  return out;
}

/** What each chart tile is, as an overworld biome id (so it is drawn with the map's own tiles). */
function terrain(): string[][] {
  const ways = roads();
  const places = Object.entries(LAYOUT).filter(([id]) => WORLDS[id]);
  return Array.from({ length: ROWS }, (_, ty) => Array.from({ length: COLS }, (_, tx) => {
    const x = (tx + 0.5) / PER, y = (ty + 0.5) / PER;
    const land = inside(MAINLAND, x, y) || ISLANDS.some(([cx, cy, rx, ry]) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1);
    const near = (d: number) => places.find(([, [px, py]]) => Math.abs(px - x) <= d && Math.abs(py - y) <= d)?.[0];
    const city = near(0.75);
    if (city && kindOf(city) === "city") return "town";
    const spot = near(0.3);
    if (spot && kindOf(spot) === "cave") return "cave";
    if (spot && kindOf(spot) === "building") return "power-plant";
    if (!land) return "water";
    if (ways.some((r) => !r.sea && segDist(x, y, r.a[0], r.a[1], r.b[0], r.b[1]) < 0.3)) return "path";
    if (PEAKS.some(([px, py]) => Math.hypot(px - x, py - y) < 0.6)) return "mountain";
    if (WOODS.some(([px, py]) => Math.hypot(px - x, py - y) < 0.55)) return "forest";
    // The coast is lined with trees, as the maps' edges are.
    if (!inside(MAINLAND, x + 0.5, y) || !inside(MAINLAND, x - 0.5, y) || !inside(MAINLAND, x, y + 0.5) || !inside(MAINLAND, x, y - 0.5)) return land && !ISLANDS.some(([cx, cy]) => Math.abs(cx - x) < 2 && Math.abs(cy - y) < 1.2) ? "trees" : "route";
    return "route";
  }));
}

/** Kanto at a glance, drawn with the overworld's own tiles: every map, the roads between them, where the party is. */
export function openTownMap(scene: Phaser.Scene, game: GameState, hereId: string, onClose: () => void): () => void {
  const { width, height } = scene.scale;
  const box = scene.add.container(0, 0).setDepth(1000).setScrollFactor(0);
  const close = () => { box.destroy(); onClose(); };
  // A full-screen panel (nothing of the map screen peeks out); a fresh press on the side panel's close button or K shuts it.
  box.add(scene.add.rectangle(0, 0, width, height, 0x0b0e14, 1).setOrigin(0).setInteractive());
  const mapH = height - 24, scale = mapH / (ROWS * T), mapW = COLS * T * scale;
  const mx = 12, my = 12;
  box.add(panel(scene, mx - 6, my - 6, mapW + 12, mapH + 12));

  // The chart, drawn at the overworld's tile size and scaled down (one texture, cheap to show).
  const grid = terrain();
  const g = scene.make.graphics({}, false);
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const id = grid[y]![x]!;
    if (id === "path") {
      g.fillStyle(0xb39a68, 1).fillRect(x * T, y * T, T, T);
      g.fillStyle(0x9c8458, 1).fillRect(x * T + 4, y * T + 6, 4, 3).fillRect(x * T + 17, y * T + 18, 5, 3);
    } else drawWorldTile(g, id, x, y, x * T, y * T);
  }
  // Lanes over the sea: a dotted wake.
  g.fillStyle(0xd8ecff, 0.8);
  for (const r of roads().filter((w) => w.sea)) {
    const len = Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]);
    for (let d = 0; d < len; d += 0.35) {
      const k = d / len;
      g.fillCircle((r.a[0] + (r.b[0] - r.a[0]) * k) * PER * T, (r.a[1] + (r.b[1] - r.a[1]) * k) * PER * T, 5);
    }
  }
  g.lineStyle(1, 0x000000, 0.15);
  for (let x = 0; x <= COLS; x++) g.lineBetween(x * T, 0, x * T, ROWS * T);
  for (let y = 0; y <= ROWS; y++) g.lineBetween(0, y * T, COLS * T, y * T);
  const rt = scene.add.renderTexture(mx, my, COLS * T, ROWS * T).setOrigin(0).setScale(scale);
  rt.draw(g).render();
  g.destroy();
  box.add(rt);
  const at = (id: string) => ({ x: mx + LAYOUT[id]![0] * PER * T * scale, y: my + LAYOUT[id]![1] * PER * T * scale });

  // The side panel: title, where you are, what is pointed at, how to close.
  const sx = mx + mapW + 20, sw = width - sx - 12;
  box.add(panel(scene, sx, 6, sw, height - 12));
  box.add(screenTitle(scene, sx + 14, 22, t("Town Map")));
  // The goal and where the party is, then what is known of the map pointed at (or picked with a click).
  const visited = visitedMaps(game, hereId);
  const goal = goalMap(game);
  const head = new RichText(scene, sx + 14, 62, sw - 28, 12);
  const headH = head.setMarkup([
    ...(goal ? [`${tag("special", t("Goal:"))} ${goal.text}`] : []),
    `${tag("bad", t("You are here:"))} ${tag("title", WORLDS[hereId]?.name ?? hereId)}`,
  ].join("\n"));
  const caption = new RichText(scene, sx + 14, 62 + headH + 14, sw - 28, 12);
  let picked = hereId;
  const describe = (id: string) => caption.setMarkup(mapInfo(game, id, visited.has(id)));
  box.add([head, scene.add.rectangle(sx + 14, 62 + headH + 6, sw - 28, 1, 0x3a4560).setOrigin(0), caption]);
  box.add(new Button(scene, sx + 14, height - 50, sw - 28, 30, t("✕ Close [K]"), close).centerLabel());

  for (const id of Object.keys(LAYOUT)) {
    if (!WORLDS[id]) continue;
    const { x, y } = at(id);
    if (kindOf(id) === "city") {
      const label = pixText(scene, x, y + 12, WORLDS[id]!.name.replace(/ (City|Town|Island)$/, ""), 0xffffff, 1).setOrigin(0.5, 0);
      // Kept inside the chart at its edges.
      label.setX(Math.min(mx + mapW - label.width / 2 - 2, Math.max(mx + label.width / 2 + 2, x)));
      box.add(label);
    }
  }
  // The whole chart answers the pointer: the nearest place to it (towns and caves win when close, so a route
  // reads along its whole length). A click keeps the place in the panel.
  const ids = Object.keys(LAYOUT).filter((id) => WORLDS[id]);
  const nearest = (px: number, py: number): string | null => {
    let best: string | null = null, bestD = Infinity;
    for (const id of ids) {
      const q = at(id);
      const d = Math.hypot(q.x - px, q.y - py) * (kindOf(id) === "route" ? 1.25 : 1);
      if (d < bestD) { bestD = d; best = id; }
    }
    return bestD < 70 ? best : null;
  };
  let shown = "";
  const show = (id: string) => { if (id !== shown) { shown = id; describe(id); } };
  box.add(scene.add.zone(mx, my, mapW, mapH).setOrigin(0).setInteractive({ useHandCursor: true })
    .on("pointermove", (ptr: Phaser.Input.Pointer) => show(nearest(ptr.x, ptr.y) ?? picked))
    .on("pointerdown", (ptr: Phaser.Input.Pointer) => { picked = nearest(ptr.x, ptr.y) ?? picked; show(picked); })
    .on("pointerout", () => show(picked)));
  // Where the party is: its leader's marker, a pulsing ring.
  if (LAYOUT[hereId]) {
    const { x, y } = at(hereId);
    const ring = scene.add.circle(x, y, 12).setStrokeStyle(3, 0xff4040);
    box.add([ring, scene.add.circle(x, y, 4, 0xff4040)]);
    scene.tweens.add({ targets: ring, scale: 1.35, alpha: 0.35, duration: 650, yoyo: true, repeat: -1 });
  }
  // The goal's map: a gold "!" over it.
  if (goal?.mapId && LAYOUT[goal.mapId]) {
    const { x, y } = at(goal.mapId);
    const mark = pixText(scene, x + 9, y - 12, "!", 0x10141c, 2).setOrigin(0.5);
    const badge = scene.add.circle(x + 9, y - 12, 8, 0xf5d76e).setStrokeStyle(2, 0x10141c);
    box.add([badge, mark]);
    scene.tweens.add({ targets: [badge, mark], y: y - 16, duration: 500, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
  }
  show(hereId);
  return close;
}
