import Phaser from "phaser";
import type { MoveDef } from "../core/battle";
import { FONT, TYPE_COLORS } from "./ui/theme";

/**
 * Move effects drawn in code (no image files). A move's name picks how it looks — a vine lashes out,
 * leaves spin, a beam fires, jaws snap, a shield rises — and its type colours it; moves no family fits
 * fall back to a glowing orb and an impact styled by the type (flames rise, water splashes…).
 */

const DOT = "fx-dot";
const LEAF = "fx-leaf";
const STAR = "fx-star";
/** A flame tongue, 8×12 pixels: drawn hard-edged so it matches the sprites. */
const FLAME = "fx-flame";

/** Fire's colour over a particle's life: a white-hot core, yellow, orange, red, then grey smoke. */
const FIRE_RAMP = [0xffffff, 0xffd040, 0xf08030, 0xc03018, 0x5a5050];

type Pt = { readonly x: number; readonly y: number };

/** Impact look per type, after whatever carried the move there. */
type Style = "burst" | "rise" | "fall" | "bolt" | "rings" | "leaves" | "debris" | "wisps" | "slash" | "shards";

const STYLE: Record<string, Style> = {
  fire: "rise", water: "fall", ice: "shards", electric: "bolt", grass: "leaves", bug: "leaves",
  psychic: "rings", fairy: "rings", ghost: "wisps", poison: "wisps", dark: "wisps",
  rock: "debris", ground: "debris", steel: "shards", fighting: "slash", normal: "slash", flying: "slash", dragon: "rings",
};

/** How a move travels or lands; picked from its name (first match wins), else from its range. */
type Family =
  | "whip" | "leaves" | "volley" | "beam" | "stream" | "bubbles" | "lob" | "wind" | "bolt" | "sound" | "powder" | "gas"
  | "bite" | "claw" | "strike" | "ram" | "peck"
  | "shield" | "heal" | "aura" | "quake" | "blast"
  | "orb" | "melee";

const FAMILIES: readonly (readonly [Family, RegExp])[] = [
  ["shield", /protect|detect|barrier|reflect|light-screen|iron-defense|harden|withdraw|defense-curl|acid-armor|aurora-veil|safeguard|wide-guard|quick-guard|substitute|endure|mist\b|cosmic-power/],
  ["heal", /recover|rest\b|roost|synthesis|moonlight|morning-sun|soft-boiled|slack-off|heal|wish|aqua-ring|life-dew|ingrain|aromatherapy|swallow|strength-sap|milk-drink/],
  ["quake", /earthquake|magnitude|bulldoze|fissure|stomping-tantrum|high-horsepower|seismic/],
  ["blast", /explosion|self-destruct|blast-burn|burn-up|overheat|discharge|lava-plume|heat-wave|petal-blizzard|surf\b|muddy-water|sludge-wave|brutal-swing|breaking-swipe|draco-meteor|water-spout/],
  ["whip", /vine|power-whip|lash-out|^bind|wrap|constrict|tail-slap|power-whip|string-shot|infestation|sand-tomb|whirlpool|fire-spin|leech-seed/],
  ["leaves", /razor-leaf|magical-leaf|leaf-storm|leaf-tornado|petal-dance|trailblaze|frenzy-plant/],
  ["volley", /bullet-seed|pin-missile|twineedle|poison-sting|barrage|icicle-spear|ice-shard|spike-cannon|rock-blast|scale-shot|swift|fury-attack|fell-stinger|seed|stone-edge|power-gem|ancient-power|rock-slide/],
  ["beam", /beam|cannon|ray|psystrike|psyshock|flash|signal|zap|dragon-pulse|dark-pulse|water-pulse|aura-sphere|meteor|charge-beam|mirror-shot|psywave|night-shade|future-sight|extrasensory|confusion|psychic$|kinesis|telekinesis|dream-eater|hex$/],
  ["stream", /water-gun|hydro|flamethrower|inferno|scald|acid|octazooka|mud-shot|brine|chilling-water|frost-breath|dragon-breath|mystical-fire|flame-burst|ember|absorb|draining-kiss|^absorb|spit-up|venom|toxic|wring-out/],
  ["bubbles", /bubble|pollen-puff|sweet-kiss|draining-kiss|alluring-voice/],
  ["lob", /rock-throw|rock-tomb|egg-bomb|mud-bomb|sludge|gunk-shot|bonemerang|ice-ball|smack-down|magnet-bomb|electro-ball|shadow-ball|energy-ball|focus-blast|mud-slap|weather-ball|pay-day|bone/],
  ["wind", /gust|wind|air-|hurricane|twister|defog|tailwind|whirlwind|feather|silver-wind|vacuum|aerial-ace|sonic-boom|razor-wind/],
  ["bolt", /thunder|shock|spark|volt-|electroweb|nuzzle|^charge$|eerie-impulse/],
  ["sound", /growl|screech|hyper-voice|bug-buzz|metal-sound|disarming-voice|sing|supersonic|uproar|snarl|roar|perish-song|confide|psychic-noise|synchronoise|sparkling-aria|leer|scary-face|glare|mean-look|tail-whip|baby-doll-eyes|charm|captivate|tickle|fake-tears|taunt|encore|disable|swagger|flatter|play-nice|teeter-dance|lovely-kiss|hypnosis|confuse-ray|will-o-wisp|yawn|nightmare|curse|memento|lock-on|mind-reader|gravity|work-up|howl|coaching/],
  ["powder", /powder|spore|sand-attack|cotton|smokescreen|sweet-scent|stealth-rock|toxic-spikes|haze/],
  ["gas", /smog|poison-gas|clear-smog|ominous/],
  ["bite", /bite|fang|crunch|chomp|jaw|clamp|vice-grip|leech-life|lick|guillotine|super-fang/],
  ["claw", /scratch|claw|slash|cut\b|swipe|x-scissor|psycho-cut|leaf-blade|razor-shell|solar-blade|fury-cutter|false-swipe|night-slash|smart-strike|chop|cross/],
  ["peck", /peck|drill|horn|jab|megahorn|sting|needle|poison-tail|fell/],
  ["strike", /punch|kick|slap|pound|hammer|press|throw|smack|wing|arm|uppercut|mash|smash|submission|reversal|counter|revenge|payback|assurance|beat|knock|thrash|outrage|rage|feint|fake-out|wake-up|smelling|axe|low-|triple|double-hit|dual|storm|circle|vital|sky-|heart-stamp|dizzy|rollout|rapid-spin|gyro|ice-spinner|steamroller|stomp|crabhammer|liquidation|waterfall|aqua-tail|iron-tail|iron-head|metal|bullet-punch|mach|drain-punch/],
  ["ram", /tackle|slam|headbutt|charge|rush|body|take-down|double-edge|giga-impact|flare-blitz|wild-charge|head-smash|skull-bash|zen-headbutt|extreme-speed|quick-attack|aqua-jet|flame-wheel|flame-charge|dragon-tail|lunge|pounce|u-turn|flip-turn|wave-crash|last-resort|facade|endeavor|flail|struggle|bounce|fly\b|dig\b|phantom-force|shadow-sneak|sucker-punch|first-impression|sky-attack|brave-bird|high-jump|jump-kick|rolling-kick|volt-tackle|supercell|raging-bull|play-rough|heat-crash|heavy-slam|body-press|wood-hammer|strength|megakick|mega-kick|outrage/],
];

