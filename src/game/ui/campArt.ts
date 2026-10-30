import Phaser from "phaser";

/** A stable pseudo-random 0–1 from a few integers (the same picture every time). */
const rand = (a: number, b: number): number => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** Where the fire pit sits in a camp backdrop of this size. */
export const firePit = (w: number, h: number): { x: number; y: number } => ({ x: Math.round(w / 2), y: Math.round(h * 0.68) });

/**
 * The camp at dusk, drawn in code for the camp screen (baked once into a texture): a violet sky with stars, a row of
 * dark pines on the horizon, a meadow, a tent at the back and a ring of stones with crossed logs where the fire burns.
 */
export function drawCampBackdrop(g: Phaser.GameObjects.Graphics, w: number, h: number): void {
  const horizon = Math.round(h * 0.42);
  g.fillGradientStyle(0x141432, 0x141432, 0x4a2c4a, 0x4a2c4a, 1).fillRect(0, 0, w, horizon + 2);
  for (let i = 0; i < 40; i++) {
    const sx = Math.floor(rand(i, 1) * w), sy = Math.floor(rand(i, 2) * horizon * 0.8);
    g.fillStyle(0xffffff, 0.25 + rand(i, 3) * 0.6).fillRect(sx, sy, rand(i, 4) < 0.15 ? 2 : 1, 1);
  }
  // A thin moon.
  g.fillStyle(0xf4ecd0, 0.9).fillCircle(w * 0.82, h * 0.14, 9);
  g.fillStyle(0x1a1838, 1).fillCircle(w * 0.82 + 4, h * 0.14 - 2, 8);
  // Pines on the horizon, far ones lighter.
  for (const [shade, base, size] of [[0x241e3a, horizon + 4, 0.7], [0x141a24, horizon + 10, 1]] as const) {
    for (let x = -10, i = 0; x < w + 10; i++) {
      const tw = (16 + rand(i, size * 10) * 14) * size, th = (26 + rand(i, size * 20) * 26) * size;
      g.fillStyle(shade, 1).fillTriangle(x, base, x + tw / 2, base - th, x + tw, base);
      x += tw * 0.7;
    }
  }
  // The meadow, a little lighter where the fire lights it.
  g.fillStyle(0x1a2a20, 1).fillRect(0, horizon + 8, w, h - horizon - 8);
  const pit = firePit(w, h);
  g.fillStyle(0x24382a, 1).fillEllipse(pit.x, pit.y, w * 0.8, h * 0.42);
  g.fillStyle(0x2c4430, 1).fillEllipse(pit.x, pit.y, w * 0.5, h * 0.26);
  for (let i = 0; i < 60; i++) {
    const gx = Math.floor(rand(i, 7) * w), gy = horizon + 12 + Math.floor(rand(i, 8) * (h - horizon - 14));
    g.fillStyle(0x3c5a38, 0.8).fillRect(gx, gy, 1, 2).fillRect(gx + 2, gy + 1, 1, 2);
  }
  // A tent at the back left: canvas, a shaded side and the dark opening.
  const tx = Math.max(40, w * 0.11), ty = horizon + 30;
  g.fillStyle(0x000000, 0.3).fillEllipse(tx + 4, ty + 2, 74, 10);
  g.fillStyle(0xd8c49a, 1).fillTriangle(tx - 34, ty, tx, ty - 44, tx + 34, ty);
  g.fillStyle(0xa8936a, 1).fillTriangle(tx, ty - 44, tx + 34, ty, tx + 12, ty);
  g.fillStyle(0x2a2018, 1).fillTriangle(tx - 9, ty, tx, ty - 22, tx + 9, ty);
  g.lineStyle(1, 0x5a4630, 1).lineBetween(tx, ty - 44, tx, ty - 50);
  // The pit: crossed logs inside a ring of stones.
  g.lineStyle(5, 0x4a2e1a, 1).lineBetween(pit.x - 14, pit.y + 4, pit.x + 12, pit.y - 3).lineBetween(pit.x - 12, pit.y - 3, pit.x + 14, pit.y + 4);
  g.lineStyle(2, 0x6a4428, 1).lineBetween(pit.x - 13, pit.y + 2, pit.x + 11, pit.y - 4);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const sx = pit.x + Math.cos(a) * 20, sy = pit.y + 2 + Math.sin(a) * 8;
    g.fillStyle(0x4a4a56, 1).fillEllipse(sx, sy, 8, 5);
    g.fillStyle(0x6e6e7c, 1).fillEllipse(sx - 1, sy - 1, 5, 3);
  }
}
