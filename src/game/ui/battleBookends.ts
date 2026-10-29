import Phaser from "phaser";
import { pixText, setPixText } from "./pixelFont";

/**
 * The battle's bookends, drawn in code: the handhelds' flash-and-wipe out of the map, the message box,
 * the versus bands of a trainer battle, the round sweep and the badge emblems.
 */

/** Three quick flashes, then the screen closes: bars from both sides for wild Pokémon, a pinwheel for trainers. */
export function battleWipe(scene: Phaser.Scene, trainer: boolean, done: () => void): void {
  // Nothing else on the map reacts while the battle comes in.
  scene.input.enabled = false;
  if (scene.input.keyboard) scene.input.keyboard.enabled = false;
  // The scene's input outlives a restart: it is switched back on as the map closes.
  scene.events.once("shutdown", () => {
    scene.input.enabled = true;
    if (scene.input.keyboard) scene.input.keyboard.enabled = true;
  });
  const { width: w, height: h } = scene.scale;
  const cam = scene.cameras.main;
  for (let i = 0; i < 3; i++) scene.time.delayedCall(i * 170, () => cam.flash(90, 255, 255, 255, true));
  const g = scene.add.graphics().setScrollFactor(0).setDepth(10_000);
  const p = { v: 0 };
  scene.tweens.add({
    targets: p, v: 1, delay: 520, duration: trainer ? 620 : 520, ease: "Quad.easeIn",
    onUpdate: () => {
      g.clear().fillStyle(0x000000, 1);
      if (trainer) {
        // Four wedges sweep round the centre.
        const r = Math.hypot(w, h);
        for (let k = 0; k < 4; k++) {
          const a = -Math.PI / 2 + (k * Math.PI) / 2;
          // A hair wider than a quarter, so no seam shows between the wedges.
          g.slice(w / 2, h / 2, r, a - 0.02, a + (Math.PI / 2 + 0.04) * p.v, false).fillPath();
        }
      } else {
        // Eight bars, every other one from the other side.
        const bh = Math.ceil(h / 8);
        for (let k = 0; k < 8; k++) {
          const bw = w * p.v;
          g.fillRect(k % 2 ? w - bw : 0, k * bh, bw, bh);
        }
      }
    },
    onComplete: () => scene.time.delayedCall(120, done),
  });
}

/** The message box's frame (DS style): a dark outer edge, a white rim, a navy field with a faint inner line. */
export function messageFrame(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number): Phaser.GameObjects.Graphics {
  g.fillStyle(0x10141c, 1).fillRoundedRect(x, y, w, h, 7);
  g.fillStyle(0xf0f0f0, 1).fillRoundedRect(x + 2, y + 2, w - 4, h - 4, 6);
  g.fillStyle(0x24345e, 1).fillRoundedRect(x + 4, y + 4, w - 8, h - 8, 5);
  g.lineStyle(1, 0x4a6098, 1).strokeRoundedRect(x + 7, y + 7, w - 14, h - 14, 3);
  return g;
}

/** A message box over the field; the text types itself out. */
export function messageBox(scene: Phaser.Scene, x: number, y: number, w: number, text: string): { box: Phaser.GameObjects.Container; typed: Promise<void> } {
  const h = 44;
  const g = messageFrame(scene.add.graphics(), 0, 0, w, h);
  const label = pixText(scene, 16, h / 2, "").setOrigin(0, 0.5);
  const box = scene.add.container(x, y, [g, label]).setDepth(60);
  box.setAlpha(0);
  scene.tweens.add({ targets: box, alpha: 1, duration: 120 });
  const typed = new Promise<void>((resolve) => {
    let n = 0;
    const step = () => {
      if (!label.active) return resolve();
      setPixText(label, text.slice(0, ++n));
      if (n >= text.length) resolve();
      else scene.time.delayedCall(22, step);
    };
    step();
  });
  return { box, typed };
}

export interface VersusSide {
  readonly name: string;
  /** Texture of the trainer figure (pixel art, drawn small: scaled up here). */
  readonly figure: string;
  /** Poké Balls under the name: one per Pokémon, dimmed for those that cannot fight. */
  readonly balls: readonly boolean[];
  readonly color: number;
}

/**
 * A trainer battle's opening: the player's band from the left, the foe's from the right, meeting under a big VS.
 * Resolves once both bands have left again.
 */