function familyOf(move: MoveDef): Family {
  for (const [f, re] of FAMILIES) if (re.test(move.id)) return f;
  if (move.range.max === 0) return move.power > 0 ? "blast" : "aura";
  return move.range.max <= 1 ? "melee" : "orb";
}

const ensureTextures = (scene: Phaser.Scene) => {
  if (scene.textures.exists(DOT)) return;
  const g = scene.make.graphics({}, false);
  // A hard-edged pixel diamond (no soft round blobs: the effects share the sprites' pixel look).
  g.fillStyle(0xffffff, 1).fillRect(3, 1, 2, 6).fillRect(1, 3, 6, 2).fillRect(2, 2, 4, 4);
  g.generateTexture(DOT, 8, 8);
  g.clear().fillStyle(0xffffff, 1);
  for (const [y, x0, w] of [[0, 3, 1], [1, 3, 2], [2, 2, 3], [3, 2, 4], [4, 1, 5], [5, 1, 6], [6, 1, 6], [7, 0, 7], [8, 0, 8], [9, 1, 6], [10, 1, 6], [11, 2, 4]] as const) g.fillRect(x0, y, w, 1);
  g.generateTexture(FLAME, 8, 12);
  g.clear().fillStyle(0xffffff, 1).fillEllipse(8, 4, 16, 7);
  g.lineStyle(1, 0x000000, 0.35).lineBetween(1, 4, 15, 4);
  g.generateTexture(LEAF, 16, 8);
  g.clear().fillStyle(0xffffff, 1).fillPoints([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => {
    const r = i % 2 ? 2.5 : 6;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    return new Phaser.Math.Vector2(6 + Math.cos(a) * r, 6 + Math.sin(a) * r);
  }), true);
  g.generateTexture(STAR, 12, 12);
  g.destroy();
  for (const key of [DOT, FLAME, STAR]) scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
};

const tween = (scene: Phaser.Scene, cfg: Phaser.Types.Tweens.TweenBuilderConfig) =>
  new Promise<void>((resolve) => scene.tweens.add({ ...cfg, onComplete: () => resolve() }));
const wait = (scene: Phaser.Scene, ms: number) => new Promise<void>((r) => scene.time.delayedCall(ms, r));
const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
/** Flight time for a projectile over a distance in pixels. */
const flight = (a: Pt, b: Pt, perPx = 1.6, max = 420) => Math.min(max, 90 + dist(a, b) * perPx);
const lift = (p: Pt): Pt => ({ x: p.x, y: p.y - 10 });

/** A short burst of particles at a point. */
function emit(scene: Phaser.Scene, at: Pt, color: number, cfg: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig, count: number, life = 600, texture = DOT): void {
  const e = scene.add.particles(at.x, at.y, texture, { emitting: false, blendMode: Phaser.BlendModes.ADD, tint: color, ...cfg }).setDepth(30);
  e.explode(count);
  scene.time.delayedCall(life + 100, () => e.destroy());
}

