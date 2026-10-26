import Phaser from "phaser";
import type { MoveDef } from "../core/battle";
import { TYPE_COLORS } from "./ui/theme";

/**
 * Move effects drawn in code (no image files): a projectile for ranged moves, then an impact
 * styled by the move's type — flames rise, water splashes, lightning zigzags, psychic rings spread…
 */

const DOT = "fx-dot";

type Style = "burst" | "rise" | "fall" | "bolt" | "rings" | "leaves" | "debris" | "wisps" | "slash" | "shards";

const STYLE: Record<string, Style> = {
  fire: "rise", water: "fall", ice: "shards", electric: "bolt", grass: "leaves", bug: "leaves",
  psychic: "rings", fairy: "rings", ghost: "wisps", poison: "wisps", dark: "wisps",
  rock: "debris", ground: "debris", steel: "shards", fighting: "slash", normal: "slash", flying: "slash", dragon: "rings",
};

const ensureDot = (scene: Phaser.Scene) => {
  if (scene.textures.exists(DOT)) return;
  const g = scene.make.graphics({}, false);
  g.fillStyle(0xffffff, 1).fillCircle(4, 4, 4);
  g.generateTexture(DOT, 8, 8);
  g.destroy();
};

const tween = (scene: Phaser.Scene, cfg: Phaser.Types.Tweens.TweenBuilderConfig) =>
  new Promise<void>((resolve) => scene.tweens.add({ ...cfg, onComplete: () => resolve() }));

/** Plays the move's effect from `from` to every hit point; resolves when the impact has landed. */
export async function playMoveFx(
  scene: Phaser.Scene, move: MoveDef, from: { x: number; y: number }, targets: readonly { x: number; y: number }[],
): Promise<void> {
  if (!targets.length) return;
  ensureDot(scene);
  const color = TYPE_COLORS[move.type] ?? 0xffffff;
  const style = STYLE[move.type] ?? "burst";
  const main = targets[0]!;
  const ranged = Math.hypot(main.x - from.x, main.y - from.y) > 48;

  if (ranged && style === "bolt") {
    await bolt(scene, from, main, color);
  } else if (ranged) {
    // A glowing orb with a trail.
    const orb = scene.add.image(from.x, from.y - 10, DOT).setTint(color).setScale(2.2).setDepth(30).setBlendMode(Phaser.BlendModes.ADD);
    const trail = scene.add.particles(0, 0, DOT, {
      follow: orb, lifespan: 260, speed: 10, scale: { start: 1.2, end: 0 }, alpha: { start: 0.8, end: 0 },
      tint: color, blendMode: Phaser.BlendModes.ADD, frequency: 18,
    }).setDepth(29);
    await tween(scene, { targets: orb, x: main.x, y: main.y - 10, duration: Math.min(420, 90 + Math.hypot(main.x - from.x, main.y - from.y) * 1.6), ease: "Sine.easeIn" });
    orb.destroy();
    trail.stop();
    scene.time.delayedCall(300, () => trail.destroy());
  }
  await Promise.all(targets.map((t) => impact(scene, style, t, color)));
}

function bolt(scene: Phaser.Scene, a: { x: number; y: number }, b: { x: number; y: number }, color: number): Promise<void> {
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

function impact(scene: Phaser.Scene, style: Style, at: { x: number; y: number }, color: number): Promise<void> {
  const y = at.y - 8;
  const emit = (cfg: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig, count: number, life = 600) => {
    const e = scene.add.particles(at.x, y, DOT, { emitting: false, blendMode: Phaser.BlendModes.ADD, tint: color, ...cfg }).setDepth(30);
    e.explode(count);
    scene.time.delayedCall(life + 100, () => e.destroy());
  };
  switch (style) {
    case "rise":
      emit({ speedY: { min: -90, max: -40 }, speedX: { min: -30, max: 30 }, scale: { start: 1.6, end: 0 }, lifespan: 550, tint: [color, 0xffd23f, 0xff5a1f] }, 22);
      break;
    case "fall":
      emit({ speed: { min: 60, max: 130 }, angle: { min: 200, max: 340 }, gravityY: 320, scale: { start: 1.1, end: 0.3 }, lifespan: 600, tint: [color, 0xbfe6ff] }, 18);
      break;
    case "shards":
      emit({ speed: { min: 80, max: 160 }, scaleX: { start: 0.5, end: 0 }, scaleY: { start: 1.8, end: 0 }, rotate: { min: 0, max: 360 }, lifespan: 450, tint: [color, 0xffffff] }, 14, 450);
      break;
    case "bolt":
      emit({ speed: { min: 60, max: 140 }, scale: { start: 0.9, end: 0 }, lifespan: 300, tint: [color, 0xffffff] }, 16, 300);
      break;
    case "leaves":
      emit({ speed: { min: 30, max: 90 }, scaleX: { start: 1.4, end: 0.4 }, scaleY: { start: 0.6, end: 0.2 }, rotate: { start: 0, end: 540 }, gravityY: 60, lifespan: 750, blendMode: Phaser.BlendModes.NORMAL }, 14, 750);
      break;
    case "debris":
      emit({ speed: { min: 50, max: 120 }, angle: { min: 200, max: 340 }, gravityY: 400, scale: { start: 1.4, end: 0.8 }, lifespan: 600, blendMode: Phaser.BlendModes.NORMAL, tint: [color, 0x6b5233] }, 16);
      break;
    case "wisps":
      emit({ speedY: { min: -50, max: -15 }, speedX: { min: -20, max: 20 }, scale: { start: 0.6, end: 2.2 }, alpha: { start: 0.7, end: 0 }, lifespan: 800 }, 10, 800);
      break;
    case "rings": {
      const rings = [0, 120, 240].map((d) => {
        const r = scene.add.circle(at.x, y, 6).setStrokeStyle(3, color).setDepth(30).setAlpha(0);
        return tween(scene, { targets: r, scale: 4, alpha: { from: 1, to: 0 }, delay: d, duration: 420 }).then(() => r.destroy());
      });
      return Promise.all(rings).then(() => undefined);
    }
    case "slash": {
      const g = scene.add.graphics().setDepth(30);
      g.lineStyle(4, 0xffffff, 1).beginPath().arc(at.x, y, 16, Phaser.Math.DegToRad(200), Phaser.Math.DegToRad(340)).strokePath();
      g.lineStyle(2, color, 1).beginPath().arc(at.x, y, 20, Phaser.Math.DegToRad(210), Phaser.Math.DegToRad(330)).strokePath();
      emit({ speed: { min: 40, max: 90 }, scale: { start: 0.8, end: 0 }, lifespan: 300, tint: [0xffffff, color] }, 8, 300);
      return tween(scene, { targets: g, alpha: 0, duration: 260, delay: 80 }).then(() => g.destroy());
    }
    default:
      emit({ speed: { min: 50, max: 120 }, scale: { start: 1, end: 0 }, lifespan: 400 }, 14, 400);
  }
  return new Promise((r) => scene.time.delayedCall(220, r));
}
