import { it } from "vitest";
import process from "node:process";
import { CONTENT, PROGRESSION } from "../src/content";
import { toUnitSetup } from "../src/core/progression";
import { fight, pct, raise, type Pick } from "./sim";

/**
 * Mastery tree balance report (not a pass/fail test). Run with:
 *   TREEBAL=1 npx vitest run tests/treeBalance.report.test.ts --silent=false
 * 1) Line power: a trio of each line (seeded picks) against a fixed gauntlet of mixed trios at Lv 20.
 * 2) Focus spread: per line, mirror trios that differ only in the focus.
 * 3) Row options: per line and row, mirror trios that differ only in that row's pick (Lv 30).
 */
const LEVEL = Number(process.env.TREEBAL_LEVEL ?? 20);
// Experiment knobs: override the melee rules without editing rules.json.
if (process.env.MELEE) Object.assign(CONTENT.rules.melee, JSON.parse(process.env.MELEE));
/** Fights per pairing (TREEBAL_SEEDS, default 2); more seeds, steadier numbers. */
const SEEDS = Array.from({ length: Number(process.env.TREEBAL_SEEDS ?? 2) }, (_, i) => i + 1);
const lines = [...new Set(Object.values(PROGRESSION.trees))];
const first = (t: (typeof lines)[number]) => t.line[0]!;

/** Picks the focus with Bond skill `focus` and `force` whenever offered, else seeded. */
const picker = (focus: string | null, force: string | null): Pick => (o, seed) =>
  (focus && o.includes(focus) ? focus : force && o.includes(force) ? force : o[seed % o.length]!);
const trio = (species: string, level: number, pick: Pick, seed: number) =>
  [0, 1, 2].map((i) => toUnitSetup(CONTENT, PROGRESSION, raise(species, level, pick, seed + i)));

it.skipIf(!process.env.TREEBAL)("tree balance report", () => {
  const t0 = Date.now();
  // 1) Line power vs a gauntlet.
  const gauntletSpecies = [["charmander", "squirtle", "bulbasaur"], ["pidgey", "geodude", "pikachu"], ["machop", "abra", "gastly"], ["growlithe", "poliwag", "oddish"]];
  const gauntlet = gauntletSpecies.map((team, k) => team.map((sp, i) => toUnitSetup(CONTENT, PROGRESSION, raise(sp, LEVEL, (o, s) => o[s % o.length]!, k * 7 + i))));
  const power: [string, number][] = [];
  for (const t of lines) {
    let w = 0;
    for (const seed of SEEDS) gauntlet.forEach((g, k) => { w += fight(trio(first(t), LEVEL, (o, s) => o[s % o.length]!, k + seed * 10), g, k + seed * 10).win; });
    power.push([first(t), w / (gauntlet.length * SEEDS.length)]);
  }
  power.sort((a, b) => b[1] - a[1]);
  console.log(`=== line power at Lv ${LEVEL} vs ${gauntlet.length} mixed trios (win share) ===`);
  console.log(power.map(([id, w]) => `${id} ${pct(w)}`).join(" | "));

  if (process.env.TREEBAL_ONLY === "power") return;
  // 2) Focus spread: each focus against each other focus of the same line.
  console.log("=== focus spread (each focus vs the line's other focuses, mirror) ===");
  const lopsided: string[] = [];
  for (const t of lines) {
    const stats = t.focus.map((f) => f.skill);
    const score = Object.fromEntries(stats.map((s) => [s, 0]));
    for (let a = 0; a < stats.length; a++) for (let b = a + 1; b < stats.length; b++) for (const seed of SEEDS) {
      const w = fight(trio(first(t), LEVEL, picker(stats[a]!, null), seed), trio(first(t), LEVEL, picker(stats[b]!, null), seed), seed).win;
      score[stats[a]!] = score[stats[a]!]! + w; score[stats[b]!] = score[stats[b]!]! + 1 - w;
    }
    const games = (stats.length - 1) * SEEDS.length;
    const line = stats.map((s) => `${s} ${pct(score[s]! / games)}`).join(", ");
    const vals = stats.map((s) => score[s]! / games);
    if (Math.max(...vals) - Math.min(...vals) >= 0.75) lopsided.push(`${first(t)}: ${line}`);
    console.log(`${first(t).padEnd(12)} ${line}`);
  }
  console.log(`lopsided focus sets (spread >= 75 points): ${lopsided.length}\n  ${lopsided.join("\n  ")}`);

  // 3) Row options at Lv 30: forcing one option vs the other, everything else seeded the same.
  console.log("=== row options at Lv 30 (A vs B mirror; listed when one side wins >= 75%) ===");
  const dominant: string[] = [];
  let rows = 0;
  for (const t of lines) for (const [lv, opts] of Object.entries(t.rows)) {
    if (opts.length !== 2) continue;
    rows++;
    let w = 0;
    for (const seed of SEEDS) w += fight(trio(first(t), 30, picker(null, opts[0]!), seed), trio(first(t), 30, picker(null, opts[1]!), seed), seed).win;
    w /= SEEDS.length;
    if (w >= 0.75 || w <= 0.25) dominant.push(`${first(t)} Lv${lv}: ${opts[0]} ${pct(w)} vs ${opts[1]}`);
  }
  console.log(`${dominant.length} of ${rows} two-option rows lopsided:\n  ${dominant.join("\n  ")}`);
  console.log(`(${Math.round((Date.now() - t0) / 1000)} s)`);
}, 4 * 3_600_000);