/** Plays the move's effect from `from` to every hit point; resolves when the impact has landed. */
export async function playMoveFx(scene: Phaser.Scene, move: MoveDef, from: Pt, targets: readonly Pt[]): Promise<void> {
  if (!targets.length) return;
  ensureTextures(scene);
  const color = TYPE_COLORS[move.type] ?? 0xffffff;
  const style = STYLE[move.type] ?? "burst";
  const main = targets[0]!;
  const family = familyOf(move);
  const typeImpact = () => Promise.all(targets.map((t) => impact(scene, style, t, color))).then(() => undefined);
  switch (family) {
    case "shield": return shield(scene, from, color);
    case "heal": return Promise.all(targets.map((t) => heal(scene, t))).then(() => undefined);
    case "aura": return aura(scene, from, color);
    case "quake": return quake(scene, from, color);
    case "blast": return blast(scene, from, targets, color, style);
    case "whip": await whip(scene, from, main, color); return typeImpact();
    case "leaves": await leaves(scene, from, main, color); return typeImpact();
    case "volley": await volley(scene, from, targets, color); return typeImpact();
    case "beam": await beam(scene, from, main, color); return typeImpact();
    case "stream": await (move.type === "fire" ? flames(scene, from, main) : stream(scene, from, main, color)); return typeImpact();
    case "bubbles": return bubbles(scene, from, targets, color);
    case "lob": await lob(scene, from, main, color); return typeImpact();
    case "wind": await wind(scene, from, main, color); return Promise.all(targets.map((t) => impact(scene, "slash", t, color))).then(() => undefined);
    case "bolt": if (dist(from, main) > 48) await bolt(scene, from, main, color); return typeImpact();
    case "sound": return sound(scene, from, targets, color);
    case "powder": return Promise.all(targets.map((t) => powder(scene, t, color))).then(() => undefined);
    case "gas": return Promise.all(targets.map((t) => gas(scene, t, color))).then(() => undefined);
    case "bite": return Promise.all(targets.map((t) => bite(scene, t, color))).then(() => undefined);
    case "claw": return Promise.all(targets.map((t) => claw(scene, t, color))).then(() => undefined);
    case "peck": return Promise.all(targets.map((t) => peck(scene, t, color))).then(() => undefined);
    case "strike": return Promise.all(targets.map((t) => strike(scene, t, color))).then(() => undefined);
    case "ram": return Promise.all(targets.map((t) => ram(scene, from, t, color))).then(() => undefined);
    case "orb": if (dist(from, main) > 48) await orb(scene, from, main, color); return typeImpact();
    case "melee": return typeImpact();
  }
}

// ---------------------------------------------------------------- travelling

/** A glowing orb with a trail. */
async function orb(scene: Phaser.Scene, a: Pt, b: Pt, color: number): Promise<void> {
  const o = scene.add.image(a.x, a.y - 10, DOT).setTint(color).setScale(2.2).setDepth(30).setBlendMode(Phaser.BlendModes.ADD);
  const trail = scene.add.particles(0, 0, DOT, {
    follow: o, lifespan: 260, speed: 10, scale: { start: 1.2, end: 0 }, alpha: { start: 0.8, end: 0 },
    tint: color, blendMode: Phaser.BlendModes.ADD, frequency: 18,
  }).setDepth(29);
  await tween(scene, { targets: o, x: b.x, y: b.y - 10, duration: flight(a, b), ease: "Sine.easeIn" });
  o.destroy();
  trail.stop();
  scene.time.delayedCall(300, () => trail.destroy());
}

/** A vine (or tail, or rope of silk) lashes out in a curve, cracks on the target and draws back. */
async function whip(scene: Phaser.Scene, a: Pt, b: Pt, color: number): Promise<void> {
  const g = scene.add.graphics().setDepth(30);
  const s = lift(a), e = lift(b);
  const len = dist(s, e) || 1;
  const nx = -(e.y - s.y) / len, ny = (e.x - s.x) / len;
  const bend = Math.min(40, len * 0.35);
  const curve = new Phaser.Curves.QuadraticBezier(
    new Phaser.Math.Vector2(s.x, s.y),
    new Phaser.Math.Vector2((s.x + e.x) / 2 + nx * bend, (s.y + e.y) / 2 + ny * bend),
    new Phaser.Math.Vector2(e.x, e.y),
  );
  const draw = (t: number) => {
    g.clear();
    const pts = curve.getPoints(16).slice(0, Math.max(2, Math.round(17 * t)));
    g.lineStyle(5, 0x1d4d21, 1).strokePoints(pts);
    g.lineStyle(3, color, 1).strokePoints(pts);
    // Little leaves along the vine.
    g.fillStyle(color, 1);
    for (let i = 3; i < pts.length; i += 4) g.fillEllipse(pts[i]!.x + nx * 4, pts[i]!.y + ny * 4, 6, 3);
  };
  const state = { t: 0 };
  await tween(scene, { targets: state, t: 1, duration: 170, ease: "Quad.easeOut", onUpdate: () => draw(state.t) });
  emit(scene, e, 0xffffff, { speed: { min: 40, max: 90 }, scale: { start: 0.7, end: 0 }, lifespan: 220 }, 8, 220);
  await tween(scene, { targets: state, t: 0, duration: 160, delay: 60, ease: "Quad.easeIn", onUpdate: () => draw(state.t) });
  g.destroy();
}

