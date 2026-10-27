import { it } from "vitest";
import process from "node:process";
import { CONTENT, PROGRESSION } from "../src/content";
import { toUnitSetup } from "./../src/core/progression";
import { fight, raise } from "./sim";

/** Win share of each focus of chosen lines vs a mixed gauntlet (FOCUSCHECK=chansey,clefairy ...). */
it.runIf(process.env.FOCUSCHECK)("focus check", () => {
  const L = Number(process.env.LEVEL ?? 20);
  const gauntletSpecies = [["charmander", "squirtle", "bulbasaur"], ["pidgey", "geodude", "pikachu"], ["machop", "abra", "gastly"], ["growlithe", "poliwag", "oddish"]];
  const gauntlet = gauntletSpecies.map((team, k) => team.map((sp, i) => toUnitSetup(CONTENT, PROGRESSION, raise(sp, L, (o, s) => o[s % o.length]!, k * 7 + i))));
  for (const id of process.env.FOCUSCHECK!.split(",")) {
    const row = PROGRESSION.trees[id]!.focus.map((f) => {
      let w = 0;
      gauntlet.forEach((g, k) => {
        const trio = [0, 1, 2].map((i) => toUnitSetup(CONTENT, PROGRESSION, raise(id, L, (o, s) => (o.includes(f.skill) ? f.skill : o[s % o.length]!), k + i)));
        w += fight(trio, g, k).win;
      });
      return `${f.stat}:${Math.round((w / gauntlet.length) * 100)}%`;
    });
    console.log(id.padEnd(10), row.join("  "));
  }
});
