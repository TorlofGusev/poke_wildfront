import { it } from "vitest";
import process from "node:process";
import { readFileSync } from "node:fs";
import { CONTENT, PROGRESSION } from "../src/content";
import { toUnitSetup } from "../src/core/progression";
import { fight, pct, raise, type Pick } from "./sim";

/** Re-measures listed rows (file of "line level optionA optionB") with more seeds: ROWS=<file>. */
const force = (opt: string): Pick => (o, seed) => (o.includes(opt) ? opt : o[seed % o.length]!);
const trio = (sp: string, pick: Pick, seed: number) => [0, 1, 2].map((i) => toUnitSetup(CONTENT, PROGRESSION, raise(sp, 30, pick, seed + i)));
it.skipIf(!process.env.ROWS)("row confirm", () => {
  for (const line of readFileSync(process.env.ROWS!, "utf8").split("\n").filter(Boolean)) {
    const [sp, lv, a, b] = line.trim().split(" ") as [string, string, string, string];
    let w = 0;
    const seeds = [3, 4, 5, 6, 7, 8];
    for (const s of seeds) w += fight(trio(sp, force(a), s), trio(sp, force(b), s), s).win;
    console.log(`ROW ${sp} ${lv} ${a} ${pct(w / seeds.length)} vs ${b}`);
  }
}, 3_600_000);
