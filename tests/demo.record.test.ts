import { it } from "vitest";
import process from "node:process";
import { writeFileSync } from "node:fs";
import { CONTENT, PROGRESSION, WORLD_CONTENT } from "../src/content";
import { planTurn } from "../src/core/ai";
import { applyAction, createBattle, type BattleAction, type BattleEvent, type UnitSetup } from "../src/core/battle";
import { generateFreeArena, pickFormation } from "../src/core/free";
import { toUnitSetup, wildSetup } from "../src/core/progression";
import { nextRandom } from "../src/core/rng";
import type { DemoBattle } from "../src/content/demoBattles";
import { raise, seededPick } from "./sim";

/**
 * Records the title screen's background battles: AI against AI on real arenas, kept when they are worth
 * watching (a close finish, pushes, field effects, several rounds). Run after a rule change breaks a replay:
 *   DEMO=1 npx vitest run tests/demo.record.test.ts
 */
const POOL = ["bulbasaur", "charmander", "squirtle", "pikachu", "geodude", "pidgey", "growlithe", "abra", "machop", "gastly", "eevee",
  "poliwag", "oddish", "mankey", "vulpix", "ponyta", "magnemite", "onix", "cubone", "scyther", "jigglypuff", "nidoran-m", "psyduck", "tentacool"];
const STYLES = [...new Set(Object.keys(WORLD_CONTENT.biomes))];

it.skipIf(!process.env.DEMO)("records title-screen battles", () => {
  const found: (DemoBattle & { score: number })[] = [];
  for (let seed = 1; seed <= 120; seed++) {
    const r = (k: number) => nextRandom(seed * 7919 + k).value;
    const pick = (k: number) => POOL[Math.floor(r(k) * POOL.length)]!;
    const level = 12 + Math.floor(r(9) * 14);
    const style = STYLES[Math.floor(r(8) * STYLES.length)]!;
    const arena = generateFreeArena({ seed, style, formation: pickFormation(seed, "wild"), playerCount: 3, enemyCount: 3 });
    const units: UnitSetup[] = [
      ...[0, 1, 2].map((i) => ({ ...toUnitSetup(CONTENT, PROGRESSION, raise(pick(i), level, seededPick, seed + i)), id: `p${i}`, side: "player" as const, pos: arena.deploymentZone[(i * 2) % arena.deploymentZone.length]! })),
      ...[3, 4, 5].map((i) => ({ ...wildSetup(CONTENT, PROGRESSION, pick(i), level), id: `e${i - 3}`, side: "enemy" as const, pos: arena.enemySpawns[i - 3]! })),
    ];
    let { state } = createBattle(CONTENT, arena.field, units, { seed });
    const actions: BattleAction[] = [];
    const events: BattleEvent[] = [];
    for (let i = 0; i < 400 && state.outcome === "ongoing"; i++)
      for (const a of planTurn(state, CONTENT)) {
        if (state.outcome !== "ongoing") break;
        const step = applyAction(state, CONTENT, a);
        state = step.state;
        actions.push(a);
        events.push(...step.events);
      }
    if (state.outcome === "ongoing" || state.round < 4 || state.round > 10) continue;
    const left = state.units.filter((u) => u.hp > 0 && !u.captured).length;
    const kinds = new Set(events.map((e) => e.type)).size;
    const pushes = events.filter((e) => e.type === "displaced" && !e.engage).length;
    // A close finish (few left standing), variety and movement on the field.
    found.push({ field: arena.field, units, seed, actions, outcome: state.outcome, score: kinds + Math.min(6, pushes) - left * 2, style });
  }
  // The best ones, one per arena style.
  const chosen: DemoBattle[] = [];
  for (const b of found.sort((a, b) => b.score - a.score)) {
    if (chosen.length >= 8) break;
    if (chosen.some((c) => c.style === b.style)) continue;
    const { score: _score, ...battle } = b;
    chosen.push(battle);
  }
  writeFileSync("src/content/demoBattles.json", JSON.stringify(chosen) + "\n");
}, 3_600_000);