/** Spinning leaves fly at the target, one after another. */
async function leaves(scene: Phaser.Scene, a: Pt, b: Pt, color: number): Promise<void> {
  const flights = [0, 70, 140, 210].map(async (delay, i) => {
    const leaf = scene.add.image(a.x, a.y - 10, LEAF).setTint(i % 2 ? color : 0x9be27a).setDepth(30).setScale(1.2);
    const off = (i - 1.5) * 8;
    await tween(scene, {
      targets: leaf, x: b.x + off, y: b.y - 10 - off / 2, angle: 720, delay,
      duration: flight(a, b, 1.3, 360), ease: "Sine.easeIn",
    });
    leaf.destroy();
  });
  await Promise.all(flights);
}

/** A quick volley of small shots (seeds, needles, shards, stars). */
async function volley(scene: Phaser.Scene, a: Pt, targets: readonly Pt[], color: number): Promise<void> {
  const shots = [0, 1, 2, 3, 4].map(async (i) => {
    const b = targets[i % targets.length]!;
    const shot = scene.add.image(a.x, a.y - 10, i % 2 ? STAR : DOT).setTint(i % 2 ? 0xffffff : color).setDepth(30).setScale(i % 2 ? 0.8 : 1.1)
      .setBlendMode(Phaser.BlendModes.ADD);
    const jitter = (i - 2) * 5;
    await tween(scene, { targets: shot, x: b.x + jitter, y: b.y - 10 + jitter / 2, angle: 360, delay: i * 55, duration: flight(a, b, 0.9, 260) });
    shot.destroy();
    emit(scene, lift(b), color, { speed: { min: 30, max: 70 }, scale: { start: 0.6, end: 0 }, lifespan: 200 }, 4, 200);
  });
  await Promise.all(shots);
}

/** A straight beam with a white core that flares and fades. */
async function beam(scene: Phaser.Scene, a: Pt, b: Pt, color: number): Promise<void> {
  const g = scene.add.graphics().setDepth(30).setBlendMode(Phaser.BlendModes.ADD);
  const s = lift(a), e = lift(b);
  const state = { t: 0, w: 1 };
  const draw = () => {
    g.clear();
    const x = s.x + (e.x - s.x) * state.t, y = s.y + (e.y - s.y) * state.t;
    g.lineStyle(10 * state.w, color, 0.45).lineBetween(s.x, s.y, x, y);
    g.lineStyle(4 * state.w, 0xffffff, 0.95).lineBetween(s.x, s.y, x, y);
    g.fillStyle(color, 0.6).fillCircle(s.x, s.y, 7 * state.w);
  };
  await tween(scene, { targets: state, t: 1, duration: 140, onUpdate: draw });
  await tween(scene, { targets: state, w: 0, duration: 220, delay: 90, onUpdate: draw });
  g.destroy();
}

/** A jet of droplets or flames streaming along the line. */
async function stream(scene: Phaser.Scene, a: Pt, b: Pt, color: number): Promise<void> {
  const s = lift(a), e = lift(b);
  const angle = Phaser.Math.RadToDeg(Math.atan2(e.y - s.y, e.x - s.x));
  const speed = dist(s, e) / 0.32;
  const jet = scene.add.particles(s.x, s.y, DOT, {
    angle: { min: angle - 5, max: angle + 5 }, speed: { min: speed * 0.9, max: speed * 1.05 }, lifespan: 320,
    scale: { start: 0.9, end: 1.6 }, alpha: { start: 0.9, end: 0.2 }, tint: [color, 0xffffff], frequency: 12, quantity: 2,
    blendMode: Phaser.BlendModes.ADD,
  }).setDepth(30);
  await wait(scene, 300);
  jet.stop();
  scene.time.delayedCall(400, () => jet.destroy());
  await wait(scene, 120);
}

/** Fire as fire: a jet of flame tongues that burn from white-hot to red and trail grey smoke. */
async function flames(scene: Phaser.Scene, a: Pt, b: Pt): Promise<void> {
  const s = lift(a), e = lift(b);
  const angle = Phaser.Math.RadToDeg(Math.atan2(e.y - s.y, e.x - s.x));
  const speed = dist(s, e) / 0.34;
  const jet = scene.add.particles(s.x, s.y, FLAME, {
    angle: { min: angle - 7, max: angle + 7 }, speed: { min: speed * 0.85, max: speed * 1.05 }, lifespan: 360,
    scale: { start: 0.5, end: 1.5 }, alpha: { start: 1, end: 0.15 }, color: FIRE_RAMP, frequency: 14, quantity: 2,
    // Normal blending: added onto bright grass the ramp would wash out to white.
    rotate: { onEmit: () => angle + 90 + Phaser.Math.Between(-12, 12) }, blendMode: Phaser.BlendModes.NORMAL,
  }).setDepth(30);
  await wait(scene, 320);
  jet.stop();
  scene.time.delayedCall(420, () => jet.destroy());
  await wait(scene, 120);
}

