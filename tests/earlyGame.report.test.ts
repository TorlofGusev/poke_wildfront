import { it } from "vitest";
import process from "node:process";
import { CONTENT, PROGRESSION } from "../src/content";
import { AI_LEVELS } from "../src/core/ai";
import { effectiveGroup } from "../src/core/expedition";
import { toUnitSetup, wildSetup } from "../src/core/progression";
import { battle, raise } from "./sim";

/**
 * The learning maps as a new player meets them (EARLY=1): one starter (later a catch beside it)
 * against the wild groups of Pallet Town, Route 1 and Route 22 with their map's AI.
 */
it.runIf(process.env.EARLY)("early game", () => {
  const starters = ["bulbasaur", "charmander", "squirtle", "pikachu"];
  const cases: [string, number, string[], [string, number][][]][] = [
    ["Pallet route (L1-2)", 1, [], [[["pidgey", 1]], [["rattata", 2]], [["pidgey", 1], ["rattata", 2]], [["rattata", 2], ["spearow", 2]]]],
    ["Pallet forest (L2-3)", 2, [], [[["caterpie", 2], ["weedle", 3]], [["caterpie", 3], ["weedle", 2], ["oddish", 3]]]],
    ["Route 1 (L2-3)", 3, [], [[["rattata", 3]], [["pidgey", 2], ["rattata", 3]], [["pidgey", 3], ["rattata", 3], ["rattata", 2]]]],
    ["Route 1 + a catch", 3, ["pidgey"], [[["pidgey", 2], ["rattata", 3]], [["pidgey", 3], ["rattata", 3], ["rattata", 2]]]],
    ["Route 22 + a catch (L2-4)", 4, ["rattata"], [[["rattata", 4], ["spearow", 3], ["mankey", 4]]]],
  ];
  for (const [name, lv, extra, groups] of cases) {
    const rows = groups.map((g) => {
      let wins = 0, hp = 0, n = 0;
      for (const s of starters) for (let seed = 0; seed < 3; seed++) {
        const team = [s, ...extra].map((sp, i) => toUnitSetup(CONTENT, PROGRESSION, raise(sp, i ? Math.max(1, lv - 1) : lv, (o, k) => o[k % o.length]!, seed + i)));
        // As the game fields them: never more than the party, never above its best level (learning maps).
        const eff = effectiveGroup({ id: "g", pos: { x: 0, y: 0 }, biome: "route", species: g.map(([sp]) => sp), levels: g.map(([, l]) => l) }, team.length, 3, lv);
        const foes = eff.species.map((sp, i) => wildSetup(CONTENT, PROGRESSION, sp, eff.levels[i]!));
        const st = battle(team, foes, seed, { enemy: AI_LEVELS.tutorial });
        n++;
        if (st.outcome === "victory") wins++;
        const us = st.units.filter((u) => u.side === "player");
        hp += us.reduce((a, u) => a + Math.max(0, u.hp), 0) / us.reduce((a, u) => a + u.maxHp, 0);
      }
      return `${g.length}× → win ${Math.round((wins / n) * 100)}%, HP left ${Math.round((hp / n) * 100)}%`;
    });
    console.log(`${name.padEnd(26)} Lv${lv}${extra.length ? "+" + extra.join(",") : ""}: ${rows.join(" | ")}`);
  }
});
