import Phaser from "phaser";
import { clearFrame, composite, createFrame, createFx, type PixelFxModule } from "pixelfx";
import * as critHit from "pixelfx/fx/impacts/crit-hit";
import * as hitSpark from "pixelfx/fx/impacts/hit-spark";
import * as bluntHit from "pixelfx/fx/impacts/blunt-hit";
import * as zapHit from "pixelfx/fx/lightning/zap-hit";
import * as splash from "pixelfx/fx/water/splash";
import * as snowflakeBurst from "pixelfx/fx/ice/snowflake-burst";
import * as manaBurst from "pixelfx/fx/arcane/mana-burst";
import * as implosion from "pixelfx/fx/explosions/implosion";
import * as plasmaExplosion from "pixelfx/fx/explosions/plasma-explosion";
import * as acidSplash from "pixelfx/fx/nature/acid-splash";
import * as sporeBurst from "pixelfx/fx/nature/spore-burst";
import * as fireTornado from "pixelfx/fx/fire/fire-tornado";
import * as tornado from "pixelfx/fx/nature/tornado";
import * as groundSlam from "pixelfx/fx/impacts/ground-slam";
import * as fireball from "pixelfx/fx/fire/fireball";
import * as flamethrower from "pixelfx/fx/fire/flamethrower";
import * as fireBreath from "pixelfx/fx/fire/fire-breath";
import * as waterJet from "pixelfx/fx/water/water-jet";
import * as waveCrash from "pixelfx/fx/water/wave-crash";
import * as iceSpikes from "pixelfx/fx/ice/ice-spikes";
import * as smite from "pixelfx/fx/holy/smite";
import * as arcaneBeam from "pixelfx/fx/arcane/arcane-beam";
import * as arcaneMissiles from "pixelfx/fx/arcane/arcane-missiles";


/**
 * Pixel-art effects from pixelfx (MIT, github.com/patch-gg/pixelfx), each drawn into its own canvas texture
 * every frame and shown at the board's pixel scale. They run on the scene clock, so battle speed paces them.
 */

type Pt = { readonly x: number; readonly y: number };

const FIRE = ["#1a0606", "#5a1408", "#a8300c", "#e8601a", "#ff9a2a", "#ffd25a", "#fff0b0", "#ffffff"];
const MON = { critHit, hitSpark, bluntHit, zapHit, splash, snowflakeBurst, manaBurst, implosion, plasmaExplosion, acidSplash, sporeBurst, fireTornado, tornado, groundSlam, fireball, flamethrower, fireBreath, waterJet, waveCrash, iceSpikes, smite, arcaneBeam, arcaneMissiles } as const;
export type PixelFxName = keyof typeof MON;

let serial = 0;

/** Sprites draw at about two screen pixels per art pixel; effects follow so their pixels match. */
const PIXEL = 2;