/** Bubbles drift over and pop. */
async function bubbles(scene: Phaser.Scene, a: Pt, targets: readonly Pt[], color: number): Promise<void> {
  const all = [0, 1, 2, 3, 4, 5].map(async (i) => {
    const b = targets[i % targets.length]!;
    const r = 4 + (i % 3) * 2;
    const bub = scene.add.circle(a.x, a.y - 10, r).setStrokeStyle(2, color).setFillStyle(0xffffff, 0.15).setDepth(30);
    await tween(scene, { targets: bub, x: b.x + (i - 2.5) * 6, y: b.y - 14 + Math.sin(i) * 6, delay: i * 60, duration: flight(a, b, 2.2, 520), ease: "Sine.easeOut" });
    await tween(scene, { targets: bub, scale: 1.8, alpha: 0, duration: 120 });
    bub.destroy();
  });
  await Promise.all(all);
}

/** Something thrown in an arc (a rock, a bomb, a bone) that lands with a thud. */
async function lob(scene: Phaser.Scene, a: Pt, b: Pt, color: number): Promise<void> {
  const rock = scene.add.circle(a.x, a.y - 10, 6, color).setStrokeStyle(2, 0x000000, 0.5).setDepth(30);
  const shadow = scene.add.ellipse(a.x, a.y + 6, 12, 5, 0x000000, 0.3).setDepth(29);
  const state = { t: 0 };
  const h = 30 + dist(a, b) * 0.25;
  await tween(scene, {
    targets: state, t: 1, duration: flight(a, b, 1.8, 480),
    onUpdate: () => {
      const x = a.x + (b.x - a.x) * state.t, y = a.y + (b.y - a.y) * state.t;
      rock.setPosition(x, y - 10 - Math.sin(state.t * Math.PI) * h).setAngle(state.t * 400);
      shadow.setPosition(x, y + 6);
    },
  });
  rock.destroy();
  shadow.destroy();
  scene.cameras.main.shake(80, 0.002);
}

/** Crescents of wind sweep across. */
async function wind(scene: Phaser.Scene, a: Pt, b: Pt, color: number): Promise<void> {
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const cuts = [0, 90, 180].map(async (delay) => {
    const g = scene.add.graphics().setDepth(30).setPosition(a.x, a.y - 10).setRotation(ang);
    g.lineStyle(3, 0xffffff, 0.9).beginPath().arc(0, 0, 14, -1.1, 1.1).strokePath();
    g.lineStyle(2, color, 0.8).beginPath().arc(-5, 0, 14, -1.0, 1.0).strokePath();
    await tween(scene, { targets: g, x: b.x, y: b.y - 10, delay, duration: flight(a, b, 1.2, 320) });
    await tween(scene, { targets: g, alpha: 0, scale: 1.6, duration: 120 });
    g.destroy();
  });
  await Promise.all(cuts);
}

function bolt(scene: Phaser.Scene, a: Pt, b: Pt, color: number): Promise<void> {
  const g = scene.add.graphics().setDepth(30).setBlendMode(Phaser.BlendModes.ADD);
  const steps = 7;
  const draw = () => {
    g.clear();
    for (const [w, c, al] of [[5, color, 0.5], [2, 0xffffff, 1]] as const) {
      g.lineStyle(w, c, al).beginPath().moveTo(a.x, a.y - 10);
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        g.lineTo(a.x + (b.x - a.x) * t + Phaser.Math.Between(-8, 8), a.y - 10 + (b.y - a.y) * t + Phaser.Math.Between(-8, 8));
      }
      g.lineTo(b.x, b.y - 10).strokePath();
    }
  };
  draw();
  const flicker = scene.time.addEvent({ delay: 50, repeat: 4, callback: draw });
  return tween(scene, { targets: g, alpha: 0, delay: 200, duration: 120 }).then(() => {
    flicker.remove();
    g.destroy();
  });
}

/** Sound and glares: arcs ripple out from the user towards each target, then a ring on it. */
async function sound(scene: Phaser.Scene, a: Pt, targets: readonly Pt[], color: number): Promise<void> {
  const b = targets[0]!;
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const waves = [0, 110, 220].map(async (delay) => {
    const g = scene.add.graphics().setDepth(30).setPosition(a.x, a.y - 10).setRotation(ang).setAlpha(0);
    g.lineStyle(3, color, 1).beginPath().arc(0, 0, 10, -0.8, 0.8).strokePath();
    await tween(scene, { targets: g, x: b.x, y: b.y - 10, scale: 2.2, alpha: { from: 1, to: 0.2 }, delay, duration: flight(a, b, 1.4, 380) });
    g.destroy();
  });
  await Promise.all(waves);
  await Promise.all(targets.map((t) => impact(scene, "rings", t, color)));
}

/** A cloud of powder settles on the target. */
async function powder(scene: Phaser.Scene, at: Pt, color: number): Promise<void> {
  emit(scene, { x: at.x, y: at.y - 34 }, color, {
    speedX: { min: -25, max: 25 }, speedY: { min: 10, max: 40 }, gravityY: 30, scale: { start: 0.9, end: 0.3 },
    alpha: { start: 0.9, end: 0 }, lifespan: 750, blendMode: Phaser.BlendModes.NORMAL, x: { min: -14, max: 14 },
  }, 26, 750);
  await wait(scene, 450);
}

