import Phaser from "phaser";
import { groundFlame } from "./pixelFx";
import type { Hazard, MoveDef } from "../core/battle";
import type { BoardTheme } from "./ui/boardDecor";
import { TYPE_COLORS } from "./ui/theme";
import type { GroundLight, GroundPool } from "./terrainShader";

/**
 * The battlefield reacting to the battle, drawn in code: drifting motes and shimmering water while it
 * is calm, burning ground that flickers and smokes, poison that bubbles, mud that pops, and marks big
 * hits leave behind (scorches, cracks, wet splashes, frost, torn leaves) for the rest of the battle.
 * Decoration only: the rules never read any of it.
 */

type Pt = { readonly x: number; readonly y: number };

const DOT = "arena-dot";
const SOFT = "arena-soft";
const CHUNK = "arena-chunk";
const LEAF = "arena-leaf";

/** Marks a hit leaves on the ground, by the move's type. */
type Mark = "scorch" | "crack" | "splash" | "frost" | "leaves" | "stain" | "spark" | "dent";
/** One ring of a speckled mark: out to `to` (of the radius), its colours, opacity and how many cells it fills. */
interface Ring { readonly to: number; readonly colors: readonly number[]; readonly alpha: number; readonly fill: number; readonly upper?: boolean; readonly lower?: boolean }
interface Earth { readonly rim: number[]; readonly lit: number[]; readonly shade: number[]; readonly floor: number[]; readonly deep: number[]; readonly stone: number[] }
/** Ground set alight by a fire hit, burning down. */
interface Burn { readonly x: number; readonly y: number; readonly r: number; readonly start: number; readonly ms: number }
const MARK_OF: Readonly<Record<string, Mark>> = {
  fire: "scorch", ground: "crack", rock: "crack", fighting: "crack", steel: "crack", dragon: "crack",
  water: "splash", ice: "frost", grass: "leaves", bug: "leaves", poison: "stain", ghost: "stain", dark: "stain",
  electric: "spark", psychic: "dent", fairy: "dent",
};

/** Types whose heavy hits blow a hole in the ground (a wave or a beam of light does not). */
const CRATER_TYPES: ReadonlySet<string> = new Set(["rock", "ground", "fighting", "steel", "normal", "fire", "dragon"]);

/** What drifts over the field while it is calm, per board theme. */
const MOTES: Readonly<Record<BoardTheme, { color: number; dy: number; alpha: number }>> = {
  field: { color: 0xfff3a0, dy: -6, alpha: 0.55 },
  cave: { color: 0xc8b8a8, dy: 7, alpha: 0.35 },
  shore: { color: 0xe8f6ff, dy: -4, alpha: 0.5 },
  indoor: { color: 0xd8dce8, dy: 2, alpha: 0.3 },
  gym: { color: 0xfff3d0, dy: -3, alpha: 0.3 },
};

function ensureTextures(scene: Phaser.Scene): void {
  if (scene.textures.exists(DOT)) return;
  const g = scene.make.graphics({}, false);
  g.fillStyle(0xffffff, 1).fillCircle(4, 4, 4);
  g.generateTexture(DOT, 8, 8);
  // A soft round blob (concentric circles) for smoke, mist and glows.
  g.clear();
  for (let r = 16; r > 0; r -= 2) g.fillStyle(0xffffff, 0.09).fillCircle(16, 16, r);
  g.generateTexture(SOFT, 32, 32);
  g.clear().fillStyle(0xffffff, 1).fillPoints([new Phaser.Math.Vector2(0, 2), new Phaser.Math.Vector2(4, 0), new Phaser.Math.Vector2(7, 3), new Phaser.Math.Vector2(5, 7), new Phaser.Math.Vector2(1, 6)], true);
  g.generateTexture(CHUNK, 8, 8);
  g.clear().fillStyle(0xffffff, 1).fillEllipse(6, 3, 12, 5);
  g.generateTexture(LEAF, 12, 6);
  g.destroy();
}

