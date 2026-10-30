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

type Kind = "city" | "route" | "place";
const kindOf = (id: string): Kind =>
  id.startsWith("route-") ? "route" : /-(city|town|island|plateau)$/.test(id) ? "city" : "place";

const W = 640, H = 470, PAD = 22;
const COL = { line: 0x8fa8d8, route: 0x6e86b8, city: 0xf5d76e, place: 0xc6a3ff, here: 0xff5050 };

/** Kanto at a glance: every map, the roads between them (from the exits), and where the party stands. */
export function openTownMap(scene: Phaser.Scene, hereId: string, onClose: () => void): () => void {
  const { width, height } = scene.scale;
  const x0 = Math.round((width - W) / 2), y0 = Math.round((height - H) / 2);
  const box = scene.add.container(0, 0).setDepth(1000).setScrollFactor(0);
  const close = () => { box.destroy(); onClose(); };
  const shade = scene.add.rectangle(0, 0, width, height, 0x000000, 0.45).setOrigin(0).setInteractive().on("pointerup", close);
  const frame = messageFrame(scene, x0, y0, W, H).setOrigin(0).setInteractive();
  box.add([shade, frame, pixText(scene, x0 + 20, y0 + 14, t("Town Map"), 0xf5d76e, 2)]);

  // Cells to pixels: the layout spans about 20 × 19 cells.
  const top = y0 + 40, inner = { w: W - PAD * 2, h: H - 40 - 50 };
  const at = (id: string) => {
    const [cx, cy] = LAYOUT[id]!;
    return { x: x0 + PAD + (cx / 20) * inner.w, y: top + (cy / 19.2) * inner.h };
  };
  const g = scene.add.graphics();
  box.add(g);
  const drawn = new Set<string>();
  for (const w of Object.values(WORLDS)) {
    if (!LAYOUT[w.id]) continue;
    for (const e of w.exits ?? []) {
      if (!e.to || !LAYOUT[e.to] || !WORLDS[e.to]) continue;
      const key = [w.id, e.to].sort().join("|");
      if (drawn.has(key)) continue;
      drawn.add(key);
      const a = at(w.id), b = at(e.to);
      g.lineStyle(3, COL.line, 0.55).lineBetween(a.x, a.y, b.x, b.y);
    }
  }

  const caption = new RichText(scene, x0 + 20, y0 + H - 38, W - 40, 13);
  const describe = (id: string) => caption.setMarkup(id === hereId ? `${tag("bad", t("You are here:"))} ${tag("title", WORLDS[id]!.name)}` : tag("title", WORLDS[id]!.name));
  for (const id of Object.keys(LAYOUT)) {
    if (!WORLDS[id]) continue;
    const p = at(id), kind = kindOf(id);
    const color = kind === "city" ? COL.city : kind === "place" ? COL.place : COL.route;
    if (kind === "city") g.fillStyle(0x10141c, 1).fillRect(p.x - 8, p.y - 8, 16, 16).fillStyle(color, 1).fillRect(p.x - 6, p.y - 6, 12, 12);
    else if (kind === "place") g.fillStyle(0x10141c, 1).fillCircle(p.x, p.y, 6).fillStyle(color, 1).fillCircle(p.x, p.y, 4);
    else g.fillStyle(color, 1).fillCircle(p.x, p.y, 3.5);
    if (kind === "city") {
      // Town names stand beside their square; the rest show in the caption on hover or tap.
      const label = WORLDS[id]!.name.replace(/ (City|Town|Island)$/, "");
      box.add(pixText(scene, p.x, p.y + 10, label, 0xffffff, 1).setOrigin(0.5, 0));
    }
    const hit = scene.add.zone(p.x, p.y, 22, 22).setInteractive({ useHandCursor: true })
      .on("pointerover", () => describe(id)).on("pointerdown", () => describe(id)).on("pointerout", () => describe(hereId));
    box.add(hit);
  }
  // Where the party is: a pulsing red ring.
  const here = LAYOUT[hereId] ? at(hereId) : null;
  if (here) {
    const ring = scene.add.circle(here.x, here.y, 11).setStrokeStyle(3, COL.here);
    box.add(ring);
    scene.tweens.add({ targets: ring, scale: 1.35, alpha: 0.4, duration: 650, yoyo: true, repeat: -1 });
  }
  box.add(caption);
  describe(hereId);
  box.add(pixText(scene, x0 + W - 20, y0 + 14, t("✕ close [K]"), 0xc0c8d8, 1).setOrigin(1, 0));
  frame.on("pointerup", (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => ev.stopPropagation());
  return close;
}
