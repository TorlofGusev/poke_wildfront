// Mobile look-through: screenshots of the main screens on an emulated phone (landscape, touch).
// Run after `npm run build:single`: node e2e/mobile-shots.mjs <outDir> [width] [height]
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";

const out = process.argv[2] ?? "shots";
const W = Number(process.argv[3] ?? 780);
const H = Number(process.argv[4] ?? 360);
mkdirSync(out, { recursive: true });
const url = pathToFileURL(resolve("dist-single/index.html")).href;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

// Game coordinates (960×540, FIT and centred) → screen.
const k = Math.min(W / 960, H / 540);
const ox = (W - 960 * k) / 2;
const oy = (H - 540 * k) / 2;
const tap = async (x, y, wait = 500) => {
  await page.touchscreen.tap(ox + x * k, oy + y * k);
  await page.waitForTimeout(wait);
};
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
const save = () => page.evaluate(() => JSON.parse(localStorage.getItem("pokemon-wildfront.save") ?? "null"));

try {
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector("canvas"));
  await page.waitForTimeout(1000);
  await shot("01-title");
  await tap(480, 276, 700);
  await shot("02-starter");
  await tap(480, 476, 900);
  await shot("03-overworld");
  const s = await save();
  const target = s.game.world.encounters[0].pos;
  const tx = 16 + target.x * 28 + 14, ty = 60 + target.y * 28 + 14;
  // Touch drag from the player towards a tile next to the start: the path follows the finger, lifting goes.
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: ox + x * k, y: oy + y * k }] });
  const from = s.game.world.pos;
  const fx = 16 + from.x * 28 + 14, fy = 60 + from.y * 28 + 14;
  await touch("touchStart", fx, fy);
  for (let i = 1; i <= 3; i++) {
    await touch("touchMove", fx + i * 28, fy);
    await page.waitForTimeout(80);
  }
  await shot("03b-overworld-dragging");
  await touch("touchEnd", 0, 0);
  await page.waitForTimeout(1500);
  const moved = (await save()).game.world.pos;
  console.log(`drag: ${JSON.stringify(from)} → ${JSON.stringify(moved)}`);
  await tap(tx, ty, 400);
  await shot("04-overworld-armed");
  // Time from the confirming tap to the battle scene.
  const t0 = Date.now();
  await tap(tx, ty, 4500);
  await shot("05-deploy");
  for (const [x, y] of [[1, 2], [1, 4], [1, 5]]) await tap(12 + 19.4 + x * 38.8 + (y & 1 ? 19.4 : 0), 72 + 22.4 + y * 33.6, 150);
  await shot("06-deploy-placed");
  await tap(808, 230, 3000);
  await shot("07-battle");
  // Tap a reachable tile once (armed), screenshot, and measure a second tap's response.
  await tap(12 + 19.4 + 3 * 38.8, 72 + 22.4 + 2 * 33.6, 400);
  await shot("08-battle-armed");
  const lag = await page.evaluate(async () => {
    const a = performance.now();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return performance.now() - a;
  });
  console.log(`frame ${lag.toFixed(1)}ms, travel→battle ~${Date.now() - t0}ms`);
  if (errors.length) console.log("errors:", errors.join("; "));
} finally {
  await browser.close();
}
