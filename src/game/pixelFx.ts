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
import * as spiritFlame from "pixelfx/fx/fire/spirit-flame";
import * as boulder from "pixelfx/fx/nature/boulder";
import * as earthSpike from "pixelfx/fx/nature/earth-spike";
import * as frostNova from "pixelfx/fx/ice/frost-nova";
import * as vineWhip from "pixelfx/fx/nature/vine-whip";
import * as thorns from "pixelfx/fx/nature/thorns";
import * as rootSnare from "pixelfx/fx/nature/root-snare";

/**
 * Pixel-art effects from pixelfx (MIT, github.com/patch-gg/pixelfx), each drawn into its own canvas texture
 * every frame and shown at the board's pixel scale. They run on the scene clock, so battle speed paces them.
 *
 * pixelfx draws side-on: x runs right from the effect's origin (a character's feet), y down, and directional
 * effects leave from a point of their own (a hand, a nozzle). Aimed effects put that point on the attacker,
 * turn about it towards the target and are fitted to the gap: streams by their length option, fixed pieces by
 * cropping them at the target (or scaling them up when the target lies past their end).
 */

type Pt = { readonly x: number; readonly y: number };

const MON = {
  critHit, hitSpark, bluntHit, zapHit, splash, snowflakeBurst, manaBurst, implosion, plasmaExplosion, acidSplash, sporeBurst,
  fireTornado, tornado, groundSlam, fireball, flamethrower, fireBreath, waterJet, waveCrash, iceSpikes, smite, arcaneBeam, arcaneMissiles, spiritFlame, boulder, earthSpike, frostNova,
  vineWhip, thorns, rootSnare,
} as const;
export type PixelFxName = keyof typeof MON;

/** Sprites draw at two screen pixels per art pixel; effects at scale 1 match them, at 0.5 they are one to one. */
const PIXEL = 2;
/** Body height above a unit's position, where streams leave and hits land. */
const BODY = 10;

interface PlayOptions {
  /** The effect's own options (palette, reach…). */
  readonly options?: Record<string, unknown>;
  readonly scale?: number;
  readonly depth?: number;
  /** Seconds a looping effect runs before it fades out. */
  readonly loopFor?: number;
  /** Turns the effect's +x towards this angle (radians) about the anchor; leftward aims are mirrored so up stays up. */
  readonly aim?: number;
  /** The art point (from the effect's origin) placed on `at`; the origin when left out. */
  readonly anchor?: readonly [number, number];
  /** Art pixels added to the frame's right, for streams run out past it. */
  readonly extend?: number;
  /** Art pixels from the anchor beyond which the effect is cut off. */
  readonly crop?: number;
  readonly onImage?: (image: Phaser.GameObjects.Image) => void;
}

let serial = 0;

/** Each scene's board: effects are masked to it, so nothing spills over the header or the side panel. */
const bounds = new WeakMap<Phaser.Scene, Phaser.Display.Masks.GeometryMask>();

/** Keeps this scene's effects inside the given rectangle (call once the board is laid out). */
export function setFxBounds(scene: Phaser.Scene, rect: { x: number; y: number; w: number; h: number }): void {
  const g = scene.make.graphics({}, false).fillStyle(0xffffff).fillRect(rect.x, rect.y, rect.w, rect.h);
  bounds.set(scene, g.createGeometryMask());
  scene.events.once("shutdown", () => {
    bounds.delete(scene);
    g.destroy();
  });
}

/**
 * Plays one effect at `at` (its origin, or its anchor); resolves when it has finished. An effect that fails is
 * logged and skipped: decoration must never stall a battle.
 */
export function pixelFx(scene: Phaser.Scene, name: PixelFxName, at: Pt, o: PlayOptions = {}): Promise<void> {
  try {
    return play(scene, name, at, o);
  } catch (err) {
    console.error(`pixelfx ${name} failed`, err);
    return Promise.resolve();
  }
}

