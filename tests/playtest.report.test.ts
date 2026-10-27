import { it } from "vitest";
import process from "node:process";
import { CONTENT, PROGRESSION, WORLD_CONTENT, WORLDS } from "../src/content";
import { AI_LEVELS, planTurn, type AiWeights } from "../src/core/ai";
import { applyAction, createBattle, type BattleState, type UnitSetup } from "../src/core/battle";
import { STAT_NAMES } from "../src/core/battle";
import { generateEncounter } from "../src/core/expedition";
import { newMember, type PartyMember } from "../src/core/party";
import {
  chooseFocus,
  focusOptions,
  defaultActiveMoves,
  chooseTalent,
  gainXp,
  memberStats,
  pendingChoice,
  scaledXp,
  spendPoints,
  talentOptions,
  toUnitSetup,
  wildSetup,
  xpToNext,
} from "../src/core/progression";
import { nextRandom } from "../src/core/rng";

/**
 * AI-vs-AI playtest report (not a pass/fail test): developed player teams against wild groups at every
 * level, and a campaign from level 1 with automatic choices. Run with:
 *   PLAYTEST=1 npx vitest run tests/playtest.report.test.ts --silent=false
 */
import { arena, battle, bestHeldItem, combos, fight, firstPick, pct, raise, seededPick, STARTERS, withItem, develop, type Pick } from "./sim";


