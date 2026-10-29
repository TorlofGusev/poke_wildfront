import Phaser from "phaser";
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
type Mark = "scorch" | "crack" | "splash" | "frost" | "leaves" | "stain" | "spark";
const MARK_OF: Readonly<Record<string, Mark>> = {
  fire: "scorch", ground: "crack", rock: "crack", fighting: "crack", steel: "crack", dragon: "crack",
  water: "splash", ice: "frost", grass: "leaves", bug: "leaves", poison: "stain", ghost: "stain", dark: "stain",
  electric: "spark", psychic: "spark", fairy: "spark",
};

/** What drifts over the field while it is calm, per board theme. */
const MOTES: Readonly<Record<BoardTheme, { color: number; dy: number; alpha: number }>> = {
  field: { color: 0xfff3a0, dy: -6, alpha: 0.55 },
  cave: { color: 0xc8b8a8, dy: 7, alpha: 0.35 },
  shore: { color: 0xe8f6ff, dy: -4, alpha: 0.5 },
  indoor: { color: 0xd8dce8, dy: 2, alpha: 0.3 },
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
  private readonly hazardViews = new Map<number, { objs: Phaser.GameObjects.GameObject[]; hazard: Hazard; center: Pt }>();
  private waterFx: Phaser.GameObjects.GameObject[] = [];
  /** Short bursts of light from attacks, fading out. */
  private flashes: { light: GroundLight; start: number; ms: number }[] = [];
  /** Where the ground lights come from each frame (the GPU ground, when there is one). */
  onLights: ((lights: GroundLight[], pools: GroundPool[]) => void) | null = null;

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
    for (const f of this.flashes) out.push({ ...f.light, intensity: f.light.intensity * (1 - (now - f.start) / f.ms) });
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
   * A move that hits an area (or hits hard) lands: a shockwave over it, a flash of its colour, dust at the
   * edge, a shake by its power, and the mark its type leaves on the ground.
   */
  impact(move: MoveDef, at: Pt, radiusUnits: number): void {
    const s = this.scene;
    const color = TYPE_COLORS[move.type] ?? 0xffffff;
    const r = Math.max(0.6, radiusUnits) * this.unit;
    const area = move.shape.kind !== "single";
    this.flash(at, color, r * (area ? 2.6 : 2), area ? 600 : 380, area ? 1.4 : 1);
    if (area) {
      const flash = s.add.circle(at.x, at.y, r, color, 0.45).setDepth(1.75).setBlendMode(Phaser.BlendModes.ADD);
      s.tweens.add({ targets: flash, alpha: 0, duration: 420, onComplete: () => flash.destroy() });
      for (const [delay, width] of [[0, 4], [110, 2]] as const) {
        const wave = s.add.circle(at.x, at.y, r, 0xffffff, 0).setStrokeStyle(width, color, 0.95).setDepth(1.8).setScale(0.15);
        s.tweens.add({ targets: wave, scale: 1.05, alpha: 0, delay, duration: 520, ease: "Cubic.easeOut", onComplete: () => wave.destroy() });
      }
      const dust = s.add.particles(at.x, at.y, SOFT, {
        emitting: false, lifespan: 900, speed: { min: r * 0.6, max: r * 1.1 }, scale: { start: 0.5, end: 1.3 },
        alpha: { start: 0.35, end: 0 }, tint: this.theme === "cave" ? 0x8a8078 : 0x9a9070,
      }).setDepth(1.7);
      dust.explode(Math.round(10 + r / 6));
      s.time.delayedCall(1000, () => dust.destroy());
    }
    const power = move.power ?? 0;
    if (area || power >= 80) s.cameras.main.shake(area ? 140 + power : 120, Math.min(0.012, 0.002 + power / 12000));
    const mark = MARK_OF[move.type];
    if (mark && power > 0 && (area || power >= 60)) this.mark(at, mark, area ? r : this.unit * 0.45);
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
    const blob = (color: number, alpha: number, rr: number, n = 7) => {
      for (let i = 0; i < n; i++) {
        const a = rnd(0, Math.PI * 2);
        const d = rnd(0, rr * 0.55);
        g.fillStyle(color, alpha).fillCircle(at.x + Math.cos(a) * d, at.y + Math.sin(a) * d * 0.8, rnd(rr * 0.25, rr * 0.5));
      }
    };
    if (kind === "splash" || kind === "frost") {
      // Fades away on its own: drawn as a separate shape, not into the lasting layer.
      const wet = this.scene.add.graphics().setDepth(-0.85);
      const color = kind === "splash" ? 0x1a3a5a : 0xcfefff;
      for (let i = 0; i < 6; i++) {
        const a = rnd(0, Math.PI * 2);
        const d = rnd(0, r * 0.5);
        wet.fillStyle(color, kind === "splash" ? 0.35 : 0.16).fillCircle(at.x + Math.cos(a) * d, at.y + Math.sin(a) * d * 0.8, rnd(r * 0.25, r * 0.45));
      }
      if (kind === "frost") for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        wet.lineStyle(1.5, 0xe8f8ff, 0.35).lineBetween(at.x, at.y, at.x + Math.cos(a) * r * 0.8, at.y + Math.sin(a) * r * 0.65);
      }
      this.scene.tweens.add({ targets: wet, alpha: 0, delay: 9000, duration: 4000, onComplete: () => wet.destroy() });
      return;
    }
    if (kind === "scorch") {
      // Burnt earth, not a hole: warm dark brown, soft.
      blob(0x3a2616, 0.3, r, 9);
      blob(0x24180e, 0.22, r * 0.6, 5);
    } else if (kind === "stain") {
      blob(0x3a1a50, 0.25, r, 8);
    } else if (kind === "leaves") {
      for (let i = 0; i < 9; i++) {
        const a = rnd(0, Math.PI * 2);
        const d = rnd(0, r * 0.8);
        const x = at.x + Math.cos(a) * d, y = at.y + Math.sin(a) * d * 0.8;
        g.fillStyle(i % 2 ? 0x3f9c35 : 0x6ab84a, 0.75).fillEllipse(x, y, 6, 3);
      }
    } else if (kind === "spark") {
      blob(0x0a0a0a, 0.2, r * 0.7, 4);
      for (let i = 0; i < 5; i++) {
        const a = rnd(0, Math.PI * 2);
        g.lineStyle(1.5, 0x101010, 0.45).lineBetween(at.x, at.y, at.x + Math.cos(a) * r * 0.9, at.y + Math.sin(a) * r * 0.7);
      }
    } else {
      // Cracks: jagged lines out from the centre, darker near it.
      blob(0x000000, 0.18, r * 0.5, 4);
      for (let i = 0; i < 7; i++) {
        let a = rnd(0, Math.PI * 2);
        let x = at.x, y = at.y;
        const len = rnd(r * 0.5, r);
        for (let step = 0; step < 4; step++) {
          a += rnd(-0.5, 0.5);
          const nx = x + Math.cos(a) * len / 4, ny = y + Math.sin(a) * len / 4 * 0.8;
          g.lineStyle(2 - step * 0.4, 0x0a0806, 0.6).lineBetween(x, y, nx, ny);
          x = nx;
          y = ny;
        }
      }
    }
    // The layer is the board's size, so marks never spill past its edge.
    this.decals.draw(g, -this.board.x, -this.board.y).render();
  }
}