/** Puffs of gas billow around the target. */
async function gas(scene: Phaser.Scene, at: Pt, color: number): Promise<void> {
  const puffs = [0, 1, 2, 3, 4].map(async (i) => {
    const p = scene.add.circle(at.x + (i - 2) * 7, at.y - 6 + (i % 2) * 6, 7, color, 0.55).setDepth(30);
    await tween(scene, { targets: p, scale: 2.4, alpha: 0, y: p.y - 12, delay: i * 50, duration: 600, ease: "Sine.easeOut" });
    p.destroy();
  });
  await Promise.all(puffs);
}

// ---------------------------------------------------------------- melee

/** Upper and lower jaws snap shut on the target. */
async function bite(scene: Phaser.Scene, at: Pt, color: number): Promise<void> {
  const y = at.y - 10;
  const jaw = (top: boolean) => {
    const g = scene.add.graphics().setDepth(30).setPosition(at.x, y + (top ? -18 : 18));
    g.fillStyle(0xffffff, 1);
    for (let i = -2; i <= 2; i++) g.fillTriangle(i * 6 - 3, 0, i * 6 + 3, 0, i * 6, top ? 8 : -8);
    g.lineStyle(2, color, 1).lineBetween(-15, 0, 15, 0);
    return g;
  };
  const top = jaw(true), bottom = jaw(false);
  await Promise.all([
    tween(scene, { targets: top, y: y - 4, duration: 110, ease: "Quad.easeIn" }),
    tween(scene, { targets: bottom, y: y + 4, duration: 110, ease: "Quad.easeIn" }),
  ]);
  emit(scene, { x: at.x, y }, color, { speed: { min: 40, max: 100 }, scale: { start: 0.8, end: 0 }, lifespan: 260 }, 10, 260);
  await tween(scene, { targets: [top, bottom], alpha: 0, duration: 180, delay: 60 });
  top.destroy();
  bottom.destroy();
}

/** Three claw marks rake across. */
async function claw(scene: Phaser.Scene, at: Pt, color: number): Promise<void> {
  const g = scene.add.graphics().setDepth(30);
  const state = { t: 0 };
  await tween(scene, {
    targets: state, t: 1, duration: 150,
    onUpdate: () => {
      g.clear();
      for (let i = -1; i <= 1; i++) {
        const x0 = at.x - 14 + i * 7, y0 = at.y - 26;
        g.lineStyle(3, 0xffffff, 1).lineBetween(x0, y0, x0 + 20 * state.t, y0 + 26 * state.t);
        g.lineStyle(1, color, 1).lineBetween(x0 + 2, y0, x0 + 2 + 20 * state.t, y0 + 26 * state.t);
      }
    },
  });
  emit(scene, lift(at), color, { speed: { min: 30, max: 80 }, scale: { start: 0.6, end: 0 }, lifespan: 250 }, 8, 250);
  await tween(scene, { targets: g, alpha: 0, duration: 200, delay: 60 });
  g.destroy();
}

/** A hard hit: a star flash and a shock ring. */
async function strike(scene: Phaser.Scene, at: Pt, color: number): Promise<void> {
  const y = at.y - 10;
  const star = scene.add.image(at.x, y, STAR).setTint(0xffffff).setScale(0.5).setDepth(31).setBlendMode(Phaser.BlendModes.ADD);
  const ring = scene.add.circle(at.x, y, 8).setStrokeStyle(3, color).setDepth(30);
  emit(scene, { x: at.x, y }, color, { speed: { min: 60, max: 130 }, scale: { start: 0.8, end: 0 }, lifespan: 260 }, 10, 260);
  await Promise.all([
    tween(scene, { targets: star, scale: 2.4, angle: 45, alpha: { from: 1, to: 0 }, duration: 260 }),
    tween(scene, { targets: ring, scale: 3, alpha: { from: 1, to: 0 }, duration: 300 }),
  ]);
  star.destroy();
  ring.destroy();
}

/** A body blow: a shockwave on the side it came from, and dust. */
async function ram(scene: Phaser.Scene, from: Pt, at: Pt, color: number): Promise<void> {
  const ang = Math.atan2(at.y - from.y, at.x - from.x);
  const g = scene.add.graphics().setDepth(30).setPosition(at.x, at.y - 8).setRotation(ang);
  g.lineStyle(4, 0xffffff, 1).beginPath().arc(-6, 0, 16, -1.2, 1.2).strokePath();
  g.lineStyle(2, color, 1).beginPath().arc(-10, 0, 16, -1.0, 1.0).strokePath();
  emit(scene, { x: at.x, y: at.y + 6 }, 0xb8a888, {
    speed: { min: 20, max: 60 }, angle: { min: 180, max: 360 }, scale: { start: 1.2, end: 0.2 }, lifespan: 400, blendMode: Phaser.BlendModes.NORMAL,
  }, 10, 400);
  scene.cameras.main.shake(70, 0.0025);
  await tween(scene, { targets: g, alpha: 0, scale: 1.5, duration: 260 });
  g.destroy();
}

/** A sharp jab: a thin spike of light. */
async function peck(scene: Phaser.Scene, at: Pt, color: number): Promise<void> {
  const y = at.y - 10;
  const star = scene.add.image(at.x, y, STAR).setTint(color).setScale(0.4, 1.6).setDepth(31).setBlendMode(Phaser.BlendModes.ADD);
  emit(scene, { x: at.x, y }, 0xffffff, { speed: { min: 50, max: 110 }, scale: { start: 0.5, end: 0 }, lifespan: 200 }, 6, 200);
  await tween(scene, { targets: star, scaleY: 0.2, scaleX: 1.6, alpha: { from: 1, to: 0 }, duration: 220 });
  star.destroy();
}

