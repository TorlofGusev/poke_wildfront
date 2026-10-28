import { it } from "vitest";
import process from "node:process";
import { writeFileSync } from "node:fs";
import { CONTENT, PROGRESSION, WORLD_CONTENT, WORLDS } from "../src/content";
import { planTurn } from "../src/core/ai";
import { applyAction, createBattle, type BattleState, type UnitSetup } from "../src/core/battle";
import { generateEncounter } from "../src/core/expedition";
import { generateFreeArena, pickFormation } from "../src/core/free";
import { newMember, type PartyMember } from "../src/core/party";
import { gainXp, scaledXp, toUnitSetup, wildSetup } from "../src/core/progression";
import { nextRandom } from "../src/core/rng";
import { develop, raise, seededPick } from "./sim";

/**
 * Balance reports on real battles: the organic arenas, deploy spots and formations the game uses, one
 * battle per encounter, the player's side as the player would have it. Not pass/fail. Run with
 *   CURVE=1 RUN=<k> OUT=<file> npx vitest run tests/curve.report.test.ts      (one campaign, team k)
 *   SPECIES=1 LEVEL=<n> SHARD=<i>/<n> OUT=<file> npx vitest run tests/curve.report.test.ts
 */

type Side = Omit<UnitSetup, "id" | "side" | "pos">;

/** One battle as the game sets it up: the player on the first deploy spots, the wild group at its spawns. */
function realBattle(players: Side[], foes: Side[], seed: number, style: string): BattleState {
  const arena = generateFreeArena({ seed, style, formation: pickFormation(seed, "wild"), playerCount: players.length, enemyCount: foes.length });
  const units: UnitSetup[] = [
    // Every other deploy spot: a spread-out line, as a player would place.
    ...players.map((p, i) => ({ ...p, id: `p${i}`, side: "player" as const, pos: arena.deploymentZone[(i * 2) % arena.deploymentZone.length]! })),
    ...foes.map((f, i) => ({ ...f, id: `e${i}`, side: "enemy" as const, pos: arena.enemySpawns[i]! })),
  ];
  let { state } = createBattle(CONTENT, arena.field, units);
  for (let i = 0; i < 600 && state.outcome === "ongoing"; i++)
    for (const a of planTurn(state, CONTENT)) if (state.outcome === "ongoing") state = applyAction(state, CONTENT, a).state;
  return state;
}

const hpShare = (st: BattleState) => {
  const us = st.units.filter((u) => u.side === "player");
  return us.reduce((s, u) => s + Math.max(0, u.hp), 0) / us.reduce((s, u) => s + u.maxHp, 0);
};

/** Story order of the maps (Cerulean Cave, the post-game, last). */
const ORDER = ["pallet-town", "route-1", "route-22", "route-2", "viridian-forest", "route-3", "mt-moon-1f", "mt-moon-b2f", "route-4", "route-24", "route-25", "route-5", "route-6", "route-11", "digletts-cave", "route-9", "rock-tunnel", "route-10", "route-8", "route-7", "pokemon-tower", "route-16", "route-17", "route-18", "route-15", "route-14", "route-13", "route-12", "safari-zone", "route-19", "route-20", "seafoam-islands", "pokemon-mansion", "route-21", "route-23", "victory-road", "cerulean-cave"].filter((id) => WORLDS[id]);
/** First-stage species the player can meet in the wild (plus the starters). */
const POOL = [...new Set(["bulbasaur", "charmander", "squirtle", ...Object.values(WORLD_CONTENT.biomes)
  .flatMap((b) => b.encounters?.entries.map((e) => e.speciesId) ?? [])])]
  .filter((id) => !Object.values(CONTENT.species).some((s) => (s as { evolution?: { into: string } }).evolution?.into === id));