it.skipIf(!process.env.PLAYTEST)("playtest report", () => {
  // 0) Side bias: identical wild teams on both sides.
  {
    let wins = 0, n = 0;
    for (const level of [5, 15, 25]) for (let seed = 0; seed < 10; seed++) {
      const team = [0, 1, 2].map((k) => STARTERS[(seed * 3 + k) % STARTERS.length]!);
      const t = team.map((s) => wildSetup(CONTENT, PROGRESSION, s, level));
      n++;
      if (battle(t, t, seed).outcome === "victory") wins++;
    }
    console.log(`=== side bias: identical teams, the side moving first (player) wins ${pct(wins / n)}; matchups below are played both ways ===`);
  }

  // 1) Same level, 3 vs 3: developed player Pokémon (role, masteries, points) against wild ones.
  console.log("=== 3v3 at equal level: developed team vs wild group ===");
  for (const level of [3, 5, 8, 10, 12, 15, 20, 25, 30]) {
    let wins = 0, total = 0, hp = 0, rounds = 0, timeouts = 0;
    for (let seed = 0; seed < 12; seed++) {
      const r = (k: number) => nextRandom(seed * 97 + level * 13 + k).value;
      const team = [0, 1, 2].map((k) => STARTERS[Math.floor(r(k) * STARTERS.length)]!);
      const foes = [3, 4, 5].map((k) => STARTERS[Math.floor(r(k) * STARTERS.length)]!);
      const players = team.map((s, i) => toUnitSetup(CONTENT, PROGRESSION, raise(s, level, seededPick, seed + i)));
      const wild = foes.map((s) => wildSetup(CONTENT, PROGRESSION, s, level));
      const res = fight(players, wild, seed);
      total++;
      wins += res.win;
      timeouts += res.timeouts;
      hp += res.hpLeft;
      rounds += res.rounds;
    }
    console.log(`L${level}: win ${pct(wins / total)}  avg HP left ${pct(hp / total)}  avg rounds ${(rounds / total).toFixed(1)}${timeouts ? `  TIMEOUTS ${timeouts}` : ""}`);
  }

  // 2) Undeveloped (no role / masteries, like a fresh catch) vs developed, same species: what development is worth.
  console.log("=== developed vs undeveloped mirror, 3v3 ===");
  for (const level of [5, 10, 20, 30]) {
    let wins = 0;
    for (let seed = 0; seed < 10; seed++) {
      const team = [0, 1, 2].map((k) => STARTERS[(seed * 3 + k) % STARTERS.length]!);
      const dev = team.map((s, i) => toUnitSetup(CONTENT, PROGRESSION, raise(s, level, seededPick, seed + i)));
      const raw = team.map((s) => wildSetup(CONTENT, PROGRESSION, s, level));
      wins += fight(dev, raw, seed).win;
    }
    console.log(`L${level}: developed wins ${pct(wins / 10)}`);
  }

  // 3) Focus value in mixed teams: three different species against a wild group; one member at a time
  // switches between its focuses while the rest keep their first, so each focus is judged in a real team.
  console.log("=== focus swap in mixed teams vs wild, L15 (16 teams × 3 members × 3 focuses × 2 sides) ===");
  {
    const score: Record<string, { win: number; n: number }> = {};
    for (let seed = 0; seed < 16; seed++) {
      const r = (k: number) => nextRandom(seed * 53 + k).value;
      const team: string[] = [];
      for (let k = 0; team.length < 3; k++) {
        const sp = STARTERS[Math.floor(r(k) * STARTERS.length)]!;
        if (!team.includes(sp)) team.push(sp);
      }
      const foes = [10, 11, 12].map((k) => wildSetup(CONTENT, PROGRESSION, STARTERS[Math.floor(r(k) * STARTERS.length)]!, 15));
      const firsts = team.map((sp) => focusOptions(PROGRESSION, sp)[0]?.skill ?? "");
      const mk = (want: string[]) => team.map((sp, i) => toUnitSetup(CONTENT, PROGRESSION, raise(sp, 15, (o, sd) => (o.includes(want[i]!) ? want[i]! : seededPick(o, sd)), seed + i)));
      for (let i = 0; i < 3; i++) for (const f of focusOptions(PROGRESSION, team[i]!)) {
        const want = firsts.map((b, j) => (j === i ? f.skill : b));
        const sc = (score[`${team[i]}:${f.skill}`] ??= { win: 0, n: 0 });
        sc.win += fight(mk(want), foes, seed).win;
        sc.n++;
      }
    }
    for (const [key, sc] of Object.entries(score).sort()) console.log(`  ${key.padEnd(22)} win ${pct(sc.win / sc.n)} over ${sc.n} line-ups`);
  }

  // 3b) Novice AI (early routes) vs the normal one: the same developed team against the same wild group.
  console.log("=== novice vs normal wild AI, developed team at equal level (12 seeds × 2 sides) ===");
  for (const level of [3, 5, 8]) {
    const res = { novice: 0, normal: 0 };
    for (let seed = 0; seed < 12; seed++) {
      const r = (k: number) => nextRandom(seed * 97 + level * 13 + k).value;
      const team = [0, 1, 2].map((k) => STARTERS[Math.floor(r(k) * STARTERS.length)]!);
      const foes = [3, 4, 5].map((k) => wildSetup(CONTENT, PROGRESSION, STARTERS[Math.floor(r(k) * STARTERS.length)]!, level));
      const players = team.map((s, i) => toUnitSetup(CONTENT, PROGRESSION, raise(s, level, seededPick, seed + i)));
      for (const lvl of ["novice", "normal"] as const) res[lvl] += fight(players, foes, seed, AI_LEVELS[lvl]).win;
    }
    console.log(`L${level}: player wins ${pct(res.novice / 12)} vs novice AI, ${pct(res.normal / 12)} vs normal AI`);
  }
  // 4) Stat snapshots: how a line grows.
  console.log("=== growth snapshots (first focus) ===");
  for (const s of ["charmander", "squirtle", "pikachu", "geodude", "caterpie"]) {
    const row = [1, 5, 10, 15, 20, 30].map((lv) => {
      const m = raise(s, lv, firstPick, 1);
      const { stats, maxHp } = memberStats(CONTENT, PROGRESSION, m);
      return `L${lv} ${m.speciesId} HP${maxHp} A${stats.attack} D${stats.defense} S${stats.speed} W${stats.willpower} C${stats.crit}`;
    });
    console.log(row.join(" | "));
  }

  // 5) Campaign: a starter trio from L1 fights biome encounters in map order, resting after each fight.
}, 600_000);

