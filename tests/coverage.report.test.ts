import { it } from "vitest";
import process from "node:process";
import { CONTENT, PROGRESSION } from "../src/content";
import { createBattle, movementPoints, threatZone, unitById } from "../src/core/battle";
import { generateArena } from "../src/core/battle/arenaGen";
import { Grid } from "../src/core/grid";
import { newMember } from "../src/core/party";
import { toUnitSetup } from "../src/core/progression";

/**
 * Movement coverage report (not a pass/fail test): from the middle of generated hex arenas, the share of
 * passable hexes each Pokémon can move to in one turn, and can hit (move + its longest damaging move). Run with:
 *   COVERAGE=1 npx vitest run tests/coverage.report.test.ts --silent=false
 */
const ARENAS = 20;

it.skipIf(!process.env.COVERAGE)("movement coverage", () => {
  const rows: { name: string; level: number; mp: number; move: number; hit: number }[] = [];
  const arenas = Array.from({ length: ARENAS }, (_, seed) =>
    generateArena({ seed: seed + 1, style: "route", formation: "sides", playerCount: 1, enemyCount: 1 }).mapRows);
  for (const level of [5, 20])
    for (const id of Object.keys(CONTENT.species)) {
      let move = 0, hit = 0, mp = 0;
      for (const rows_ of arenas) {
        const grid = Grid.fromAscii(rows_);
        // The passable hex nearest the middle.
        let start = { x: 8, y: 5 };
        for (let d = 0; d < 8 && !grid.isPassable(start); d++) start = { x: 8 + (d % 3) - 1, y: 5 + Math.floor(d / 3) - 1 };
        if (!grid.isPassable(start)) continue;
        const passable = rows_.flatMap((r, y) => [...r].map((_, x) => ({ x, y }))).filter((p) => grid.isPassable(p)).length;
        const corner = rows_.flatMap((r, y) => [...r].map((_, x) => ({ x, y }))).reverse().find((p) => grid.isPassable(p) && (p.x !== start.x || p.y !== start.y))!;
        const setup = toUnitSetup(CONTENT, PROGRESSION, newMember(CONTENT, PROGRESSION, id, 1, level));
        const state = createBattle(CONTENT, rows_, [
          { ...setup, id: "u", speciesId: id, side: "player", pos: start },
          { id: "far", speciesId: id, side: "enemy", pos: corner },
        ]).state;
        const z = threatZone(state, CONTENT, "u");
        mp = movementPoints(CONTENT, unitById(state, "u"), state);
        move += z.reach.length / passable;
        hit += (z.reach.length + 1 + z.strike.filter((p) => grid.isPassable(p)).length) / passable;
      }
      rows.push({ name: CONTENT.species[id]!.name, level, mp, move: (100 * move) / ARENAS, hit: (100 * hit) / ARENAS });
    }
  for (const level of [5, 20]) {
    const at = rows.filter((r) => r.level === level).sort((a, b) => b.hit - a.hit);
    const avg = (k: "move" | "hit") => at.reduce((s, r) => s + r[k], 0) / at.length;
    console.log(`\n== Level ${level}: average move ${avg("move").toFixed(1)}%, move+hit ${avg("hit").toFixed(1)}% of passable hexes`);
    for (const mp of [...new Set(at.map((r) => r.mp))].sort())
      console.log(`  move points ${mp}: ${at.filter((r) => r.mp === mp).length} species`);
    console.log("  top 8:", at.slice(0, 8).map((r) => `${r.name} mp${r.mp} ${r.move.toFixed(0)}%/${r.hit.toFixed(0)}%`).join(", "));
    console.log("  bottom 5:", at.slice(-5).map((r) => `${r.name} mp${r.mp} ${r.move.toFixed(0)}%/${r.hit.toFixed(0)}%`).join(", "));
  }
}, 600_000);