/** Campaign: a starter and two early catches from level 1 through every spawn zone in story order. */
it.skipIf(!process.env.CURVE)("difficulty curve", () => {
  const run = Number(process.env.RUN ?? 0);
  const r = (k: number) => nextRandom(run * 7919 + k).value;
  const starter = ["bulbasaur", "charmander", "squirtle"][run % 3]!;
  const early = ["pidgey", "rattata", "caterpie", "weedle", "pikachu", "nidoran-f", "nidoran-m", "spearow", "mankey"];
  const team0 = [starter, early[Math.floor(r(1) * early.length)]!, early[Math.floor(r(2) * early.length)]!];
  let team: PartyMember[] = team0.map((s, i) => develop(newMember(CONTENT, PROGRESSION, s, i, 1), seededPick, run + i));
  const candies = { n: 3 };
  let rng = 1000 + run;
  const rows: string[] = [`# run ${run}: ${team0.join("/")}`];
  let idx = 0;
  for (const mapId of ORDER) for (const z of WORLDS[mapId]!.spawnZones) {
    const def = WORLD_CONTENT.biomes[z.biome]!;
    const table = { ...def.encounters!, levels: z.levels ?? def.encounters!.levels };
    for (let f = 0; f < z.count; f++) {
      const enc = generateEncounter(table, rng);
      rng = enc.rngState;
      const foeLv = enc.levels.slice(0, 3);
      const foes = enc.species.slice(0, 3).map((s, i) => wildSetup(CONTENT, PROGRESSION, s, foeLv[i]!));
      const st = realBattle(team.map((m) => toUnitSetup(CONTENT, PROGRESSION, m)), foes, rng, z.biome);
      const won = st.outcome === "victory";
      const alive = st.units.filter((u) => u.side === "player" && u.hp > 0).length;
      const teamLv = team.reduce((s, m) => s + m.level, 0) / team.length;
      rows.push([idx++, mapId, z.biome, (foeLv.reduce((a, b) => a + b, 0) / foeLv.length).toFixed(1), teamLv.toFixed(1), won ? 1 : 0, alive, hpShare(st).toFixed(2), st.round].join("\t"));
      // A win gives XP (the first map caps levels at 3); a loss sends the team back to rest, as in the game.
      if (won) {
        const xp = foeLv.reduce((s, l) => s + l, 0) * PROGRESSION.rules.xpPerEnemyLevel;
        const cap = mapId === "pallet-town" || mapId === "route-1" ? 3 : Infinity;
        candies.n += PROGRESSION.rules.candiesPerVictory;
        team = team.map((m) => (m.level >= cap ? m : develop(gainXp(CONTENT, PROGRESSION, m, scaledXp(xp, m.level, foeLv)).member, seededPick, run, candies)));
      }
    }
  }
  if (process.env.OUT) writeFileSync(process.env.OUT, rows.join("\n") + "\n");
}, 7_200_000);

/**
 * Species power: random trios from the wild pool, raised to LEVEL, against wild groups of that level from
 * the biomes. Per species line: its team's win rate when it is in the team, against the overall rate.
 */
it.skipIf(!process.env.SPECIES)("species power", () => {
  const level = Number(process.env.LEVEL ?? 15);
  const [shard, shards] = (process.env.SHARD ?? "0/1").split("/").map(Number) as [number, number];
  const n = Number(process.env.N ?? 300);
  const biomes = Object.entries(WORLD_CONTENT.biomes).filter(([, b]) => b.encounters?.entries.length).map(([id]) => id);
  const rows: string[] = [];
  for (let k = shard; k < n; k += shards) {
    const r = (j: number) => nextRandom(k * 104729 + level * 31 + j).value;
    const team: string[] = [];
    for (let j = 0; team.length < 3; j++) {
      const s = POOL[Math.floor(r(j) * POOL.length)]!;
      if (!team.includes(s)) team.push(s);
    }
    const biome = biomes[Math.floor(r(50) * biomes.length)]!;
    const enc = generateEncounter({ ...WORLD_CONTENT.biomes[biome]!.encounters!, groupSize: { min: 3, max: 3 }, levels: { min: level, max: level } }, k + 1);
    const foes = enc.species.slice(0, 3).map((s) => wildSetup(CONTENT, PROGRESSION, s, level));
    const players = team.map((s, i) => toUnitSetup(CONTENT, PROGRESSION, raise(s, level, seededPick, k + i)));
    const st = realBattle(players, foes, k + 7, biome);
    rows.push([team.join(","), biome, st.outcome === "victory" ? 1 : 0, hpShare(st).toFixed(2)].join("\t"));
  }
  if (process.env.OUT) writeFileSync(process.env.OUT, rows.join("\n") + "\n");
}, 7_200_000);