function play(scene: Phaser.Scene, name: PixelFxName, at: Pt, o: PlayOptions): Promise<void> {
  const mod = MON[name] as unknown as PixelFxModule;
  const [w0, h] = mod.meta.size, [ox, oy] = mod.meta.origin;
  const [ax, ay] = o.anchor ?? [0, 0];
  const w = w0 + Math.max(0, Math.ceil(o.extend ?? 0));
  const frame = createFrame(w, h, -ox, -oy);
  const fx = createFx(mod, { x: 0, y: 0, seed: (serial * 7919) % 997, ...o.options });
  const key = `pixelfx-${serial++}`;
  const tex = scene.textures.createCanvas(key, w, h)!;
  tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
  const ctx = tex.getContext();
  const img = ctx.createImageData(w, h);
  const k = (o.scale ?? 1) * PIXEL;
  const image = scene.add.image(at.x, at.y, key).setOrigin((ox + ax) / w, (oy + ay) / h).setScale(k).setDepth(o.depth ?? 31);
  const mask = bounds.get(scene);
  if (mask) image.setMask(mask);
  if (o.crop !== undefined) image.setCrop(0, 0, Math.min(w, Math.ceil(ox + ax + o.crop)), h);
  if (o.aim !== undefined) {
    const left = Math.cos(o.aim) < 0;
    image.setScale(left ? -k : k, k).setRotation(left ? o.aim + Math.PI : o.aim);
  }
  const render = () => {
    clearFrame(frame);
    fx.draw(frame);
    composite(frame, img.data, null);
    ctx.putImageData(img, 0, 0);
    tex.refresh();
  };
  try {
    render();
  } catch (err) {
    image.destroy();
    scene.textures.remove(key);
    throw err;
  }
  o.onImage?.(image);
  let elapsed = 0;
  return new Promise((resolve) => {
    const step = (_t: number, delta: number) => {
      try {
        const dt = Math.min(0.1, (delta / 1000) * scene.time.timeScale);
        fx.update(dt);
        if (mod.meta.loop && (elapsed += dt) >= (o.loopFor ?? 0)) fx.stop();
        if (fx.done()) return finish();
        render();
      } catch (err) {
        console.error(`pixelfx ${name} failed`, err);
        finish();
      }
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

const FIRE = ["#1a0606", "#5a1408", "#a8300c", "#e8601a", "#ff9a2a", "#ffd25a", "#fff0b0", "#ffffff"];
const PSY = ["#1a0626", "#3c0c50", "#6a1a88", "#a02cb8", "#d050d8", "#f08ce8", "#ffd0f8", "#ffffff"];
const BOLT = ["#1a1404", "#4a3606", "#8a660a", "#d0a010", "#f8d020", "#fff070", "#fffac0", "#ffffff"];
const AURA = ["#06142a", "#0c2c5c", "#1450a0", "#2a80d8", "#58b0f8", "#a0d8ff", "#e0f4ff", "#ffffff"];
const LEAF_SPARK = ["#0c1a08", "#1e3a10", "#2f6a1c", "#4c9a2a", "#86c84e", "#c4ec7a", "#f4ffd0"];
const SHADOW = ["#08040e", "#1c0c2c", "#38184e", "#582878", "#7c44a0", "#a878c8", "#dcc0f0", "#ffffff"];

/** Beams other than psychic violet. */
const BEAM_PALETTE: Partial<Record<string, readonly string[]>> = {
  "hyper-beam": ["#2a0c04", "#5c1c08", "#a8400c", "#e87a1c", "#ffb04a", "#ffe08a", "#fff6d8", "#ffffff"],
  "solar-beam": ["#0c1a04", "#1e3a08", "#3c6a10", "#6aa21a", "#a8d82c", "#e8f46a", "#fffcc0", "#ffffff"],
  "aurora-beam": ["#06142a", "#0c3050", "#14607c", "#2aa0b8", "#58d8e0", "#a8f4f0", "#e4fffc", "#ffffff"],
  "dragon-pulse": SHADOW, "dark-pulse": SHADOW,
  "signal-beam": ["#0c1a04", "#2a3a08", "#5a6a10", "#8aa018", "#c4d830", "#ecf47a", "#fdffd0", "#ffffff"],
  "charge-beam": BOLT,
};

const IMPACT: Partial<Record<string, readonly [PixelFxName, Record<string, unknown>, number]>> = {
  fire: ["plasmaExplosion", { palette: FIRE, accent: FIRE.slice(1, 6) }, 0.5],
  electric: ["zapHit", {}, 0.75],
  water: ["splash", { stone: false }, 0.7],
  ice: ["snowflakeBurst", {}, 0.6],
  psychic: ["manaBurst", {}, 0.5],
  fairy: ["manaBurst", { palette: ["#2a0a1c", "#5c1440", "#a02a70", "#e04c9c", "#ff86c4", "#ffbadc", "#ffe4f2", "#ffffff"] }, 0.5],
  dragon: ["manaBurst", { palette: ["#0a0a2a", "#1c1460", "#3a24a8", "#5a40e0", "#8a70ff", "#b8a8ff", "#e4dcff", "#ffffff"] }, 0.55],
  ghost: ["implosion", {}, 0.55],
  dark: ["implosion", { palette: ["#050308", "#140c1c", "#2a1838", "#46285c", "#6a4488", "#a080c0", "#e0d0f0"] }, 0.55],
  poison: ["acidSplash", { palette: ["#140a1a", "#2c1040", "#4c1a70", "#7428a8", "#9c44d8", "#c47cf0", "#e8b8ff", "#fff0ff"] }, 0.6],
  // A green crack of light; the hit tears up leaves from the ground as well (arenaFx). The toadstool of
  // sporeBurst is kept for Spore alone: a mushroom on every grass hit looked out of place.
  grass: ["hitSpark", { palette: LEAF_SPARK }, 0.75],
  bug: ["acidSplash", {}, 0.55],
  rock: ["bluntHit", {}, 0.75],
  ground: ["bluntHit", {}, 0.75],
  steel: ["hitSpark", { palette: ["#14181f", "#3a4452", "#6a7888", "#a4b2c0", "#d4dee8", "#f0f6fa", "#ffffff"] }, 0.75],
  fighting: ["hitSpark", {}, 0.75],
  normal: ["hitSpark", {}, 0.75],
  flying: ["hitSpark", { palette: ["#0c1a2a", "#1c3a5c", "#3a6a98", "#6aa0d0", "#a8d4f4", "#e0f4ff", "#ffffff"] }, 0.75],
};

const FLAME = ["#1a0606", "#4a0e06", "#8a1e08", "#c8380c", "#f0601a", "#ff9a2a", "#ffd04a", "#fff0a0", "#ffffff"];

/** One tongue of flame burning on the ground for `seconds` (on the battle clock), then dying down. */
export const groundFlame = (scene: Phaser.Scene, at: Pt, scale: number, seconds: number, depth: number): Promise<void> =>
  pixelFx(scene, "spiritFlame", at, { options: { palette: FLAME }, scale, depth, loopFor: seconds });

/** Whether a type has a pixelfx impact (every damaging move then lands with it, not with the drawn one). */
export const hasTypeImpact = (type: string): boolean => IMPACT[type] !== undefined;

/** The impact a move of this type lands with on a struck Pokémon. */
export function typeImpactFx(scene: Phaser.Scene, type: string, at: Pt): void {
  const p = IMPACT[type];
  if (p) void pixelFx(scene, p[0], at, { options: p[1], scale: p[2] });
}

/** A critical hit's starburst, its blow aimed from the attacker. */
export const critFx = (scene: Phaser.Scene, from: Pt, at: Pt): Promise<void> =>
  pixelFx(scene, "critHit", { x: at.x, y: at.y + BODY }, {
    options: { aim: Math.atan2(at.y - from.y, at.x - from.x) * 0.3, flip: at.x < from.x }, scale: 0.9, depth: 34,
  });

/** A move's set piece: `contact` resolves when it reaches the target; `lands` when it is its own impact there. */
export interface SetPiece {
  readonly contact: Promise<void>;
  readonly lands: boolean;
}

/** Aimed pieces: the art point they leave from, and how far their fixed art runs from it (when it does not stretch). */
const RAY = {
  arcaneBeam: { anchor: [15, -24] as const, span: 168 },
  fireBreath: { anchor: [0, 0] as const, span: 118 },
  arcaneMissiles: { anchor: [15, -24] as const, span: 137 },
};

const MOVES: readonly (readonly [RegExp, (ctx: Ctx) => SetPiece])[] = [
  [/^(earthquake|bulldoze|magnitude|stomping-tantrum|high-horsepower)$/, ({ scene, from, wait }) => {
    void pixelFx(scene, "groundSlam", { x: from.x, y: from.y + 6 }, { scale: 0.8, depth: 29 });
    return { contact: wait(90), lands: false };
  }],
  [/^(fire-spin|magma-storm)$/, ({ scene, targets, wait }) => {
    for (const t of targets) void pixelFx(scene, "fireTornado", { x: t.x, y: t.y + BODY }, { scale: 0.55, depth: 32, loopFor: 1.4 });
    return { contact: wait(300), lands: true };
  }],
  [/^(twister|hurricane|whirlwind|bleakwind-storm)$/, ({ scene, targets, wait }) => {
    for (const t of targets) void pixelFx(scene, "tornado", { x: t.x, y: t.y + BODY }, { scale: 0.45, depth: 32, loopFor: 1.4 });
    return { contact: wait(300), lands: true };
  }],
  [/^(flamethrower|blast-burn|inferno|fire-pledge)$/, ({ scene, mouth, len, aim, wait }) => {
    // The stream runs `reach` art pixels; its tip curls on about 16 more, into the target.
    const reach = Math.max(20, len / PIXEL / 0.5 - 10);
    void pixelFx(scene, "flamethrower", mouth, { options: { reach }, scale: 0.5, depth: 32, loopFor: 0.8, aim, extend: reach - 112 });
    return { contact: wait(160), lands: false };
  }],
  [/^(heat-wave|dragon-breath|overheat|burn-up)$/, ({ scene, mouth, len, aim, wait }) => {
    void aimed(scene, "fireBreath", mouth, len, aim, {}, 0.8);
    return { contact: wait(160), lands: false };
  }],
  [/^(water-gun|hydro-pump|water-pulse|scald|hydro-cannon|brine|octazooka)$/, ({ scene, mouth, len, aim, wait }) => {
    // Spray flies on about 35 art pixels past the jet's end; the solid rod stops just short of the target.
    const length = Math.max(20, len / PIXEL / 0.5 - 14);
    void pixelFx(scene, "waterJet", mouth, { options: { length }, scale: 0.5, depth: 32, loopFor: 0.7, aim, extend: length - 118 });
    return { contact: wait(160), lands: false };
  }],
  [/^(surf|muddy-water|wave-crash|water-spout|liquidation)$/, ({ scene, from, targets, wait }) => {
    // The wave rolls in from the user's side and breaks on each target.
    for (const t of targets) void pixelFx(scene, "waveCrash", { x: t.x, y: t.y + BODY }, { options: { flip: t.x < from.x }, scale: 0.6, depth: 32 });
    return { contact: wait(1150), lands: true };
  }],
  [/^(ice-beam|ice-shard|frost-breath|icicle-spear|icicle-crash|freeze-dry)$/, ({ scene, from, to, wait }) => {
    // Along the ground, feet to feet: the frost line takes 0.48 s to run out, the blades burst up behind it.
    const feet = { x: from.x, y: from.y + 4 };
    const reach = Math.max(24, Math.hypot(to.x - feet.x, to.y + 4 - feet.y) / PIXEL / 0.5);
    void pixelFx(scene, "iceSpikes", feet, { options: { reach }, scale: 0.5, depth: 32, aim: Math.atan2(to.y + 4 - feet.y, to.x - feet.x), extend: reach - 172 });
    return { contact: wait(480), lands: true };
  }],
  [/^(thunder|thunderbolt|zap-cannon|volt-tackle|thunder-punch|discharge)$/, ({ scene, targets, wait }) => {
    // The bolt gathers for half a second, then strikes.
    for (const t of targets) void pixelFx(scene, "smite", { x: t.x, y: t.y + BODY }, { options: { palette: BOLT }, scale: 0.5, depth: 33 });
    return { contact: wait(560), lands: true };
  }],
  [/^(psychic|psystrike|psybeam|hyper-beam|dragon-pulse|dark-pulse|signal-beam|charge-beam|solar-beam|aurora-beam)$/, ({ scene, mouth, len, aim, id, wait }) => {
    const palette = BEAM_PALETTE[id] ?? PSY;
    void aimed(scene, "arcaneBeam", mouth, len, aim, { palette }, 0.7);
    return { contact: wait(140), lands: false };
  }],
  [/^(aura-sphere|swift|shadow-ball|energy-ball|focus-blast|magical-leaf)$/, ({ scene, mouth, len, aim, id, wait }) => {
    // The bolts curl out and pop on the target one after another, from about 0.8 s.
    const palette = id === "aura-sphere" || id === "focus-blast" ? AURA : id === "shadow-ball" ? SHADOW : undefined;
    const k = len / PIXEL / RAY.arcaneMissiles.span;
    void pixelFx(scene, "arcaneMissiles", mouth, { options: palette ? { palette } : {}, scale: k, depth: 32, aim, anchor: RAY.arcaneMissiles.anchor });
    return { contact: wait(800), lands: true };
  }],
  [/^(blizzard|sheer-cold|glaciate|powder-snow|icy-wind)$/, ({ scene, center, wait }) => {
    // A ring of ice crystals bursts out over the aimed area (its flash peaks at 0.5 s).
    void pixelFx(scene, "frostNova", { x: center.x, y: center.y + 6 }, { scale: 0.36, depth: 32 });
    return { contact: wait(500), lands: true };
  }],
  [/^(stone-edge|rock-tomb|stone-axe|rock-wrecker|head-smash|spikes)$/, ({ scene, targets, wait }) => {
    // A stone spike rams up under each target (the floor glows and heaves first, the spike bursts out at 0.47 s).
    for (const t of targets) void pixelFx(scene, "earthSpike", { x: t.x, y: t.y + 4 }, { scale: 0.42, depth: 32 });
    return { contact: wait(470), lands: true };
  }],
  [/^(rock-slide|rock-throw|rock-blast|ancient-power|smack-down|power-gem)$/, ({ scene, from, targets, wait }) => {
    // A boulder arcs from the user's feet and smashes down at each target's (its flight lands 113 art px on, at 0.51 s).
    const feet = { x: from.x, y: from.y + 4 };
    targets.forEach((t, i) => {
      const end = { x: t.x, y: t.y + 4 };
      const scale = Math.hypot(end.x - feet.x, end.y - feet.y) / PIXEL / 113;
      const go = () => void pixelFx(scene, "boulder", feet, { scale, depth: 33, aim: Math.atan2(end.y - feet.y, end.x - feet.x), anchor: [6, 0] });
      if (i === 0) go();
      else scene.time.delayedCall(i * 90, go);
    });
    return { contact: wait(510 + (targets.length - 1) * 90), lands: true };
  }],
  [/^(vine-whip|power-whip)$/, ({ scene, from, to, wait }) => {
    // A vine bursts from the ground at the user's feet, rears back and cracks on the target: at the crack (0.56 s)
    // its tip is 71 art px out and 20 up, about the target's body.
    const feet = { x: from.x, y: from.y + 4 };
    const end = { x: to.x, y: to.y + 4 };
    const scale = Phaser.Math.Clamp(Math.hypot(end.x - feet.x, end.y - feet.y) / PIXEL / 71, 0.3, 0.9);
    void pixelFx(scene, "vineWhip", feet, { scale, depth: 32, aim: Math.atan2(end.y - feet.y, end.x - feet.x) });
    return { contact: wait(560), lands: false };
  }],
  [/^(frenzy-plant)$/, ({ scene, from, to, wait }) => {
    // A seam runs along the ground and hooked thorns punch up out of it, each bigger, the last (114 art px on,
    // up at 0.6 s) under the target.
    const feet = { x: from.x, y: from.y + 4 };
    const end = { x: to.x, y: to.y + 4 };
    const scale = Math.max(0.3, Math.hypot(end.x - feet.x, end.y - feet.y) / PIXEL / 114);
    void pixelFx(scene, "thorns", feet, { scale, depth: 32, aim: Math.atan2(end.y - feet.y, end.x - feet.x) });
    return { contact: wait(600), lands: true };
  }],
  [/^(leech-seed|ingrain)$/, ({ scene, targets, wait }) => {
    // Roots burst up and cinch round each target's legs (at 0.62 s), hold, then crumble.
    for (const t of targets) void pixelFx(scene, "rootSnare", { x: t.x, y: t.y + 4 }, { scale: 0.42, depth: 32 });
    return { contact: wait(620), lands: true };
  }],
  [/^(spore)$/, ({ scene, targets, wait }) => {
    // The one mushroom move: a toadstool pushes up and puffs its spores over the target (at 0.8 s).
    for (const t of targets) void pixelFx(scene, "sporeBurst", { x: t.x, y: t.y + 4 }, { scale: 0.45, depth: 32 });
    return { contact: wait(800), lands: true };
  }],
  [/^(ember|fire-blast|flame-burst|mystical-fire|flame-charge|pyro-ball)$/, ({ scene, mouth, to, len, aim, id }) => {
    // The ball flies: its sprite tweened from the user's mouth to the target's body.
    const ms = Math.min(520, 160 + len * 1.2);
    const contact = new Promise<void>((resolve) => {
      void pixelFx(scene, "fireball", mouth, {
        scale: id === "ember" ? 0.35 : 0.55, depth: 33, loopFor: 3, aim,
        onImage: (img) => scene.tweens.add({ targets: img, x: to.x, y: to.y - BODY, duration: ms, onComplete: () => { img.setVisible(false); resolve(); } }),
      });
    });
    return { contact, lands: false };
  }],
];

interface Ctx {
  readonly scene: Phaser.Scene;
  readonly id: string;
  readonly from: Pt;
  readonly to: Pt;
  readonly targets: readonly Pt[];
  /** The aimed point (an area's centre). */
  readonly center: Pt;
  /** Where streams and beams leave the user. */
  readonly mouth: Pt;
  /** Screen pixels from the mouth to the target's body, and the angle. */
  readonly len: number;
  readonly aim: number;
  readonly wait: (ms: number) => Promise<void>;
}

/** A fixed aimed piece at one screen pixel per art pixel, cut off at the target, or scaled up if the target is further. */
function aimed(scene: Phaser.Scene, name: keyof typeof RAY, mouth: Pt, len: number, aim: number, options: Record<string, unknown>, loopFor: number): Promise<void> {
  const { anchor, span } = RAY[name];
  const scale = Math.max(0.5, len / PIXEL / span);
  return pixelFx(scene, name, mouth, { options, scale, depth: 32, loopFor, aim, anchor, crop: len / PIXEL / scale + 6 });
}

/** The move's own set piece when pixelfx has one (it stands in for the drawn effect); null when none fits. */
export function signatureFx(scene: Phaser.Scene, moveId: string, from: Pt, targets: readonly Pt[], center: Pt = targets[0] ?? from): SetPiece | null {
  const to = targets[0];
  if (!to) return null;
  const entry = MOVES.find(([re]) => re.test(moveId));
  if (!entry) return null;
  const mouth = { x: from.x, y: from.y - BODY };
  const len = Math.max(8, Math.hypot(to.x - mouth.x, to.y - BODY - mouth.y));
  const aim = Math.atan2(to.y - BODY - mouth.y, to.x - mouth.x);
  const wait = (ms: number) => new Promise<void>((r) => scene.time.delayedCall(ms, r));
  return entry[1]({ scene, id: moveId, from, to, targets, center, mouth, len, aim, wait });
}
