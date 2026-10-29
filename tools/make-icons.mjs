// Renders the Apple touch icon (from the inline SVG favicon in index.html) and the link-preview image
// (the title screen) into public/. Run after `npm run build:single`: node tools/make-icons.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const svg = decodeURIComponent(readFileSync("index.html", "utf8").match(/rel="icon"[^>]*href="data:image\/svg\+xml,([^"]+)"/)[1]);
const browser = await chromium.launch();
const shot = async (size, path, pad, bg) => {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const inner = Math.round(size * (1 - 2 * pad));
  await page.setContent(`<body style="margin:0;background:${bg};display:grid;place-items:center;height:100vh">${svg.replace("<svg ", `<svg width="${inner}" height="${inner}" `)}</body>`);
  await page.screenshot({ path, omitBackground: bg === "transparent" });
  await page.close();
};
await shot(180, "public/apple-touch-icon.png", 0.1, "#10141c");

const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(pathToFileURL(resolve("dist-single/index.html")).href);
await page.waitForTimeout(4000);
await page.screenshot({ path: "public/og-image.png" });
await browser.close();
console.log("apple-touch-icon and og-image written to public/");
