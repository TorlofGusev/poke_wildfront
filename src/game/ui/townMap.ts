import Phaser from "phaser";
import { WORLDS } from "../../content";
import { t } from "../i18n";
import { messageFrame } from "./battleBookends";
import { pixText } from "./pixelFont";
import { RichText } from "./RichText";
import { tag } from "./markup";

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

/** Routes over the sea: drawn as dashed water lanes instead of roads. */
const SEA_ROUTES = new Set(["route-19", "route-20", "route-21"]);

/** Kanto's coast in layout cells, clockwise; the islands south of it. */
const MAINLAND: readonly (readonly [number, number])[] = [
  [0.2, 2.2], [1.4, 0.7], [5, 0.9], [9, 1.5], [11, 0.5], [14.5, 0.3], [17.5, 0.4], [19.9, 1.2], [20, 7], [19.9, 12.5],
  [19, 15.6], [16.5, 16.3], [14.5, 16.7], [12, 16.9], [9.5, 16.8], [7.5, 16.5], [5.5, 16.1], [3.2, 16], [1.2, 15.2], [0.2, 13],
];
const ISLANDS: readonly (readonly [number, number, number, number])[] = [[3.5, 18.6, 1.7, 0.75], [6.2, 18.6, 0.75, 0.5]];
/** Mountain ranges and woods, as decoration (cells). */
const PEAKS: readonly (readonly [number, number])[] = [
  [7.8, 4.4], [8.8, 3.9], [9.9, 4.1], [10.6, 5.1], [8.2, 5.9], [0.5, 5.2], [1.8, 5.5], [0.6, 6.9], [1.9, 7.2],
  [17.3, 6.2], [18.8, 6.4], [17.6, 7.4], [19.2, 7.5], [11.2, 2.4], [12.4, 2.1], [3, 4.5], [5.4, 4.8],
];
const WOODS: readonly (readonly [number, number])[] = [
  [5.4, 7.4], [6, 8], [5.6, 8.9], [4.9, 7.6], [6.2, 9.2], [10.4, 13.4], [11.8, 13.6], [10.6, 14.6], [11.6, 14.8],
  [15, 2.2], [16.2, 2.6], [2.4, 12.4], [2, 9.6], [7.6, 10.5], [8.2, 11.4], [15.4, 10.5], [16.4, 11.2],
];

const W = 660, H = 486, PAD = 18;

