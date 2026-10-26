// Browser smoke test of the production build: title → new game → overworld → battle deployment.
// Run after `npm run build:single`. Fails on any page error.
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const url = pathToFileURL(resolve("dist-single/index.html")).href;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const step = async (name, fn) => {
  await fn();
  if (errors.length) throw new Error(`${name}: ${errors.join("; ")}`);
  console.log(`ok - ${name}`);
};
const save = () => page.evaluate(() => JSON.parse(localStorage.getItem("pokemon-wildfront.save") ?? "null"));

try {
  await step("title screen loads", async () => {
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector("canvas"));
    await page.waitForTimeout(800);
  });
  await step("new game shows the starter choice; the playtest team creates a save", async () => {
    await page.mouse.click(480, 276);
    await page.waitForTimeout(600);
    if (await save()) throw new Error("a save was created before choosing a starter");
    await page.mouse.click(480, 476);
    await page.waitForTimeout(600);
    const s = await save();
    if (!s || s.game.roster.party.length !== 6) throw new Error("no save with the 6-Pokémon playtest team");
  });
  await step("walking into a wild group opens deployment", async () => {
    const s = await save();
    const target = s.game.world.encounters[0].pos;
    await page.mouse.click(16 + target.x * 28 + 14, 60 + target.y * 28 + 14);
    await page.waitForTimeout(4000);
    const after = await save();
    if (after.game.world.fatigue <= 0) throw new Error("travel did not add fatigue");
  });
  await step("deploying and starting the battle", async () => {
    for (const [x, y] of [[1, 2], [1, 4], [1, 5]]) {
      await page.mouse.click(12 + x * 40 + 20, 72 + y * 40 + 20);
      await page.waitForTimeout(100);
    }
    await page.mouse.click(808, 230);
    await page.waitForTimeout(3000);
  });
} finally {
  await browser.close();
}