// ---------------------------------------------------------------- self and area

/** A shield shimmers up around the user. */
async function shield(scene: Phaser.Scene, at: Pt, color: number): Promise<void> {
  const pts = [0, 1, 2, 3, 4, 5].map((i) => new Phaser.Math.Vector2(Math.cos(Math.PI / 6 + (i * Math.PI) / 3) * 22, Math.sin(Math.PI / 6 + (i * Math.PI) / 3) * 22));
  const g = scene.add.graphics().setDepth(30).setPosition(at.x, at.y - 8).setScale(0.3).setAlpha(0);
  g.fillStyle(color, 0.25).fillPoints(pts, true);
  g.lineStyle(3, 0xffffff, 0.9).strokePoints(pts, true, true);
  await tween(scene, { targets: g, scale: 1, alpha: 1, duration: 220, ease: "Back.easeOut" });
  await tween(scene, { targets: g, alpha: 0, duration: 300, delay: 200 });
  g.destroy();
}

/** Green crosses rise from the healed Pokémon. */
async function heal(scene: Phaser.Scene, at: Pt): Promise<void> {
  const crosses = [0, 1, 2, 3].map(async (i) => {
    const t = scene.add.text(at.x + (i - 1.5) * 9, at.y, "+", { fontFamily: FONT, fontSize: "16px", color: "#7ed321", fontStyle: "bold" })
      .setOrigin(0.5).setDepth(31).setStroke("#0f3a1c", 3);
    await tween(scene, { targets: t, y: at.y - 34, alpha: { from: 1, to: 0 }, delay: i * 80, duration: 520 });
    t.destroy();
  });
  emit(scene, lift(at), 0x7ed321, { speedY: { min: -60, max: -20 }, speedX: { min: -20, max: 20 }, scale: { start: 0.8, end: 0 }, lifespan: 600 }, 12, 600);
  await Promise.all(crosses);
}

/** Sparkles swirl up around the user (a buff). */
async function aura(scene: Phaser.Scene, at: Pt, color: number): Promise<void> {
  emit(scene, { x: at.x, y: at.y + 4 }, color, {
    speedY: { min: -80, max: -30 }, speedX: { min: -15, max: 15 }, x: { min: -14, max: 14 }, scale: { start: 1, end: 0 }, lifespan: 650,
  }, 18, 650);
  emit(scene, { x: at.x, y: at.y - 6 }, 0xffffff, { speed: { min: 10, max: 30 }, scale: { start: 0.5, end: 0 }, lifespan: 500 }, 6, 500, STAR);
  await wait(scene, 480);
}

/** The ground shakes: the camera rattles and rings of dust roll outwards. */
async function quake(scene: Phaser.Scene, at: Pt, color: number): Promise<void> {
  scene.cameras.main.shake(380, 0.006);
  const rings = [0, 120, 240].map(async (delay) => {
    const r = scene.add.ellipse(at.x, at.y + 6, 20, 8).setStrokeStyle(3, color).setDepth(29).setAlpha(0);
    await tween(scene, { targets: r, scale: 6, alpha: { from: 0.9, to: 0 }, delay, duration: 480 });
    r.destroy();
  });
  await Promise.all(rings);
}

/** A blast around the user (or a wave over the area): a bright ring sweeping out over everyone hit. */
async function blast(scene: Phaser.Scene, from: Pt, targets: readonly Pt[], color: number, style: Style): Promise<void> {
  const reach = Math.max(40, ...targets.map((t) => dist(from, t) + 20));
  const ring = scene.add.circle(from.x, from.y - 8, 10).setStrokeStyle(6, color).setDepth(30).setBlendMode(Phaser.BlendModes.ADD);
  const core = scene.add.circle(from.x, from.y - 8, 10, 0xffffff, 0.7).setDepth(30).setBlendMode(Phaser.BlendModes.ADD);
  scene.cameras.main.shake(160, 0.004);
  await Promise.all([
    tween(scene, { targets: ring, scale: reach / 10, alpha: { from: 1, to: 0 }, duration: 380, ease: "Quad.easeOut" }),
    tween(scene, { targets: core, scale: 2.5, alpha: { from: 0.8, to: 0 }, duration: 260 }),
  ]);
  ring.destroy();
  core.destroy();
  await Promise.all(targets.map((t) => impact(scene, style, t, color)));
}

// ---------------------------------------------------------------- impact by type