export class ArenaFx {
  private readonly decals: Phaser.GameObjects.RenderTexture;
  private readonly brush: Phaser.GameObjects.Graphics;
  /** A second brush for rubble landing while the first is mid-mark. */
  private readonly stamp: Phaser.GameObjects.Graphics;
  private burns: Burn[] = [];
  private readonly hazardViews = new Map<number, { objs: Phaser.GameObjects.GameObject[]; hazard: Hazard; center: Pt }>();
  private waterFx: Phaser.GameObjects.GameObject[] = [];
  /** Short bursts of light from attacks, fading out. */
  private flashes: { light: GroundLight; start: number; ms: number }[] = [];
  /** Where the ground lights come from each frame (the GPU ground, when there is one). */
  onLights: ((lights: GroundLight[], pools: GroundPool[]) => void) | null = null;
  /** Lights that are always on (a cave's Pokémon and crystals), asked for every frame. */
  steadyLights: (() => GroundLight[]) | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    /** The board on screen. */
    private readonly board: { x: number; y: number; w: number; h: number },
    private readonly theme: BoardTheme,
    /** Pixels per field unit. */
    private readonly unit: number,
  ) {
    ensureTextures(scene);
    // Marks sit on the ground: above the board texture, under everything else.
    this.decals = scene.add.renderTexture(board.x, board.y, board.w, board.h).setOrigin(0).setDepth(-0.9);
    this.brush = scene.make.graphics({}, false);
    this.stamp = scene.make.graphics({}, false);
    this.ambient();
    this.vignette();
    scene.events.on("update", this.tickLights, this);
    scene.events.once("shutdown", () => scene.events.off("update", this.tickLights, this));
  }

  /** Burning ground flickers; attack flashes fade; both light the ground around them. */
  private tickLights(): void {
    if (!this.onLights) return;
    const now = this.scene.time.now;
    this.flashes = this.flashes.filter((f) => now - f.start < f.ms);
    const out: GroundLight[] = [];
    const pools: GroundPool[] = [];
    for (const v of this.hazardViews.values()) {
      if (v.hazard.kind !== "mud") pools.push({ x: v.center.x, y: v.center.y, radius: v.hazard.radius * this.unit, kind: v.hazard.kind });
      if (v.hazard.kind !== "fire") continue;
      const c = v.center;
      const flicker = 0.75 + 0.15 * Math.sin(now / 70 + c.x) + 0.1 * Math.sin(now / 37 + c.y);
      out.push({ x: c.x, y: c.y, radius: v.hazard.radius * this.unit * 2.2, intensity: 0.45 * flicker, color: 0xff8a30 });
    }
    // Ground set alight by fire hits: flames that flare up, burn and die down, lighting the ground round them.
    for (const b of this.burns) {
      const u = (now - b.start) / b.ms, k = Math.min(1, u * 6) * Math.min(1, (1 - u) * 3);
      if (k <= 0) continue;
      pools.push({ x: b.x, y: b.y, radius: b.r * (0.4 + 0.6 * k), kind: "fire" });
      const flicker = 0.75 + 0.15 * Math.sin(now / 70 + b.x) + 0.1 * Math.sin(now / 37 + b.y);
      out.push({ x: b.x, y: b.y, radius: b.r * 2.4, intensity: 0.55 * flicker * k, color: 0xff8a30 });
    }
    for (const f of this.flashes) out.push({ ...f.light, intensity: f.light.intensity * (1 - (now - f.start) / f.ms) });
    if (this.steadyLights) out.push(...this.steadyLights());
    this.onLights(out.sort((a, b) => b.intensity - a.intensity), pools);
  }

  /** A burst of light on the ground (an attack landing, a bolt). */
  flash(at: Pt, color: number, radius: number, ms = 450, intensity = 1.3): void {
    this.flashes.push({ light: { x: at.x, y: at.y, radius, intensity, color }, start: this.scene.time.now, ms });
  }

  /** Motes drifting over the field: pollen, cave dust, sea spray. */
  private ambient(): void {
    const m = MOTES[this.theme];
    const { x, y, w, h } = this.board;
    this.scene.add.particles(0, 0, DOT, {
      // Drifting at most ~30 px in a life, they never leave the board.
      x: { min: x + 10, max: x + w - 10 }, y: { min: y + 34, max: y + h - 34 },
      lifespan: 4500, frequency: 260, quantity: 1,
      speedX: { min: -5, max: 5 }, speedY: { min: m.dy - 3, max: m.dy + 3 },
      scale: { start: 0.25, end: 0.45 }, alpha: { values: [0, m.alpha, m.alpha, 0] },
      tint: m.color, blendMode: Phaser.BlendModes.ADD,
    }).setDepth(1.4);
  }

  /** The board's edges sink into shadow, so the field reads as a place, not a rectangle. */
  private vignette(): void {
    const { x, y, w, h } = this.board;
    const g = this.scene.add.graphics().setDepth(1.3);
    for (let i = 0; i < 10; i++) {
      const a = 0.05 * (1 - i / 10);
      const d = i * 3;
      g.fillStyle(0x000000, a);
      g.fillRect(x + d, y + d, w - 2 * d, 3).fillRect(x + d, y + h - d - 3, w - 2 * d, 3);
      g.fillRect(x + d, y + d + 3, 3, h - 2 * d - 6).fillRect(x + w - d - 3, y + d + 3, 3, h - 2 * d - 6);
    }
    g.lineStyle(2, 0x000000, 0.5).strokeRect(x, y, w, h);
  }

  /** Water glints: small highlights fading in and out at random over the water tiles. */
  syncWater(cells: readonly Pt[]): void {
    this.waterFx.forEach((o) => o.destroy());
    this.waterFx = [];
    const picked = cells.filter((_, i) => i % 2 === 0).slice(0, 60);
    for (const c of picked) {
      const glint = this.scene.add.rectangle(c.x + Phaser.Math.Between(-8, 8), c.y + Phaser.Math.Between(-8, 8), Phaser.Math.Between(5, 10), 1.5, 0xd8f0ff, 0).setDepth(-0.8);
      this.scene.tweens.add({ targets: glint, alpha: { from: 0, to: 0.8 }, x: glint.x + 4, duration: Phaser.Math.Between(700, 1300), yoyo: true, repeat: -1, delay: Phaser.Math.Between(0, 3000), repeatDelay: Phaser.Math.Between(800, 3000) });
      this.waterFx.push(glint);
    }
  }

  /** Burning, poisoned and muddy ground come alive while they last; burnt ground stays marked after. */
  syncHazards(hazards: readonly Hazard[], toWorld: (p: Pt) => Pt): void {
    const live = new Set(hazards.map((h) => h.id));
    for (const [id, v] of this.hazardViews) {
      if (live.has(id)) continue;
      const c = toWorld(v.hazard.at);
      // What it leaves behind.
      if (v.hazard.kind === "fire") this.mark(c, "scorch", v.hazard.radius * this.unit);
      if (v.hazard.kind === "poison") this.mark(c, "stain", v.hazard.radius * this.unit);
      for (const o of v.objs) {
        if (o instanceof Phaser.GameObjects.Particles.ParticleEmitter) {
          o.stop();
          this.scene.time.delayedCall(1500, () => o.destroy());
        } else this.scene.tweens.add({ targets: o, alpha: 0, duration: 500, onComplete: () => o.destroy() });
      }
      this.hazardViews.delete(id);
    }
    for (const h of hazards) {
      if (this.hazardViews.has(h.id)) continue;
      this.hazardViews.set(h.id, { hazard: h, center: toWorld(h.at), objs: this.hazardView(h, toWorld(h.at)) });
    }
  }

  private hazardView(h: Hazard, c: Pt): Phaser.GameObjects.GameObject[] {
    const r = h.radius * this.unit;
    // Random spots in the circle, but never past the board's edge (relative to the emitter at c).
    const b = this.board;
    const source = {
      getRandomPoint: (p: Phaser.Types.Math.Vector2Like) => {
        for (let i = 0; i < 8; i++) {
          const a = Math.random() * Math.PI * 2;
          const d = Math.sqrt(Math.random()) * r * 0.9;
          const x = Math.cos(a) * d, y = Math.sin(a) * d;
          if (c.x + x > b.x + 4 && c.x + x < b.x + b.w - 4 && c.y + y > b.y + 10 && c.y + y < b.y + b.h - 4) {
            p.x = x;
            p.y = y;
            return p;
          }
        }
        p.x = 0;
        p.y = 0;
        return p;
      },
    };
    const zone = { type: "random" as const, source, quantity: 1 };
    const s = this.scene;
    // The GPU ground paints the flames and the sludge itself; only smoke and mist rise above it.
    if (this.onLights) {
      if (h.kind === "mud") return [];
      return [s.add.particles(c.x, c.y - (h.kind === "fire" ? 10 : 0), SOFT, {
        emitZone: zone, lifespan: h.kind === "fire" ? 1800 : 2400, frequency: h.kind === "fire" ? 220 : 320,
        speedY: h.kind === "fire" ? { min: -24, max: -12 } : { min: -6, max: 2 }, speedX: { min: -6, max: 6 },
        scale: { start: 0.5, end: 1.4 }, alpha: { start: h.kind === "fire" ? 0.3 : 0.2, end: 0 }, tint: h.kind === "fire" ? 0x2a2a2a : 0x9a50d8,
      }).setDepth(1.7)];
    }
    if (h.kind === "fire") {
      const glow = this.groundDisc(c, r, 0xff5a10, 0.22);
      s.tweens.add({ targets: glow, alpha: { from: 0.14, to: 0.32 }, scale: { from: 0.96, to: 1.04 }, duration: 380, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      const flames = s.add.particles(c.x, c.y, DOT, {
        emitZone: zone, lifespan: { min: 450, max: 850 }, frequency: 14, quantity: 1,
        speedY: { min: -60, max: -25 }, speedX: { min: -6, max: 6 }, scale: { start: 1.1, end: 0.1 },
        alpha: { start: 0.9, end: 0 }, tint: [0xffe066, 0xff9a1f, 0xff4a10], blendMode: Phaser.BlendModes.ADD,
      }).setDepth(1.6);
      const smoke = s.add.particles(c.x, c.y - 10, SOFT, {
        emitZone: zone, lifespan: 1800, frequency: 260, speedY: { min: -22, max: -12 }, speedX: { min: -6, max: 6 },
        scale: { start: 0.4, end: 1.2 }, alpha: { start: 0.28, end: 0 }, tint: 0x2a2a2a,
      }).setDepth(1.7);
      const embers = s.add.particles(c.x, c.y, DOT, {
        emitZone: zone, lifespan: 1400, frequency: 180, speedY: { min: -70, max: -40 }, speedX: { min: -20, max: 20 },
        scale: { start: 0.3, end: 0 }, tint: 0xffd040, blendMode: Phaser.BlendModes.ADD,
      }).setDepth(1.7);
      // Big soft tongues of flame under the sparks.
      const tongues = s.add.particles(c.x, c.y, SOFT, {
        emitZone: zone, lifespan: 700, frequency: 70, speedY: { min: -40, max: -20 },
        scale: { start: 0.9, end: 0.3 }, alpha: { start: 0.7, end: 0 }, tint: [0xff7a1a, 0xff4a10], blendMode: Phaser.BlendModes.ADD,
      }).setDepth(1.55);
      return [glow, tongues, flames, smoke, embers];
    }
    if (h.kind === "poison") {
      const pool = this.groundDisc(c, r, 0x8a3ad0, 0.2);
      s.tweens.add({ targets: pool, alpha: { from: 0.14, to: 0.26 }, duration: 1100, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      const bubbles = s.add.particles(c.x, c.y, DOT, {
        emitZone: zone, lifespan: { min: 500, max: 900 }, frequency: 50, speedY: { min: -14, max: -4 },
        scale: { start: 0.3, end: 0.9 }, alpha: { values: [0.9, 0.9, 0] }, tint: [0xc070ff, 0xa04ad8, 0x7fd46a],
      }).setDepth(1.6);
      const mist = s.add.particles(c.x, c.y, SOFT, {
        emitZone: zone, lifespan: 2400, frequency: 300, speedX: { min: -8, max: 8 }, speedY: { min: -6, max: 2 },
        scale: { start: 0.6, end: 1.6 }, alpha: { start: 0.25, end: 0 }, tint: 0x9a50d8,
      }).setDepth(1.7);
      return [pool, bubbles, mist];
    }
    // Mud: slow bubbles popping on the wet patch (the patch itself is terrain on the board).
    const pops = s.add.particles(c.x, c.y, DOT, {
      emitZone: zone, lifespan: 700, frequency: 320, scale: { start: 0.2, end: 0.6 }, alpha: { values: [0, 0.7, 0] }, tint: 0xa8865a,
    }).setDepth(-0.6);
    return [pops];
  }

  /** A disc on the ground, cut to the board (its points clamped to the edges); scales about its centre. */
  private groundDisc(c: Pt, r: number, color: number, alpha: number): Phaser.GameObjects.Graphics {
    const b = this.board;
    const pts = Array.from({ length: 32 }, (_, i) => {
      const a = (i / 32) * Math.PI * 2;
      return new Phaser.Math.Vector2(
        Phaser.Math.Clamp(c.x + Math.cos(a) * r, b.x, b.x + b.w) - c.x,
        Phaser.Math.Clamp(c.y + Math.sin(a) * r, b.y, b.y + b.h) - c.y,
      );
    });
    return this.scene.add.graphics({ x: c.x, y: c.y }).fillStyle(color, 1).fillPoints(pts, true).setAlpha(alpha).setDepth(-0.7);
  }

  /** Spray when the ground turns into something else (water, mud, bush, rock). */
  terrainBurst(at: Pt, terrain: string): void {
    const s = this.scene;
    const r = this.unit * 0.6;
    const ring = s.add.circle(at.x, at.y, r, 0xffffff, 0).setStrokeStyle(3, 0xffffff, 0.8).setDepth(1.8).setScale(0.3);
    s.tweens.add({ targets: ring, scale: 1.4, alpha: 0, duration: 450, ease: "Cubic.easeOut", onComplete: () => ring.destroy() });
    const look: Record<string, { tex: string; tint: number[]; gravity: number; speed: number }> = {
      "~": { tex: DOT, tint: [0x6fb8ff, 0xd8f0ff, 0x3a8ee8], gravity: 260, speed: 140 },
      m: { tex: DOT, tint: [0x7a5a32, 0x5a4026, 0xa8865a], gravity: 300, speed: 120 },
      '"': { tex: LEAF, tint: [0x57b847, 0x3f9c35, 0x8ad86a], gravity: 40, speed: 90 },
      "#": { tex: CHUNK, tint: [0x6a6d74, 0x4a4d54, 0x8a8d94], gravity: 380, speed: 170 },
    };
    const l = look[terrain] ?? look["#"]!;
    const e = s.add.particles(at.x, at.y, l.tex, {
      emitting: false, lifespan: 750, speed: { min: l.speed * 0.4, max: l.speed }, angle: { min: 200, max: 340 },
      gravityY: l.gravity, rotate: { min: 0, max: 360 }, scale: { start: 1, end: 0.4 }, alpha: { start: 1, end: 0 }, tint: l.tint,
    }).setDepth(1.8);
    e.explode(26);
    s.time.delayedCall(900, () => e.destroy());
    if (terrain === "#") s.cameras.main.shake(160, 0.006);
  }

  /**
   * A move lands: a flash of light on the ground, dust kicked up by area hits, a shake by its power, and the scar
   * its type leaves (heavy and area hits blow out a crater first; fire sets the ground alight before it chars).
   */
  impact(move: MoveDef, at: Pt, radiusUnits: number): void {
    const s = this.scene;
    const color = TYPE_COLORS[move.type] ?? 0xffffff;
    const r = Math.max(0.6, radiusUnits) * this.unit;
    const area = move.shape.kind !== "single";
    this.flash(at, color, r * (area ? 1.8 : 1.5), area ? 500 : 340, area ? 1 : 0.8);
    if (area) {
      const dust = s.add.particles(at.x, at.y, SOFT, {
        emitting: false, lifespan: 900, speed: { min: r * 0.6, max: r * 1.1 }, scale: { start: 0.5, end: 1.3 },
        alpha: { start: 0.35, end: 0 }, tint: this.theme === "cave" ? 0x8a8078 : 0x9a9070,
      }).setDepth(1.7);
      dust.explode(Math.round(10 + r / 6));
      s.time.delayedCall(1000, () => dust.destroy());
    }
    const power = move.power ?? 0;
    if (area || power >= 80) s.cameras.main.shake(area ? 140 + power : 120, Math.min(0.012, 0.002 + power / 12000));
    if (power <= 0) return;
    // Every hit scars the field, more the harder it lands.
    const k = 0.7 + power / 110;
    const size = Math.min(this.unit * 2, (area ? r : this.unit * 0.5) * k);
    // Moves centred on the user (Earthquake, Surf round itself) crack the ground instead of blowing a hole.
    if ((area || power >= 75) && move.range.max > 0 && CRATER_TYPES.has(move.type)) this.crater(at, Math.min(size * 0.6, this.unit * 0.85), power);
    const mark = MARK_OF[move.type];
    if (mark === "scorch" && (area || power >= 50)) this.ignite(at, Math.min(size * 0.8, this.unit * 1.6), 2600 + power * 20);
    else if (mark) this.mark(at, mark, size);
  }

  /** Paints the ground in 2 px cells, ring by ring out from `at` (rough-edged), each ring its own colours and fill. */
  private speckle(g: Phaser.GameObjects.Graphics, at: Pt, r: number, rings: readonly Ring[], rough = 0.22): void {
    const rnd = Math.random;
    const x0 = Math.floor((at.x - r * 1.15) / 2) * 2, y0 = Math.floor((at.y - r * 0.95) / 2) * 2;
    for (let y = y0; y <= at.y + r * 0.95; y += 2) {
      for (let x = x0; x <= at.x + r * 1.15; x += 2) {
        const dx = x + 1 - at.x, dy = (y + 1 - at.y) / 0.8;
        const d = Math.hypot(dx, dy) / r + (rnd() - 0.5) * rough;
        const ring = rings.find((q) => d <= q.to && (!q.upper || dy < 0) && (!q.lower || dy >= 0));
        if (!ring || rnd() > ring.fill) continue;
        g.fillStyle(ring.colors[Math.floor(rnd() * ring.colors.length)]!, ring.alpha).fillRect(x, y, 2, 2);
      }
    }
  }

  /** A stone with its lit top and shadowed foot, `sz` pixels across. */
  private pebble(g: Phaser.GameObjects.Graphics, x: number, y: number, sz: number, base: number): void {
    const p = this.theme === "cave" ? { light: 0xb0a89c, shade: 0x2a2620 } : { light: 0xcfc6b4, shade: 0x2e281e };
    g.fillStyle(p.shade, 0.55).fillRect(x + 1, y + 1, sz, sz);
    g.fillStyle(base, 1).fillRect(x, y, sz, sz);
    g.fillStyle(p.light, 1).fillRect(x, y, sz - 1, 1);
    if (sz > 2) g.fillStyle(p.shade, 0.7).fillRect(x + sz - 1, y + 1, 1, sz - 1);
  }

  /** Dug-up ground and stone colours for this board. */
  private get earth(): Earth {
    return this.theme === "cave"
      ? { rim: [0x857a6e, 0x766c60], lit: [0x625a50, 0x5a5248], shade: [0x302c26, 0x3a352e], floor: [0x48423a, 0x403a33], deep: [0x221e1a], stone: [0x8a8276, 0x7a7266, 0x9a9286] }
      : { rim: [0x8e6e42, 0x7e6038], lit: [0x6e5230, 0x765a34], shade: [0x3a2a16, 0x44321a], floor: [0x553e22, 0x4c3820], deep: [0x2a1e10], stone: [0x8c8478, 0x7c7468, 0x9a9284] };
  }

  /**
   * A blown-out crater, drawn as a bowl lit from above: a pale rim, a shaded upper wall, a lit lower one, earth
   * thrown round it and stones scattered wide (they stay); rubble flies and stays where it lands.
   */
  private crater(at: Pt, r: number, power: number): void {
    const g = this.brush.clear();
    const rnd = Phaser.Math.FloatBetween;
    const e = this.earth;
    this.speckle(g, at, r * 1.7, [
      { to: 0.3, colors: e.deep, alpha: 0.85, fill: 1 },
      { to: 0.42, colors: e.floor, alpha: 0.9, fill: 1 },
      { to: 0.56, colors: e.shade, alpha: 0.9, fill: 1, upper: true },
      { to: 0.56, colors: e.lit, alpha: 0.9, fill: 1, lower: true },
      { to: 0.66, colors: e.rim, alpha: 0.95, fill: 0.95 },
      { to: 1.0, colors: [...e.lit, ...e.rim], alpha: 0.7, fill: 0.28 },
    ], 0.12);
    // Stones and clods thrown out, thinning with distance.
    const n = Math.round(8 + power / 8);
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2), d = r * (1.15 + Math.pow(rnd(0, 1), 1.4) * 1.6);
      const x = Math.round(at.x + Math.cos(a) * d), y = Math.round(at.y + Math.sin(a) * d * 0.8);
      this.pebble(g, x, y, d < r * 1.7 ? Phaser.Math.Between(3, 5) : Phaser.Math.Between(2, 3), e.stone[i % e.stone.length]!);
    }
    this.decals.draw(g, -this.board.x, -this.board.y).render();
    // Rubble in the air: chunks arc out, drop and stay where they land.
    const s = this.scene;
    const chunks = Math.round(5 + power / 14);
    for (let i = 0; i < chunks; i++) {
      const a = rnd(0, Math.PI * 2), d = r * rnd(1.3, 3), sz = Phaser.Math.Between(3, 5), base = e.stone[i % e.stone.length]!;
      const c = s.add.rectangle(at.x, at.y, sz, sz, base).setDepth(2.5);
      const tx = Math.round(at.x + Math.cos(a) * d), ty = Math.round(at.y + Math.sin(a) * d * 0.8), ms = rnd(380, 640);
      const h = rnd(16, 34), spin = rnd(-360, 360);
      s.tweens.addCounter({
        from: 0, to: 1, duration: ms,
        onUpdate: (tw) => {
          const t = tw.getValue() ?? 0;
          c.setPosition(at.x + (tx - at.x) * t, at.y + (ty - at.y) * t - Math.sin(t * Math.PI) * h).setAngle(spin * t);
        },
        onComplete: () => {
          c.destroy();
          if (!this.inBoard(tx, ty)) return;
          const st = this.stamp.clear();
          this.pebble(st, tx, ty, sz, base);
          this.decals.draw(st, -this.board.x, -this.board.y).render();
        },
      });
    }
  }

  private inBoard(x: number, y: number): boolean {
    const b = this.board;
    return x >= b.x && y >= b.y && x < b.x + b.w && y < b.y + b.h;
  }

  /**
   * Fire sets the ground alight: it burns (the GPU ground's flames, or particles without it) and smokes, dies
   * down, and only then is the char left (the char drawn sooner would hide the flames under it); embers glow on.
   */
  private ignite(at: Pt, r: number, ms: number): void {
    const burn: Burn = { x: at.x, y: at.y, r, start: this.scene.time.now, ms };
    this.burns.push(burn);
    const view = this.hazardView({ id: -1, kind: "fire", at, radius: r / this.unit } as unknown as Hazard, at);
    // Tongues of flame over the patch, above any old marks on the ground (which would hide the GPU ground's own
    // flames): they catch one after another and go out unevenly.
    const n = Phaser.Math.Clamp(Math.round(r / 9), 3, 8);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Phaser.Math.FloatBetween(-0.4, 0.4), d = r * (i === 0 ? 0 : Phaser.Math.FloatBetween(0.25, 0.7));
      const spot = { x: Math.round(at.x + Math.cos(a) * d), y: Math.round(at.y + Math.sin(a) * d * 0.8) };
      if (!this.inBoard(spot.x, spot.y)) continue;
      const delay = Phaser.Math.Between(0, 260), life = Math.max(0.6, (ms - delay - Phaser.Math.Between(0, 700)) / 1000);
      this.scene.time.delayedCall(delay, () => void groundFlame(this.scene, spot, Phaser.Math.FloatBetween(0.28, 0.42) * (i === 0 ? 1.2 : 1), life, -0.7 + spot.y / 100000));
    }
    this.scene.time.delayedCall(ms, () => {
      this.burns = this.burns.filter((b) => b !== burn);
      for (const o of view) {
        if (o instanceof Phaser.GameObjects.Particles.ParticleEmitter) {
          o.stop();
          this.scene.time.delayedCall(1800, () => o.destroy());
        } else this.scene.tweens.add({ targets: o, alpha: 0, duration: 500, onComplete: () => o.destroy() });
      }
      this.mark(at, "scorch", r * 1.15);
    });
  }

  /** A puff of dust where a Pokémon goes down. */
  dust(at: Pt): void {
    const e = this.scene.add.particles(at.x, at.y + 6, SOFT, {
      emitting: false, lifespan: 700, speed: { min: 20, max: 45 }, angle: { min: 180, max: 360 },
      scale: { start: 0.4, end: 1 }, alpha: { start: 0.4, end: 0 }, tint: 0xb8b0a0,
    }).setDepth(1.7);
    e.explode(10);
    this.scene.time.delayedCall(800, () => e.destroy());
  }

  /** Paints a lasting mark on the ground; wet splashes and frost dry up after a while. */
  private mark(at: Pt, kind: Mark, r: number): void {
    const g = this.brush.clear();
    const rnd = Phaser.Math.FloatBetween;
    const scatter = (n: number, spread: number, draw: (x: number, y: number, i: number) => void) => {
      for (let i = 0; i < n; i++) {
        const a = rnd(0, Math.PI * 2), d = spread * Math.sqrt(rnd(0, 1));
        draw(Math.round(at.x + Math.cos(a) * d), Math.round(at.y + Math.sin(a) * d * 0.8), i);
      }
    };
    if (kind === "splash" || kind === "frost") {
      // A puddle or rime on top that fades, and the soaked or frozen earth under it a shade darker for good.
      const wet = this.scene.add.graphics().setDepth(-0.85);
      if (kind === "splash") {
        this.speckle(wet, at, r * 0.8, [{ to: 0.7, colors: [0x24506e, 0x2a5c7c], alpha: 0.45, fill: 0.9 }, { to: 1, colors: [0x24506e], alpha: 0.3, fill: 0.4 }]);
        scatter(Math.round(4 + r / 5), r * 0.5, (x, y) => wet.fillStyle(0xbfe8ff, 0.6).fillRect(x, y, 2, 1));
      } else {
        scatter(Math.round(14 + r / 2), r, (x, y, i) => {
          wet.fillStyle(i % 3 ? 0xdff4ff : 0x9cd0f0, 0.75).fillRect(x, y, 2, 2);
          if (i % 4 === 0) wet.fillStyle(0xf4fbff, 0.85).fillRect(x - 2, y, 6, 1).fillRect(x + 1, y - 3, 1, 7);
        });
      }
      this.scene.tweens.add({ targets: wet, alpha: 0.3, delay: 20000, duration: 8000 });
      this.speckle(g, at, r, [{ to: 1, colors: kind === "splash" ? [0x1c3020, 0x203828] : [0x3c5058, 0x46606a], alpha: 0.3, fill: 0.7 }]);
    } else if (kind === "scorch") {
      // Charred at the heart, burnt brown round it, the grass singed yellow at the edge, ash on top.
      this.speckle(g, at, r, [
        { to: 0.32, colors: [0x120c08, 0x1a120a], alpha: 0.92, fill: 1 },
        { to: 0.62, colors: [0x261a0e, 0x2e2012, 0x1e150c], alpha: 0.85, fill: 0.95 },
        { to: 0.86, colors: [0x4a3418, 0x5a4020, 0x3e2c16], alpha: 0.65, fill: 0.8 },
        { to: 1.12, colors: [0x9a8638, 0x8a7832, 0xa89040], alpha: 0.45, fill: 0.45 },
      ]);
      scatter(Math.round(6 + r / 3), r * 0.6, (x, y, i) => g.fillStyle(i % 2 ? 0xa8a296 : 0xc8c2b6, 0.8).fillRect(x, y, 2, 2));
      // Embers smoulder in it for a while.
      scatter(Math.round(4 + r / 6), r * 0.55, (x, y, i) => {
        const e = this.scene.add.rectangle(x, y, 2, 2, i % 2 ? 0xff7a20 : 0xffc040).setDepth(-0.8).setBlendMode(Phaser.BlendModes.ADD);
        this.scene.tweens.add({ targets: e, alpha: { from: 1, to: 0.25 }, duration: rnd(300, 700), yoyo: true, repeat: 10, onComplete: () => e.destroy() });
      });
    } else if (kind === "stain") {
      this.speckle(g, at, r, [
        { to: 0.45, colors: [0x2a1038, 0x34144a], alpha: 0.75, fill: 0.95 },
        { to: 0.8, colors: [0x4a1e64, 0x3a1850], alpha: 0.55, fill: 0.8 },
        { to: 1.05, colors: [0x5a3070], alpha: 0.35, fill: 0.4 },
      ]);
      scatter(Math.round(3 + r / 6), r * 0.6, (x, y) => g.fillStyle(0x9a5ac8, 0.7).fillRect(x, y, 2, 2));
    } else if (kind === "leaves") {
      this.speckle(g, at, r * 0.7, [{ to: 1, colors: [0x2a4a1c], alpha: 0.25, fill: 0.5 }]);
      scatter(Math.round(8 + r / 3), r, (x, y, i) => {
        g.fillStyle(i % 2 ? 0x2f7c28 : 0x5aa83c, 0.95).fillRect(x, y, 3, 2);
        g.fillStyle(0x8ad060, 0.9).fillRect(x, y, 1, 1);
      });
    } else if (kind === "dent") {
      // Grass pressed flat in a ring, as if by a weight from above.
      this.speckle(g, at, r, [
        { to: 0.55, colors: [0x2c5a22], alpha: 0.18, fill: 0.5 },
        { to: 0.85, colors: [0x24481c, 0x1e3e18], alpha: 0.4, fill: 0.85 },
        { to: 1.0, colors: [0x7aa84a], alpha: 0.35, fill: 0.5 },
      ], 0.1);
    } else if (kind === "spark") {
      // A lightning burn: a black core and forked scorch lines branching out.
      this.speckle(g, at, r * 0.45, [{ to: 0.6, colors: [0x0e0c0a], alpha: 0.85, fill: 1 }, { to: 1, colors: [0x2a2418], alpha: 0.55, fill: 0.7 }]);
      const fork = (x: number, y: number, a: number, len: number, depth: number) => {
        let px = x, py = y;
        for (let i = 0; i < len; i += 2) {
          a += rnd(-0.45, 0.45);
          px += Math.cos(a) * 2;
          py += Math.sin(a) * 1.6;
          g.fillStyle(0x16120c, 0.8).fillRect(Math.round(px), Math.round(py), 2, 2);
          if (depth > 0 && rnd(0, 1) < 0.08) fork(px, py, a + rnd(-1, 1), len * 0.45, depth - 1);
        }
      };
      for (let i = 0; i < 6; i++) fork(at.x, at.y, (i / 6) * Math.PI * 2 + rnd(-0.3, 0.3), r * rnd(0.7, 1.1), 1);
    } else {
      // Cracks: a dark pit and jagged splits running out from it, 2 px wide near it and 1 px at the ends.
      this.speckle(g, at, r * 0.35, [{ to: 1, colors: [0x14100a, 0x1c160e], alpha: 0.8, fill: 0.95 }]);
      for (let i = 0; i < 7; i++) {
        let a = (i / 7) * Math.PI * 2 + rnd(-0.3, 0.3);
        let x = at.x, y = at.y;
        const len = rnd(r * 0.6, r * 1.05);
        for (let d = 0; d < len; d += 2) {
          a += rnd(-0.35, 0.35);
          x += Math.cos(a) * 2;
          y += Math.sin(a) * 1.6;
          const w = d < len * 0.55 ? 2 : 1;
          g.fillStyle(0x0e0a06, 0.85).fillRect(Math.round(x), Math.round(y), w, w);
          if (w === 2) g.fillStyle(0x7a6448, 0.5).fillRect(Math.round(x), Math.round(y) + 2, 2, 1);
        }
      }
    }
    // The layer is the board's size, so marks never spill past its edge.
    this.decals.draw(g, -this.board.x, -this.board.y).render();
  }
}