it.skipIf(!process.env.PLAYTEST)("campaign", () => {
  console.log("=== campaign: bulbasaur/charmander/squirtle through every map to Indigo Plateau ===");
  const ORDER = ["pallet-town", "route-1", "route-22", "route-2", "viridian-forest", "route-3", "mt-moon-1f", "mt-moon-b2f", "route-4", "route-24", "route-25", "route-5", "route-6", "route-11", "digletts-cave", "route-9", "rock-tunnel", "route-10", "route-8", "route-7", "pokemon-tower", "route-16", "route-17", "route-18", "route-15", "route-14", "route-13", "route-12", "safari-zone", "route-19", "route-20", "seafoam-islands", "pokemon-mansion", "route-21", "route-23", "victory-road", "cerulean-cave"].filter((id) => WORLDS[id]);
  // Every spawn zone of every map in story order (Cerulean Cave, the post-game zone, last).
  // Each zone is fought as often as it holds groups on its map (one clear of every map; rests respawn them, so this is a floor).
  const allZones: [string, number, number, number][] = ORDER.flatMap((id) => WORLDS[id]!.spawnZones.map((z): [string, number, number, number] => {
    const lv = z.levels ?? WORLD_CONTENT.biomes[z.biome]!.encounters!.levels;
    return [z.biome, lv.min, lv.max, z.count];
  }));
  const zones = [...allZones.filter((z) => z[0] !== "cerulean-cave"), ...allZones.filter((z) => z[0] === "cerulean-cave")];
  let team = ["bulbasaur", "charmander", "squirtle"].map((s, i) => develop(newMember(CONTENT, PROGRESSION, s, i, 1), firstPick, i));
  let rng = 12345;
  let money = 500;
  const candies = { n: 3 };
  const bought: string[] = [];
  for (const zone of zones) {
    const [biome, min, max, fights] = zone;
    const results: string[] = [];
    for (let f = 0; f < fights; f++) {
      const def = WORLD_CONTENT.biomes[biome]!;
      const table = { ...def.encounters!, levels: { min, max } };
      const enc = generateEncounter(table, rng);
      rng = enc.rngState;
      const foes = enc.species.slice(0, 3).map((s, i) => wildSetup(CONTENT, PROGRESSION, s, enc.levels[i]!));
      const res = fight(team.map((m) => toUnitSetup(CONTENT, PROGRESSION, m)), foes, f);
      results.push(res.outcome === "victory" ? `W${res.alive}` : res.outcome === "defeat" ? "L" : "T");
      if (res.outcome === "victory") {
        const xp = enc.levels.slice(0, 3).reduce((s, l) => s + l, 0) * PROGRESSION.rules.xpPerEnemyLevel;
        // The first map (first four zones) caps levels at 3.
        const cap = zones.indexOf(zone) < WORLDS["route-2"]!.spawnZones.length ? 3 : Infinity;
        money += enc.levels.slice(0, 3).reduce((s, l) => s + l, 0) * PROGRESSION.rules.moneyPerEnemyLevel;
        candies.n += PROGRESSION.rules.candiesPerVictory;
        team = team.map((m) => (m.level >= cap ? m : develop(gainXp(CONTENT, PROGRESSION, m, scaledXp(xp, m.level, enc.levels.slice(0, 3))).member, firstPick, 0, candies)));
      }
    }
    // Back in town: buy each Pokémon its held item once the money allows, newest loadout swapped in.
    team = team.map((m) => {
      const item = bestHeldItem(m.speciesId);
      const price = PROGRESSION.items[item]!.price;
      if (m.heldItem || money < price) return m;
      money -= price;
      bought.push(`${PROGRESSION.items[item]!.name}@${biome}L${min}`);
      return { ...m, heldItem: item };
    }).map((m) => ({ ...m, activeMoves: defaultActiveMoves(CONTENT, PROGRESSION, m.speciesId, m.knownMoves) }));
    console.log(`${biome} L${min}-${max}: ${results.join(" ")}  → team ${team.map((m) => `${m.speciesId} L${m.level}`).join(", ")}  ₽${money}`);
  }
  console.log(`bought: ${bought.join(", ") || "nothing"}`);
}, 600_000);