export function versusBands(scene: Phaser.Scene, area: { x: number; y: number; w: number; h: number }, you: VersusSide, foe: VersusSide, gold: boolean): Promise<void> {
  const cy = area.y + area.h / 2;
  const bandH = 92, skew = 26;
  const parts: Phaser.GameObjects.GameObject[] = [];
  const streaks: Phaser.GameObjects.Rectangle[] = [];
  const dim = scene.add.rectangle(area.x, area.y, area.w, area.h, 0x000000, 0).setOrigin(0).setDepth(55);
  parts.push(dim);
  scene.tweens.add({ targets: dim, fillAlpha: 0.88, duration: 200 });
  const band = (side: VersusSide, left: boolean, row: number) => {
    const bw = area.w * 0.62;
    const top = cy - bandH + row * bandH - (left ? 6 : -6);
    const g = scene.add.graphics();
    const pts = left
      ? [0, 0, bw, 0, bw - skew, bandH, 0, bandH]
      : [skew, 0, bw, 0, bw, bandH, 0, bandH];
    const poly = (inset: number, color: number, alpha = 1) => {
      g.fillStyle(color, alpha).beginPath();
      g.moveTo(pts[0]! + (left ? 0 : inset), pts[1]! + inset);
      g.lineTo(pts[2]! - (left ? inset : 0), pts[3]! + inset);
      g.lineTo(pts[4]! - (left ? inset : 0), pts[5]! - inset);
      g.lineTo(pts[6]! + (left ? 0 : inset), pts[7]! - inset);
      g.closePath().fillPath();
    };
    poly(0, gold ? 0xf5d76e : 0xf0f0f0);
    poly(3, side.color);
    // A lighter stripe through the band, as on the handhelds' intro panels.
    g.fillStyle(0xffffff, 0.12).fillRect(left ? 0 : skew, bandH * 0.32, bw - skew, bandH * 0.18);
    const fig = scene.add.image(left ? 46 : bw - 46, bandH - 4, side.figure).setOrigin(0.5, 1).setScale(4);
    if (!left) fig.setFlipX(true);
    const name = pixText(scene, left ? 96 : bw - 96, 16, side.name).setOrigin(left ? 0 : 1, 0);
    const balls = side.balls.map((ok, i) => {
      const bx = left ? 104 + i * 18 : bw - 104 - i * 18;
      const b = scene.add.graphics({ x: bx, y: 62 });
      b.fillStyle(0x10141c, 1).fillCircle(0, 0, 7);
      b.fillStyle(ok ? 0xe83838 : 0x6a6a6a, 1).slice(0, 0, 6, Math.PI, 0, false).fillPath();
      b.fillStyle(ok ? 0xf8f8f8 : 0x9a9a9a, 1).slice(0, 0, 6, 0, Math.PI, false).fillPath();
      b.fillStyle(0x10141c, 1).fillRect(-6, -1, 12, 2).fillCircle(0, 0, 2.5);
      b.fillStyle(0xf8f8f8, 1).fillCircle(0, 0, 1.4);
      return b;
    });
    // Speed lines streaking through the band.
    const lines = Array.from({ length: 6 }, (_, i) => {
      const len = 40 + ((i * 37) % 60);
      const ln = scene.add.rectangle(0, 10 + ((i * 29) % (bandH - 20)), len, 2, 0xffffff, 0.25).setOrigin(0, 0.5);
      scene.tweens.add({ targets: ln, x: { from: left ? -len : bw, to: left ? bw : -len }, duration: 500 + i * 70, repeat: -1, delay: i * 90 });
      streaks.push(ln);
      return ln;
    });
    balls.forEach((b, i) => {
      b.setScale(0);
      scene.tweens.add({ targets: b, scale: 1, delay: 380 + i * 90, duration: 160, ease: "Back.easeOut" });
    });
    const c = scene.add.container(left ? area.x - bw : area.x + area.w, top, [g, ...lines, fig, name, ...balls]).setDepth(56);
    parts.push(c);
    return { c, home: left ? area.x : area.x + area.w - bw, away: left ? area.x - bw : area.x + area.w };
  };
  const a = band(you, true, 0), b = band(foe, false, 1);
  const vs = pixText(scene, area.x + area.w / 2, cy, "VS", 0xf5d76e, 6).setOrigin(0.5).setDepth(57).setScale(3).setAlpha(0);
  parts.push(vs);
  const tw = (cfg: Phaser.Types.Tweens.TweenBuilderConfig) => new Promise<void>((r) => scene.tweens.add({ ...cfg, onComplete: () => r() }));
  return (async () => {
    await Promise.all([
      tw({ targets: a.c, x: a.home, duration: 300, ease: "Cubic.easeOut" }),
      tw({ targets: b.c, x: b.home, duration: 300, ease: "Cubic.easeOut" }),
    ]);
    scene.cameras.main.shake(140, 0.006);
    const flash = scene.add.rectangle(area.x, area.y, area.w, area.h, 0xffffff, 0.7).setOrigin(0).setDepth(58);
    scene.tweens.add({ targets: flash, alpha: 0, duration: 260, onComplete: () => flash.destroy() });
    await tw({ targets: vs, scale: 1, alpha: 1, duration: 220, ease: "Back.easeOut" });
    scene.cameras.main.shake(180, 0.01);
    // The bands keep creeping inwards while the VS hangs there.
    scene.tweens.add({ targets: a.c, x: a.home + 10, duration: 1100 });
    scene.tweens.add({ targets: b.c, x: b.home - 10, duration: 1100 });
    await new Promise((r) => scene.time.delayedCall(1100, r));
    await Promise.all([
      tw({ targets: a.c, x: a.away, duration: 240, ease: "Cubic.easeIn" }),
      tw({ targets: b.c, x: b.away, duration: 240, ease: "Cubic.easeIn" }),
      tw({ targets: [vs, dim], alpha: 0, duration: 240 }),
    ]);
    scene.tweens.killTweensOf(streaks);
    parts.forEach((o) => o.destroy());
  })();
}

