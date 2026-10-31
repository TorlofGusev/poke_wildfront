import Phaser from "phaser";
import { clearFrame, composite, createFrame, createFx, type PixelFxModule } from "pixelfx";
import * as critHit from "pixelfx/fx/impacts/crit-hit";
import * as hitSpark from "pixelfx/fx/impacts/hit-spark";
import * as bluntHit from "pixelfx/fx/impacts/blunt-hit";
import * as zapHit from "pixelfx/fx/lightning/zap-hit";
import * as lightningStrike from "pixelfx/fx/lightning/lightning-strike";
import * as splash from "pixelfx/fx/water/splash";
import * as iceShatter from "pixelfx/fx/ice/ice-shatter";
import * as manaBurst from "pixelfx/fx/arcane/mana-burst";
import * as implosion from "pixelfx/fx/explosions/implosion";
import * as plasmaExplosion from "pixelfx/fx/explosions/plasma-explosion";
import * as acidSplash from "pixelfx/fx/nature/acid-splash";
import * as quake from "pixelfx/fx/nature/quake";
import * as sporeBurst from "pixelfx/fx/nature/spore-burst";

/**
 * Pixel-art effects from pixelfx (MIT, github.com/patch-gg/pixelfx), each drawn into its own canvas texture
 * every frame and shown at the board's pixel scale. They run on the scene clock, so battle speed paces them.
 */

type Pt = { readonly x: number; readonly y: number };

const FIRE = ["#1a0606", "#5a1408", "#a8300c", "#e8601a", "#ff9a2a", "#ffd25a", "#fff0b0", "#ffffff"];
const MON = { critHit, hitSpark, bluntHit, zapHit, lightningStrike, splash, iceShatter, manaBurst, implosion, plasmaExplosion, acidSplash, quake, sporeBurst } as const;
export type PixelFxName = keyof typeof MON;

let serial = 0;

/** Sprites draw at about two screen pixels per art pixel; effects follow so their pixels match. */
const PIXEL = 2;

/** Plays one effect with its ground origin at `at`; resolves when it has finished. */
export function pixelFx(scene: Phaser.Scene, name: PixelFxName, at: Pt, options: Record<string, unknown> = {}, scale = 1, depth = 31): Promise<void> {
  const mod = MON[name] as unknown as PixelFxModule;
  const [w, h] = mod.meta.size, [ox, oy] = mod.meta.origin;
  const frame = createFrame(w, h, -ox, -oy);
  const fx = createFx(mod, { x: 0, y: 0, seed: (serial * 7919) % 997, ...options });
  const key = `pixelfx-${serial++}`;
  const tex = scene.textures.createCanvas(key, w, h)!;
  tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
  const ctx = tex.getContext();
  const img = ctx.createImageData(w, h);
  const image = scene.add.image(at.x, at.y, key).setOrigin(ox / w, oy / h).setScale(scale * PIXEL).setDepth(depth);
  const render = () => {
    clearFrame(frame);
    fx.draw(frame);
    composite(frame, img.data, null);
    ctx.putImageData(img, 0, 0);
    tex.refresh();
  };
  render();
  return new Promise((resolve) => {
    const step = (_t: number, delta: number) => {
      fx.update(Math.min(0.1, (delta / 1000) * scene.time.timeScale));
      if (fx.done()) return finish();
      render();
    };
    const finish = () => {
      scene.events.off("update", step);
      scene.events.off("shutdown", finish);
      image.destroy();
      if (scene.textures.exists(key)) scene.textures.remove(key);
      resolve();
    };
    scene.events.on("update", step);
    scene.events.once("shutdown", finish);
  });
}

/** The impact a move of this type lands with (pixelfx's own palettes, fire recoloured from the plasma blast). */
export function typeImpactFx(scene: Phaser.Scene, type: string, at: Pt): void {
  const pick: Partial<Record<string, [PixelFxName, Record<string, unknown>?, number?]>> = {
    fire: ["plasmaExplosion", { palette: FIRE, accent: FIRE.slice(1, 6) }, 0.5],
    electric: ["zapHit"],
    water: ["splash", { stone: false }, 0.7],
    ice: ["iceShatter", {}, 0.6],
    psychic: ["manaBurst", {}, 0.5], fairy: ["manaBurst", { palette: ["#2a0a1c", "#5c1440", "#a02a70", "#e04c9c", "#ff86c4", "#ffbadc", "#ffe4f2", "#ffffff"] }, 0.5],
    dragon: ["manaBurst", { palette: ["#0a0a2a", "#1c1460", "#3a24a8", "#5a40e0", "#8a70ff", "#b8a8ff", "#e4dcff", "#ffffff"] }, 0.55],
    ghost: ["implosion", {}, 0.55], dark: ["implosion", { palette: ["#050308", "#140c1c", "#2a1838", "#46285c", "#6a4488", "#a080c0", "#e0d0f0"] }, 0.55],
    poison: ["acidSplash", { palette: ["#140a1a", "#2c1040", "#4c1a70", "#7428a8", "#9c44d8", "#c47cf0", "#e8b8ff", "#fff0ff"] }, 0.6],
    grass: ["sporeBurst", {}, 0.5], bug: ["acidSplash", {}, 0.55],
    rock: ["bluntHit"], ground: ["bluntHit"], steel: ["hitSpark", { palette: ["#14181f", "#3a4452", "#6a7888", "#a4b2c0", "#d4dee8", "#f0f6fa", "#ffffff"] }],
    fighting: ["hitSpark"], normal: ["hitSpark"], flying: ["hitSpark", { palette: ["#0c1a2a", "#1c3a5c", "#3a6a98", "#6aa0d0", "#a8d4f4", "#e0f4ff", "#ffffff"] }],
  };
  const p = pick[type];
  if (p) void pixelFx(scene, p[0], at, p[1], p[2] ?? 0.75);
}

/** A critical hit's starburst, its blow aimed from the attacker. */
export const critFx = (scene: Phaser.Scene, from: Pt, at: Pt): Promise<void> =>
  pixelFx(scene, "critHit", { x: at.x, y: at.y + 10 }, { aim: Math.atan2(at.y - from.y, at.x - from.x) * 0.3, flip: at.x < from.x }, 0.9, 34);

/** Thunder from the sky, a quake's ground swell: the big moves' own set pieces. */
export const strikeFx = (scene: Phaser.Scene, at: Pt): Promise<void> => pixelFx(scene, "lightningStrike", { x: at.x, y: at.y + 8 }, {}, 0.6);
export const quakeFx = (scene: Phaser.Scene, at: Pt): Promise<void> => pixelFx(scene, "quake", { x: at.x, y: at.y + 8 }, {}, 0.9, 29);
