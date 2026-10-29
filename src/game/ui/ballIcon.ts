import type Phaser from "phaser";

/** Top-half colours of the balls (the bottom is white). */
const BALL_TOPS: Readonly<Record<string, string>> = { "poke-ball": "#e3350d", "great-ball": "#2f6fd6", "ultra-ball": "#2a2a2a" };

/** A small drawn ball (24×24): the aiming cursor and the ball icons. */
export function ballCanvas(ballId: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 24;
  const g = c.getContext("2d")!;
  g.beginPath(); g.arc(12, 12, 10, Math.PI, 0); g.fillStyle = BALL_TOPS[ballId] ?? "#e3350d"; g.fill();
  g.beginPath(); g.arc(12, 12, 10, 0, Math.PI); g.fillStyle = "#f4f4f4"; g.fill();
  g.lineWidth = 2; g.strokeStyle = "#111";
  g.beginPath(); g.arc(12, 12, 10, 0, Math.PI * 2); g.moveTo(2, 12); g.lineTo(22, 12); g.stroke();
  g.beginPath(); g.arc(12, 12, 3.5, 0, Math.PI * 2); g.fillStyle = "#f4f4f4"; g.fill(); g.stroke();
  return c;
}

/** Texture key of a ball's icon, drawn once per game. */
export function ballIcon(scene: Phaser.Scene, ballId: string): string {
  const key = `ball-icon-${ballId}`;
  if (!scene.textures.exists(key)) scene.textures.addCanvas(key, ballCanvas(ballId));
  return key;
}