/** A new round: a slanted dark band with gold edges sweeps across the field, the round's number riding on it. */
export function roundSweep(scene: Phaser.Scene, area: { x: number; y: number; w: number; h: number }, label: string): Promise<void> {
  const bandH = 50, skew = 40, cy = area.y + area.h * 0.42;
  const g = scene.add.graphics().setDepth(30);
  const text = pixText(scene, area.x + area.w / 2, cy, label.toUpperCase(), 0xf5d76e, 3).setOrigin(0.5).setLetterSpacing(3).setDepth(31).setAlpha(0);
  // Redrawn each frame between a left and a right edge, clipped to the board (a geometry mask would not clip).
  const clip = (x: number) => Phaser.Math.Clamp(x, area.x, area.x + area.w);
  const draw = (l: number, r: number) => {
    g.clear();
    const quad = (y0: number, y1: number, color: number, alpha: number) => {
      // The edges slant: a point lower down sits further left.
      const at = (x: number, y: number) => ({ x: clip(x - ((y + bandH / 2 + 4) / (bandH + 8)) * skew), y: cy + y });
      g.fillStyle(color, alpha).fillPoints([at(l + skew, y0), at(r + skew, y0), at(r + skew, y1), at(l + skew, y1)] as Phaser.Math.Vector2[], true);
    };
    quad(-bandH / 2 - 4, -bandH / 2, 0xf5d76e, 1);
    quad(-bandH / 2, bandH / 2, 0x10141c, 0.88);
    quad(bandH / 2, bandH / 2 + 4, 0xf5d76e, 1);
  };
  const p = { l: area.x - skew, r: area.x - skew };
  const full = area.x + area.w + skew;
  const tw = (cfg: Phaser.Types.Tweens.TweenBuilderConfig) => new Promise<void>((res) => scene.tweens.add({ ...cfg, onComplete: () => res() }));
  const step = (to: Partial<typeof p>, duration: number, ease: string) => tw({ targets: p, ...to, duration, ease, onUpdate: () => draw(p.l, p.r) });
  text.x -= 40;
  scene.tweens.add({ targets: text, x: text.x + 40, alpha: 1, delay: 120, duration: 220, ease: "Cubic.easeOut" });
  return step({ r: full }, 230, "Cubic.easeOut")
    .then(() => tw({ targets: text, x: text.x + 12, duration: 520 }))
    .then(() => {
      scene.tweens.add({ targets: text, x: text.x + 50, alpha: 0, duration: 200, ease: "Cubic.easeIn" });
      return step({ l: full }, 230, "Cubic.easeIn");
    })
    .then(() => {
      g.destroy();
      text.destroy();
    });
}