/** Plays one effect with its ground origin at `at`; resolves when it has finished. */
export function pixelFx(scene: Phaser.Scene, name: PixelFxName, at: Pt, options: Record<string, unknown> = {}, scale = 1, depth = 31, loopFor = 0,
  /** Points the effect's right-hand side this way (radians); leftward aims are mirrored, so up stays up. */
  aim?: number,
  onImage?: (image: Phaser.GameObjects.Image) => void,
): Promise<void> {
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
  if (aim !== undefined) {
    const left = Math.cos(aim) < 0;
    image.setScale(scale * PIXEL * (left ? -1 : 1), scale * PIXEL).setRotation(left ? aim + Math.PI : aim);
  }
  onImage?.(image);
  const render = () => {
    clearFrame(frame);
    fx.draw(frame);
    composite(frame, img.data, null);
    ctx.putImageData(img, 0, 0);
    tex.refresh();
  };
  render();
  let elapsed = 0;
  return new Promise((resolve) => {
    const step = (_t: number, delta: number) => {
      const dt = Math.min(0.1, (delta / 1000) * scene.time.timeScale);
      fx.update(dt);
      // Loops (a tornado) run for `loopFor` seconds, then fade out.
      if (mod.meta.loop && (elapsed += dt) >= loopFor) fx.stop();
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
    ice: ["snowflakeBurst", {}, 0.6],
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


/** A whirling column on the spot: fire for Fire Spin and its kind, wind for Twister and Hurricane. */
export function vortexFx(scene: Phaser.Scene, moveId: string, at: Pt): Promise<void> | null {
  const fire = /fire-spin|magma-storm|fire-tornado/.test(moveId);
  if (!fire && !/twister|hurricane|whirlwind|tornado|bleakwind/.test(moveId)) return null;
  return pixelFx(scene, fire ? "fireTornado" : "tornado", { x: at.x, y: at.y + 10 }, {}, fire ? 0.55 : 0.45, 32, 1.4);
}

const PSY = ["#1a0626", "#3c0c50", "#6a1a88", "#a02cb8", "#d050d8", "#f08ce8", "#ffd0f8", "#ffffff"];
const BOLT = ["#1a1404", "#4a3606", "#8a660a", "#d0a010", "#f8d020", "#fff070", "#fffac0", "#ffffff"];
const AURA = ["#06142a", "#0c2c5c", "#1450a0", "#2a80d8", "#58b0f8", "#a0d8ff", "#e0f4ff", "#ffffff"];
const GHOST = ["#08040e", "#1c0c2c", "#38184e", "#582878", "#7c44a0", "#a878c8", "#dcc0f0", "#ffffff"];

/**
 * The move's own set piece when pixelfx has one: streams and beams reach from the user to the target, projectiles
 * fly there, waves and slams land on it. Resolves on contact (the effect plays out after); null when none fits.
 */
export function signatureFx(scene: Phaser.Scene, moveId: string, from: Pt, targets: readonly Pt[]): Promise<void> | null {
  const to = targets[0];
  if (!to) return null;
  const dx = to.x - from.x, dy = to.y - from.y, dist = Math.hypot(dx, dy), aim = Math.atan2(dy, dx);
  const src = { x: from.x, y: from.y - 8 }, hold = (ms: number) => new Promise<void>((r) => scene.time.delayedCall(ms, r));
  // Art pixels at a stream's scale for the gap between the two.
  const reach = (k: number) => Math.max(24, dist / (k * PIXEL));
  if (/^(earthquake|bulldoze|magnitude|stomping-tantrum|high-horsepower)$/.test(moveId)) {
    void pixelFx(scene, "groundSlam", { x: from.x, y: from.y + 6 }, {}, 0.8, 29);
    return hold(350);
  }
  if (/^(flamethrower|blast-burn|inferno|fire-pledge)$/.test(moveId)) {
    void pixelFx(scene, "flamethrower", src, { reach: reach(0.5) }, 0.5, 32, 0.8, aim);
    return hold(500);
  }
  if (/^(heat-wave|dragon-breath|overheat|burn-up)$/.test(moveId)) {
    void pixelFx(scene, "fireBreath", src, {}, Math.min(0.9, dist / (150 * PIXEL)), 32, 0.8, aim);
    return hold(500);
  }
  if (/^(water-gun|hydro-pump|water-pulse|scald|hydro-cannon|brine|octazooka)$/.test(moveId)) {
    void pixelFx(scene, "waterJet", src, { length: reach(0.5) }, 0.5, 32, 0.7, aim);
    return hold(420);
  }
  if (/^(surf|muddy-water|wave-crash|water-spout|liquidation)$/.test(moveId)) {
    for (const t of targets) void pixelFx(scene, "waveCrash", { x: t.x, y: t.y + 8 }, {}, 0.45, 32);
    return hold(450);
  }
  if (/^(ice-beam|ice-shard|frost-breath|icicle-spear|icicle-crash|freeze-dry)$/.test(moveId)) {
    void pixelFx(scene, "iceSpikes", { x: from.x, y: from.y + 6 }, { reach: reach(0.5) }, 0.5, 32, 0, aim);
    return hold(550);
  }
  if (/^(thunder|thunderbolt|zap-cannon|volt-tackle|thunder-punch|discharge)$/.test(moveId)) {
    for (const t of targets) void pixelFx(scene, "smite", { x: t.x, y: t.y + 8 }, { palette: BOLT, stone: false }, 0.5, 33);
    return hold(380);
  }
  if (/^(psychic|psystrike|psybeam|hyper-beam|dragon-pulse|dark-pulse|signal-beam|charge-beam|solar-beam|aurora-beam)$/.test(moveId)) {
    const palette = /hyper|solar|aurora/.test(moveId) ? undefined : /dragon|dark/.test(moveId) ? GHOST : PSY;
    const k = Math.min(0.9, dist / (238 * PIXEL));
    void pixelFx(scene, "arcaneBeam", src, palette ? { palette } : {}, k, 32, 0.7, aim);
    return hold(420);
  }
  if (/^(aura-sphere|swift|shadow-ball|energy-ball|focus-blast|magical-leaf)$/.test(moveId)) {
    const palette = moveId === "aura-sphere" || moveId === "focus-blast" ? AURA : moveId === "shadow-ball" ? GHOST : undefined;
    const k = Math.min(0.9, dist / (214 * PIXEL));
    void pixelFx(scene, "arcaneMissiles", src, palette ? { palette } : {}, k, 32, 0, aim);
    return hold(900);
  }
  if (/^(ember|fire-blast|flame-burst|mystical-fire|flame-charge|pyro-ball)$/.test(moveId)) {
    // The ball itself flies: its sprite tweened from the user to the target.
    const ms = Math.min(520, 160 + dist * 1.2);
    return new Promise((resolve) => {
      const done = pixelFx(scene, "fireball", src, {}, moveId === "ember" ? 0.35 : 0.55, 33, 1.5, aim, (img) => {
        scene.tweens.add({ targets: img, x: to.x, y: to.y - 8, duration: ms, onComplete: () => { img.setVisible(false); resolve(); } });
      });
      void done;
    });
  }
  return null;
}