function impact(scene: Phaser.Scene, style: Style, at: Pt, color: number): Promise<void> {
  const p = lift(at);
  const fx = (cfg: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig, count: number, life = 600) => emit(scene, p, color, cfg, count, life);
  switch (style) {
    case "rise":
      // Tongues of flame licking upwards from where it hit, then smoke.
      emit(scene, p, color, { speedY: { min: -110, max: -50 }, speedX: { min: -28, max: 28 }, scale: { start: 1.3, end: 0.4 }, lifespan: 620, color: FIRE_RAMP, blendMode: Phaser.BlendModes.NORMAL }, 20, 620, FLAME);
      emit(scene, { x: p.x, y: p.y - 14 }, 0x6a6060, { speedY: { min: -40, max: -20 }, speedX: { min: -12, max: 12 }, scale: { start: 1, end: 2.2 }, alpha: { start: 0.45, end: 0 }, lifespan: 800, delay: 200, blendMode: Phaser.BlendModes.NORMAL }, 6, 1000);
      break;
    case "fall":
      fx({ speed: { min: 60, max: 130 }, angle: { min: 200, max: 340 }, gravityY: 320, scale: { start: 1.1, end: 0.3 }, lifespan: 600, tint: [color, 0xbfe6ff] }, 18);
      break;
    case "shards":
      fx({ speed: { min: 80, max: 160 }, scaleX: { start: 0.5, end: 0 }, scaleY: { start: 1.8, end: 0 }, rotate: { min: 0, max: 360 }, lifespan: 450, tint: [color, 0xffffff] }, 14, 450);
      break;
    case "bolt":
      fx({ speed: { min: 60, max: 140 }, scale: { start: 0.9, end: 0 }, lifespan: 300, tint: [color, 0xffffff] }, 16, 300);
      break;
    case "leaves":
      emit(scene, p, color, { speed: { min: 30, max: 90 }, rotate: { start: 0, end: 540 }, gravityY: 60, lifespan: 750, blendMode: Phaser.BlendModes.NORMAL, scale: { start: 0.9, end: 0.4 } }, 10, 750, LEAF);
      break;
    case "debris":
      fx({ speed: { min: 50, max: 120 }, angle: { min: 200, max: 340 }, gravityY: 400, scale: { start: 1.4, end: 0.8 }, lifespan: 600, blendMode: Phaser.BlendModes.NORMAL, tint: [color, 0x6b5233] }, 16);
      break;
    case "wisps":
      fx({ speedY: { min: -50, max: -15 }, speedX: { min: -20, max: 20 }, scale: { start: 0.6, end: 2.2 }, alpha: { start: 0.7, end: 0 }, lifespan: 800 }, 10, 800);
      break;
    case "rings": {
      const rings = [0, 120, 240].map((d) => {
        const r = scene.add.circle(p.x, p.y, 6).setStrokeStyle(3, color).setDepth(30).setAlpha(0);
        return tween(scene, { targets: r, scale: 4, alpha: { from: 1, to: 0 }, delay: d, duration: 420 }).then(() => r.destroy());
      });
      return Promise.all(rings).then(() => undefined);
    }
    case "slash": {
      const g = scene.add.graphics().setDepth(30);
      g.lineStyle(4, 0xffffff, 1).beginPath().arc(p.x, p.y, 16, Phaser.Math.DegToRad(200), Phaser.Math.DegToRad(340)).strokePath();
      g.lineStyle(2, color, 1).beginPath().arc(p.x, p.y, 20, Phaser.Math.DegToRad(210), Phaser.Math.DegToRad(330)).strokePath();
      fx({ speed: { min: 40, max: 90 }, scale: { start: 0.8, end: 0 }, lifespan: 300, tint: [0xffffff, color] }, 8, 300);
      return tween(scene, { targets: g, alpha: 0, duration: 260, delay: 80 }).then(() => g.destroy());
    }
    default:
      fx({ speed: { min: 50, max: 120 }, scale: { start: 1, end: 0 }, lifespan: 400 }, 14, 400);
  }
  return wait(scene, 220);
}

/** Which family a move animates with (for tests and tuning). */
export const moveFxFamily = familyOf;

/**
 * A camp fire that burns on its own (for the camp screen): flame tongues from white-hot to red, embers rising and a
 * thread of smoke. Returns its emitters (they go with the scene).
 */
export function campfire(scene: Phaser.Scene, x: number, y: number, depth: number, big = 1): Phaser.GameObjects.Particles.ParticleEmitter[] {
  ensureTextures(scene);
  const smoke = scene.add.particles(x, y - 26 * big, DOT, {
    speedY: { min: -24, max: -12 }, speedX: { min: -3, max: 9 }, lifespan: 1700, scale: { start: 0.7 * big, end: 2 * big },
    alpha: { start: 0.22, end: 0 }, tint: 0x9a96a6, frequency: 170, blendMode: Phaser.BlendModes.NORMAL,
  }).setDepth(depth - 0.1);
  const fire = scene.add.particles(x, y, FLAME, {
    x: { min: -8 * big, max: 8 * big }, speedY: { min: -48 * big, max: -26 * big }, speedX: { min: -6, max: 6 }, lifespan: { min: 360, max: 600 },
    scale: { start: 1.5 * big, end: 0.3 }, alpha: { start: 1, end: 0.25 }, color: FIRE_RAMP, frequency: 32, quantity: 1, blendMode: Phaser.BlendModes.NORMAL,
  }).setDepth(depth);
  const embers = scene.add.particles(x, y - 8, DOT, {
    x: { min: -8, max: 8 }, speedY: { min: -70, max: -34 }, speedX: { min: -16, max: 16 }, lifespan: 1000, scale: { start: 0.4, end: 0 },
    tint: 0xffc040, frequency: 240, blendMode: Phaser.BlendModes.ADD,
  }).setDepth(depth + 0.1);
  return [smoke, fire, embers];
}