/** The eight badges as emblems: shape and colours, drawn round (0, 0) at about `r` radius. */
export function drawBadge(g: Phaser.GameObjects.Graphics, badge: string, r: number): void {
  const OUT = 0x10141c;
  const poly = (pts: readonly { x: number; y: number }[], color: number, line = 2) => {
    g.fillStyle(color, 1).fillPoints(pts as Phaser.Math.Vector2[], true);
    g.lineStyle(line, OUT, 1).strokePoints(pts as Phaser.Math.Vector2[], true);
  };
  const ring = (n: number, rad: (i: number) => number, rot = -Math.PI / 2) =>
    Array.from({ length: n }, (_, i) => ({ x: Math.cos(rot + (i / n) * Math.PI * 2) * rad(i), y: Math.sin(rot + (i / n) * Math.PI * 2) * rad(i) }));
  const shine = (x: number, y: number, s: number) => g.fillStyle(0xffffff, 0.75).fillEllipse(x, y, s, s * 0.6);
  switch (badge) {
    case "boulder":
      poly(ring(8, () => r, -Math.PI / 8), 0xa0a0b0);
      poly(ring(8, () => r * 0.55, -Math.PI / 8), 0xc8c8d4, 1);
      shine(-r * 0.3, -r * 0.4, r * 0.5);
      break;
    case "cascade": {
      const pts = Array.from({ length: 24 }, (_, i) => {
        const a = (i / 24) * Math.PI * 2;
        const k = Math.pow(Math.sin(a / 2), 1.6);
        return { x: Math.sin(a) * r * 0.8 * k, y: r - (1 - Math.cos(a)) * r };
      });
      poly(pts.map((p) => ({ x: p.x, y: -p.y })), 0x58a8f0);
      shine(-r * 0.2, r * 0.2, r * 0.45);
      break;
    }
    case "thunder":
      poly(ring(16, (i) => (i % 2 ? r * 0.62 : r)), 0xf0a030);
      g.fillStyle(0xf8e070, 1).fillCircle(0, 0, r * 0.38);
      g.lineStyle(1.5, OUT, 1).strokeCircle(0, 0, r * 0.38);
      break;
    case "rainbow": {
      const petals = [0xe85050, 0xf0a030, 0xf0e050, 0x58c058, 0x5090e8, 0xa060d0];
      petals.forEach((c, i) => {
        const a = -Math.PI / 2 + (i / 6) * Math.PI * 2;
        g.fillStyle(c, 1).fillCircle(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55, r * 0.42);
        g.lineStyle(1.5, OUT, 1).strokeCircle(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55, r * 0.42);
      });
      g.fillStyle(0xf8f0d0, 1).fillCircle(0, 0, r * 0.3);
      g.lineStyle(1.5, OUT, 1).strokeCircle(0, 0, r * 0.3);
      break;
    }
    case "soul": {
      const pts = Array.from({ length: 40 }, (_, i) => {
        const tt = (i / 40) * Math.PI * 2;
        return { x: (16 * Math.pow(Math.sin(tt), 3)) * r / 17, y: -(13 * Math.cos(tt) - 5 * Math.cos(2 * tt) - 2 * Math.cos(3 * tt) - Math.cos(4 * tt)) * r / 17 };
      });
      poly(pts, 0xf080b0);
      shine(-r * 0.4, -r * 0.35, r * 0.4);
      break;
    }
    case "marsh":
      g.fillStyle(0xe8c040, 1).fillCircle(0, 0, r);
      g.lineStyle(2, OUT, 1).strokeCircle(0, 0, r);
      g.fillStyle(0xb08820, 1).fillCircle(0, 0, r * 0.62);
      g.lineStyle(1.5, OUT, 1).strokeCircle(0, 0, r * 0.62);
      g.fillStyle(0xf8e070, 1).fillCircle(0, 0, r * 0.3);
      shine(-r * 0.45, -r * 0.45, r * 0.4);
      break;
    case "volcano": {
      const pts = Array.from({ length: 30 }, (_, i) => {
        const a = (i / 30) * Math.PI * 2;
        const flick = 1 + 0.28 * Math.max(0, Math.sin(a * 3 - Math.PI / 2)) * (Math.cos(a) < 0 ? 1.6 : 0.6);
        return { x: Math.sin(a) * r * 0.75, y: -Math.cos(a) * r * flick * 0.85 + r * 0.15 };
      });
      poly(pts, 0xe84830);
      g.fillStyle(0xf8c040, 1).fillEllipse(0, r * 0.25, r * 0.7, r * 0.9);
      break;
    }
    case "earth": {
      const pts = Array.from({ length: 30 }, (_, i) => {
        const a = (i / 30) * Math.PI * 2;
        return { x: Math.sin(a) * r * 0.6 * Math.abs(Math.sin(a / 2) + 0.2), y: -Math.cos(a) * r };
      });
      poly(pts, 0x48b060);
      g.lineStyle(1.5, 0x2a6a38, 1).lineBetween(0, -r * 0.8, 0, r * 0.9);
      break;
    }
    default:
      g.fillStyle(0xf5d76e, 1).fillCircle(0, 0, r);
      g.lineStyle(2, OUT, 1).strokeCircle(0, 0, r);
  }
}