/** Kanto at a glance: every map, the roads between them (from the exits), and where the party stands. */
export function openTownMap(scene: Phaser.Scene, hereId: string, onClose: () => void): () => void {
  const { width, height } = scene.scale;
  const x0 = Math.round((width - W) / 2), y0 = Math.max(4, Math.round((height - H) / 2));
  const box = scene.add.container(0, 0).setDepth(1000).setScrollFactor(0);
  const close = () => { box.destroy(); onClose(); };
  // Closes on a fresh press outside the map (not on the release of the click that opened it).
  const shade = scene.add.rectangle(0, 0, width, height, 0x000000, 0.5).setOrigin(0).setInteractive().on("pointerdown", close);
  const frame = messageFrame(scene, x0, y0, W, H).setOrigin(0).setInteractive();
  box.add([shade, frame]);

  // The chart: sea, then land, inside the frame.
  const cx0 = x0 + PAD, cy0 = y0 + 40, cw = W - PAD * 2, ch = H - 40 - 46;
  const sx = (c: number) => cx0 + (c / 20.2) * cw, sy = (c: number) => cy0 + (c / 19.6) * ch;
  const at = (id: string) => ({ x: sx(LAYOUT[id]![0]), y: sy(LAYOUT[id]![1]) });
  const g = scene.add.graphics();
  box.add(g);
  g.fillStyle(0x2f6fb0, 1).fillRoundedRect(cx0 - 4, cy0 - 4, cw + 8, ch + 8, 6);
  // Wave marks on the sea, laid out on a fixed grid so the chart never shimmers.
  g.lineStyle(1, 0x7fb4e6, 0.5);
  for (let y = cy0 + 8; y < cy0 + ch; y += 18) for (let x = cx0 + ((y / 18) % 2) * 14; x < cx0 + cw - 10; x += 28) g.lineBetween(x, y, x + 6, y - 2).lineBetween(x + 6, y - 2, x + 12, y);
  const land = (fill: number, grow: number) => {
    g.fillStyle(fill, 1);
    const pts = MAINLAND.map(([x, y]) => new Phaser.Math.Vector2(sx(x), sy(y)));
    const c = pts.reduce((a, p) => a.add(p), new Phaser.Math.Vector2()).scale(1 / pts.length);
    g.fillPoints(pts.map((p) => p.clone().subtract(c).scale(1 + grow).add(c)), true);
    for (const [x, y, rx, ry] of ISLANDS) g.fillEllipse(sx(x), sy(y), (rx * 2 * cw) / 20.2 + grow * 60, (ry * 2 * ch) / 19.6 + grow * 60);
  };
  land(0xe8d9a0, 0.012); // a sandy shore under the grass
  land(0x6fae4f, 0);
  // Grass speckle.
  g.fillStyle(0x5f9c42, 1);
  for (let i = 0; i < 140; i++) {
    const x = ((i * 97) % 200) / 10, y = ((i * 61) % 170) / 10;
    g.fillRect(sx(x), sy(y), 3, 2);
  }
  for (const [x, y] of WOODS) {
    const px = sx(x), py = sy(y);
    g.fillStyle(0x2e6b34, 1).fillTriangle(px - 6, py + 5, px + 6, py + 5, px, py - 8);
    g.fillStyle(0x3f8a44, 1).fillTriangle(px - 4, py + 2, px + 4, py + 2, px, py - 6);
  }
  for (const [x, y] of PEAKS) {
    const px = sx(x), py = sy(y);
    g.fillStyle(0x8a7a62, 1).fillTriangle(px - 11, py + 8, px + 11, py + 8, px, py - 10);
    g.fillStyle(0xa8977c, 1).fillTriangle(px - 11, py + 8, px, py + 8, px, py - 10);
    g.fillStyle(0xf2f2f2, 1).fillTriangle(px - 3, py - 6, px + 3, py - 6, px, py - 10);
  }

  // Roads from the exits: sandy paths on land, dashed lanes on the sea.
  const roads: [Phaser.Math.Vector2, Phaser.Math.Vector2, boolean][] = [];
  const seen = new Set<string>();
  for (const w of Object.values(WORLDS)) {
    if (!LAYOUT[w.id]) continue;
    for (const e of w.exits ?? []) {
      if (!e.to || !LAYOUT[e.to] || !WORLDS[e.to]) continue;
      const key = [w.id, e.to].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      const a = at(w.id), b = at(e.to);
      roads.push([new Phaser.Math.Vector2(a.x, a.y), new Phaser.Math.Vector2(b.x, b.y), SEA_ROUTES.has(w.id) || SEA_ROUTES.has(e.to)]);
    }
  }
  for (const [a, b, sea] of roads) if (!sea) g.lineStyle(9, 0x5a4a30, 1).lineBetween(a.x, a.y, b.x, b.y);
  for (const [a, b, sea] of roads) {
    if (!sea) { g.lineStyle(5, 0xe6cf8f, 1).lineBetween(a.x, a.y, b.x, b.y); continue; }
    const len = a.distance(b), dir = b.clone().subtract(a).normalize();
    g.lineStyle(3, 0xd8ecff, 0.9);
    for (let d = 0; d < len; d += 10) {
      const p = a.clone().add(dir.clone().scale(d)), q = a.clone().add(dir.clone().scale(Math.min(len, d + 5)));
      g.lineBetween(p.x, p.y, q.x, q.y);
    }
  }

  // Landmarks: towns as houses, caves as dark mouths, buildings as blocks; routes stay plain road.
  const caption = new RichText(scene, x0 + 20, y0 + H - 36, W - 40, 13);
  const describe = (id: string) => caption.setMarkup(id === hereId ? `${tag("bad", t("You are here:"))} ${tag("title", WORLDS[id]!.name)}` : tag("title", WORLDS[id]!.name));
  for (const id of Object.keys(LAYOUT)) {
    if (!WORLDS[id]) continue;
    const { x, y } = at(id);
    const kind = kindOf(id);
    if (kind === "city") {
      g.fillStyle(0x10141c, 1).fillRect(x - 10, y - 9, 20, 18);
      g.fillStyle(0xf4efe2, 1).fillRect(x - 8, y - 2, 16, 9);
      g.fillStyle(0xd0463c, 1).fillTriangle(x - 10, y - 1, x + 10, y - 1, x, y - 9);
      g.fillStyle(0x3a4a6a, 1).fillRect(x - 2, y + 2, 4, 5);
      const label = WORLDS[id]!.name.replace(/ (City|Town|Island)$/, "");
      box.add(pixText(scene, x, y + 11, label, 0xffffff, 1).setOrigin(0.5, 0));
    } else if (kind === "cave") {
      g.fillStyle(0x10141c, 1).fillCircle(x, y, 7);
      g.fillStyle(0x7a5a3a, 1).fillCircle(x, y, 5.5);
      g.fillStyle(0x10141c, 1).fillEllipse(x, y + 2, 6, 6);
    } else if (kind === "building") {
      g.fillStyle(0x10141c, 1).fillRect(x - 7, y - 7, 14, 14);
      g.fillStyle(0xb8c0d0, 1).fillRect(x - 5, y - 5, 10, 10);
      g.fillStyle(0x4a5a7a, 1).fillRect(x - 3, y - 3, 2, 2).fillRect(x + 1, y - 3, 2, 2).fillRect(x - 3, y + 1, 2, 2).fillRect(x + 1, y + 1, 2, 2);
    }
    box.add(scene.add.zone(x, y, 24, 24).setInteractive({ useHandCursor: true })
      .on("pointerover", () => describe(id)).on("pointerdown", () => describe(id)).on("pointerout", () => describe(hereId)));
  }
  // Where the party is: a pulsing red ring over its spot.
  if (LAYOUT[hereId]) {
    const { x, y } = at(hereId);
    const ring = scene.add.circle(x, y, 13).setStrokeStyle(3, 0xff4040);
    box.add(ring);
    scene.tweens.add({ targets: ring, scale: 1.3, alpha: 0.35, duration: 650, yoyo: true, repeat: -1 });
  }
  box.add([caption, pixText(scene, x0 + 20, y0 + 12, t("Town Map"), 0xf5d76e, 2), pixText(scene, x0 + W - 20, y0 + 16, t("✕ close [K]"), 0xc0c8d8, 1).setOrigin(1, 0)]);
  describe(hereId);
  return close;
}
