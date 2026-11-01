// Effect test bench: plays chosen moves through the real BattleScene (its playEvents, the path every move takes)
// from set positions and distances, and screenshots each one as it plays. Run from the repo root after a build:
//   node promo/tools/fxtest.mjs [move ...]   → promo/fxtest/<n>-<move>-<t>.png
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { readFileSync, mkdirSync, rmSync } from "node:fs";

const OUT = "promo/fxtest";
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// [move, attacker field pos, target field pos, extra targets]
const ALL = [
  ["flamethrower", [4, 6], [6.5, 6]],
  ["flamethrower", [4, 6], [6.5, 3.5]],
  ["heat-wave", [4, 6], [6, 6.5]],
  ["water-gun", [4, 6], [7, 6]],
  ["hydro-pump", [8, 6], [4.5, 8]],
  ["ice-beam", [4, 6], [7, 6]],
  ["psychic", [4, 6], [6, 5]],
  ["psystrike", [3, 6], [7.5, 4.5]],
  ["aura-sphere", [4, 6], [7, 6]],
  ["ember", [4, 6], [7, 6]],
  ["fire-blast", [4, 6], [7, 6.5]],
  ["thunder", [4, 6], [7, 6]],
  ["surf", [4, 6], [5.2, 6]],
  ["earthquake", [5, 6], [6.3, 6], [[3.8, 6.5]]],
  ["fire-spin", [4, 6], [6, 6]],
  ["twister", [4, 6], [6, 6]],
  ["stone-edge", [4, 6], [7, 6]],
  ["rock-slide", [4, 6], [7, 6]],
  ["sludge-bomb", [4, 6], [7, 6]],
  ["solar-beam", [4, 6], [6, 6]],
  ["blizzard", [4, 6], [7, 6]],
  ["hydro-pump", [5, 4], [5.2, 0.35]],
  ["thunder", [4, 6], [4.8, 6.2], [[5.6, 6]]],
  ["vine-whip", [4, 6], [5.6, 6]],
  ["vine-whip", [6, 6], [4.6, 5]],
  ["power-whip", [4, 6], [6, 6.5]],
  ["frenzy-plant", [4, 6], [7, 6]],
  ["leech-seed", [4, 6], [6, 6]],
  ["spore", [4, 6], [5, 6]],
  ["razor-leaf", [4, 6], [6, 6]],
  ["energy-ball", [4, 6], [7, 6]],
];
const pick = process.argv.slice(2);
const TESTS = pick.length ? ALL.filter(([m]) => pick.includes(m)) : ALL;
const SHOTS = [120, 300, 550, 850, 1250, 1900, 3200];

const saveObj = JSON.parse(readFileSync("promo/save.json", "utf8"));
saveObj.game.badges = ["boulder", "cascade"];
saveObj.game.flags = [...(saveObj.game.flags ?? []), "tip-map", "tip-battle", "tip-types", "tip-engage"];
const base = saveObj.game.roster.party[0];
saveObj.game.roster.party = ["charizard", "blastoise", "venusaur"].map((speciesId, i) => ({
  ...base, uid: `pk${i + 1}`, speciesId, level: 30, talents: [], heldItem: null, hp: 9999, unspentPoints: 0,
}));
Object.assign(saveObj.game.world, { mapId: "route-24", pos: { x: 11, y: 14 } });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => (m.type() === "error" || m.text().startsWith("bench:")) && errors.push(m.text()));
await page.goto(pathToFileURL(resolve("dist-single/index.html")).href);
await page.evaluate((s) => { localStorage.setItem("pokemon-wildfront.save", s); localStorage.setItem("pokemon-wildfront.lang", "en"); localStorage.setItem("wildfront:battleSpeed", "1"); }, JSON.stringify(saveObj));
await page.reload();
await page.waitForTimeout(2000);
await page.evaluate(() => window.__game.scene.getScenes(true).forEach((s) => s.scene.start("Overworld", {})));
await page.waitForTimeout(1200);
await page.evaluate(() => {
  const w = window.__game.scene.getScene("Overworld").world;
  const pos = { x: w.pos.x, y: w.pos.y - 2 };
  w.encounters.splice(0, w.encounters.length, { id: "wild1", pos, home: pos, biome: "cerulean-route24", species: ["mew", "gyarados"], levels: [28, 28] });
  window.__game.scene.getScene("Overworld").travelTo(pos);
});
await page.waitForFunction(() => window.__game.scene.getScene("Battle")?.scenario?.deploymentZone?.length && window.__game.scene.getScene("Battle").scene.isActive(), null, { timeout: 30000 });
await page.waitForTimeout(1200);
await page.evaluate(async () => {
  const b = window.__game.scene.getScene("Battle");
  // An open field for the bench.
  b.scenario = { ...b.scenario, field: { ...b.scenario.field, zones: b.scenario.field.zones.filter((z) => z.terrain === "floor") } };
  b.drawBoard();
  const spots = b.scenario.deploymentZone;
  for (const [i, uid] of ["pk1", "pk2"].entries()) {
    b.selectedCandidate = uid;
    b.onDeployClick(spots[i * 2]);
    await new Promise((r) => setTimeout(r, 300));
  }
  b.startBattle();
});
await page.waitForFunction(() => { const b = window.__game.scene.getScene("Battle"); return b.state && !b.busy; }, null, { timeout: 30000 });
await page.waitForTimeout(800);

let n = 0;
for (const [moveId, from, to, more = []] of TESTS) {
  await page.evaluate(([moveId, from, to, more]) => {
    const b = window.__game.scene.getScene("Battle");
    const S = 40;
    const units = b.state.units;
    const any = units[0], v0 = b.units.get(any.id).container;
    const ox = v0.x - any.pos.x * S, oy = v0.y - any.pos.y * S;
    const place = (u, p) => {
      u.pos = { x: p[0], y: p[1] };
      b.units.get(u.id)?.container.setPosition(ox + p[0] * S, oy + p[1] * S);
    };
    const me = units.find((u) => u.side === "player"), foes = units.filter((u) => u.side === "enemy");
    // Everyone else out of the way, in the far corners.
    units.forEach((u, i) => place(u, [0.6 + (i % 2) * 0.8, 0.6 + Math.floor(i / 2) * 0.8]));
    place(me, from);
    place(foes[0], to);
    more.forEach((p, i) => foes[i + 1] && place(foes[i + 1], p));
    const hit = [foes[0], ...more.map((_, i) => foes[i + 1])].filter(Boolean);
    const evs = [{ type: "moveUsed", unitId: me.id, moveId, target: { x: to[0], y: to[1] }, affected: hit.map((u) => u.id) }];
    for (const u of hit) evs.push({ type: "damaged", unitId: u.id, amount: 12, hp: u.hp, source: "move", effectiveness: 2 });
    window.__fx = b.playEvents(evs).catch((e) => console.warn("bench: " + e.stack));
  }, [moveId, from, to, more]);
  const t0 = Date.now();
  for (const ms of SHOTS) {
    const wait = ms - (Date.now() - t0);
    if (wait > 0) await page.waitForTimeout(wait);
    await page.screenshot({ path: `${OUT}/${String(n).padStart(2, "0")}-${moveId}-${String(ms).padStart(4, "0")}.png` });
  }
  await page.evaluate(() => window.__fx);
  await page.waitForTimeout(300);
  n++;
}
await page.screenshot({ path: `${OUT}/zz-ground.png` });
await browser.close();
console.log("tests:", n, "errors:", errors.length ? errors : "none");
