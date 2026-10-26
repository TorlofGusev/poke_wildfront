import { it } from "vitest";
import process from "node:process";
import { CONTENT, PROGRESSION, WORLD_CONTENT, WORLDS } from "../src/content";
import { AI_LEVELS, planTurn, type AiWeights } from "../src/core/ai";
import { applyAction, createBattle, type BattleState, type UnitSetup } from "../src/core/battle";
import { STAT_NAMES } from "../src/core/battle";
import { generateEncounter } from "../src/core/expedition";
import { newMember, type PartyMember } from "../src/core/party";
import {
  chooseRole,
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
// Mirror-symmetric arena and start positions, so neither side has a terrain advantage.
const HALF = ["......", "..\"\"..", ".....#", "..##..", "......", "....\"\"", ".#....", "......"];
const arena = HALF.map((row) => row + [...row].reverse().join(""));
const START = [{ x: 1, y: 1 }, { x: 1, y: 3 }, { x: 1, y: 5 }];
const STARTERS = ["bulbasaur", "charmander", "squirtle", "pikachu", "geodude", "pidgey", "rattata", "zubat", "oddish", "mankey", "weedle", "spearow", "diglett", "caterpie"];

type Pick = (options: readonly string[], seed: number) => string;
const firstPick: Pick = (o) => o[0]!;
const seededPick: Pick = (o, seed) => o[seed % o.length]!;

/** Makes every pending choice: role (and mastery type), masteries, stat points along the species' best stats. */
function develop(m: PartyMember, pick: Pick, seed: number, candies = { n: 0 }): PartyMember {
  let cur = m;
  for (let guard = 0; guard < 50; guard++) {
    const p = pendingChoice(CONTENT, PROGRESSION, cur);
    if (p === "role") {
      const roles = CONTENT.species[cur.speciesId]!.roles ?? [];
      cur = chooseRole(CONTENT, PROGRESSION, cur, pick(roles, seed));
    } else if (p === "talent") {
      const opts = talentOptions(CONTENT, PROGRESSION, cur);
      if (!opts.length) throw new Error(`${cur.speciesId} L${cur.level}: talent pending but no options`);
      cur = chooseTalent(CONTENT, PROGRESSION, cur, pick(opts, seed + guard));
    } else break;
  }
  const base = CONTENT.species[cur.speciesId]!.stats;
  const best = [...STAT_NAMES].filter((s) => s !== "hp").sort((a, b) => base[b] - base[a]);
  for (let i = 0; cur.unspentPoints > 0; i++) {
    const bonus = candies.n > 0 ? PROGRESSION.rules.candyBonus : 0;
    if (bonus) candies.n--;
    cur = spendPoints(cur, ([best[0]!, "hp", best[1]!] as const)[i % 3]!, 1 + bonus, 1);
  }
  return cur;
}

/**
 * The held item a sensible player gives this Pokémon: a booster for its main type if the Mart sells one,
 * else Muscle Band. `owned` limits it to what the team can afford.
 */
function bestHeldItem(speciesId: string): string {
  const type = CONTENT.species[speciesId]!.types[0]!;
  const typed = Object.values(PROGRESSION.items).find((i) => i.kind === "held" && i.mods?.typeDamage?.[type]);
  return typed?.id ?? "muscle-band";
}
const withItem = (m: PartyMember): PartyMember => ({ ...m, heldItem: bestHeldItem(m.speciesId) });

/** A Pokémon raised from level 1 to `level` through XP (so it evolves), developing at every level. */
function raise(species: string, level: number, pick: Pick, seed: number): PartyMember {
  let m = develop(newMember(CONTENT, PROGRESSION, species, seed, 1), pick, seed);
  while (m.level < level) {
    m = gainXp(CONTENT, PROGRESSION, m, xpToNext(PROGRESSION, m.level) - m.xp).member;
    m = develop(m, pick, seed);
  }
  const max = memberStats(CONTENT, PROGRESSION, m).maxHp;
  // A player swaps in newly learned moves when the loadout is full; the default loadout (latest learned) stands in for that.
  return withItem({ ...m, hp: max, activeMoves: defaultActiveMoves(CONTENT, PROGRESSION, m.speciesId, m.knownMoves) });
}

/** Combo events tallied across battles, by side (reset by the sections that report them). */
const combos = { player: 0, enemy: 0 };

/** `foeAi` drives the team listed second (the wild side), whichever side it plays. */
function battle(players: Omit<UnitSetup, "id" | "side" | "pos">[], enemies: Omit<UnitSetup, "id" | "side" | "pos">[], seed: number, ai: { player?: AiWeights; enemy?: AiWeights } = {}) {
  const units: UnitSetup[] = [
    ...players.map((p, i) => ({ ...p, id: `p${i}`, side: "player" as const, pos: START[i]! })),
    ...enemies.map((e, i) => ({ ...e, id: `e${i}`, side: "enemy" as const, pos: { x: arena[0]!.length - 1 - START[i]!.x, y: START[(i + seed) % 3]!.y } })),
  ];
  let { state } = createBattle(CONTENT, arena, units);
  for (let i = 0; i < 600 && state.outcome === "ongoing"; i++)
    for (const a of planTurn(state, CONTENT, (state.turn?.unitId.startsWith("p") ? ai.player : ai.enemy))) if (state.outcome === "ongoing") {
      const r = applyAction(state, CONTENT, a);
      for (const e of r.events) if (e.type === "combo") combos[e.unitId.startsWith("p") ? "player" : "enemy"]++;
      state = r.state;
    }
  return state;
}

/**
 * Team A vs team B, played twice with sides swapped (the side that moves first tends to walk into
 * the other's range, so one game alone is biased). `win` is A's share of the two games.
 */
function fight(a: Omit<UnitSetup, "id" | "side" | "pos">[], b: Omit<UnitSetup, "id" | "side" | "pos">[], seed: number, bAi?: AiWeights) {
  const g1 = battle(a, b, seed, { enemy: bAi });
  const g2 = battle(b, a, seed, { player: bAi });
  const hpShare = (st: BattleState, side: "player" | "enemy") => {
    const us = st.units.filter((u) => u.side === side);
    return us.reduce((s, u) => s + u.hp, 0) / us.reduce((s, u) => s + u.maxHp, 0);
  };
  const win = ((g1.outcome === "victory" ? 1 : 0) + (g2.outcome === "defeat" ? 1 : 0)) / 2;
  return {
    win, outcome: win >= 0.5 ? "victory" : "defeat", rounds: (g1.round + g2.round) / 2,
    alive: g1.units.filter((u) => u.side === "player" && u.hp > 0).length,
    hpLeft: (hpShare(g1, "player") + hpShare(g2, "enemy")) / 2,
    timeouts: (g1.outcome === "ongoing" ? 1 : 0) + (g2.outcome === "ongoing" ? 1 : 0),
  };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

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

  // 3) Role value in mixed teams: three different species against a wild group; one member at a time
  // switches between its two roles while the rest stays fixed, so each role is judged in a real team.
  console.log("=== role swap in mixed teams vs wild, L15 (16 teams × 3 members × 2 roles × 2 sides) ===");
  {
    const dual = STARTERS.filter((sp) => (CONTENT.species[sp]!.roles ?? []).length === 2);
    const score: Record<string, { win: number; n: number }> = {};
    for (let seed = 0; seed < 16; seed++) {
      const r = (k: number) => nextRandom(seed * 53 + k).value;
      const team: string[] = [];
      for (let k = 0; team.length < 3; k++) {
        const sp = dual[Math.floor(r(k) * dual.length)]!;
        if (!team.includes(sp)) team.push(sp);
      }
      const foes = [10, 11, 12].map((k) => wildSetup(CONTENT, PROGRESSION, STARTERS[Math.floor(r(k) * STARTERS.length)]!, 15));
      const base = team.map((sp) => CONTENT.species[sp]!.roles![seed % 2]!);
      const mk = (roles: string[]) => team.map((sp, i) => toUnitSetup(CONTENT, PROGRESSION, raise(sp, 15, (o, sd) => (o.includes(roles[i]!) ? roles[i]! : seededPick(o, sd)), seed + i)));
      for (let i = 0; i < 3; i++) for (const role of CONTENT.species[team[i]!]!.roles!) {
        const roles = base.map((b, j) => (j === i ? role : b));
        const s = (score[role] ??= { win: 0, n: 0 });
        s.win += fight(mk(roles), foes, seed).win;
        s.n++;
      }
    }
    for (const [role, s] of Object.entries(score)) console.log(`  ${role.padEnd(12)} win ${pct(s.win / s.n)} over ${s.n} line-ups`);
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
  // 3c) Mixed teams: one setup role (Tank / Controller) + two payoff roles vs the same species in their other roles.
  console.log("=== mixed teams L15: setup + payoffs vs the same species' other roles (12 seeds × 2 sides) ===");
  {
    const SETUP = ["tank", "controller"];
    const dual = STARTERS.filter((sp) => (CONTENT.species[sp]!.roles ?? []).length === 2);
    let wins = 0;
    combos.player = combos.enemy = 0;
    for (let seed = 0; seed < 12; seed++) {
      const r = (k: number) => nextRandom(seed * 31 + k).value;
      const setupSp = dual.filter((sp) => CONTENT.species[sp]!.roles!.some((x) => SETUP.includes(x)));
      const team = [setupSp[Math.floor(r(0) * setupSp.length)]!, dual[Math.floor(r(1) * dual.length)]!, dual[Math.floor(r(2) * dual.length)]!];
      const want = team.map((sp, i) => {
        const roles = CONTENT.species[sp]!.roles!;
        const pick = roles.find((x) => (i === 0) === SETUP.includes(x)) ?? roles[0]!;
        return [pick, roles.find((x) => x !== pick)!] as const;
      });
      const mk = (k: 0 | 1) => team.map((sp, i) => toUnitSetup(CONTENT, PROGRESSION, raise(sp, 15, (o, sd) => (o.includes(want[i]![k]) ? want[i]![k] : seededPick(o, sd)), seed + i)));
      wins += fight(mk(0), mk(1), seed).win;
    }
    // fight() plays both ways, so each side's tally covers both teams once; report per game.
    console.log(`synergy team wins ${pct(wins / 12)}; combos per game ${((combos.player + combos.enemy) / 24).toFixed(1)}`);
  }

  // 4) Stat snapshots: how a line grows.
  console.log("=== growth snapshots (first role, first type) ===");
  for (const s of ["charmander", "squirtle", "pikachu", "geodude", "caterpie"]) {
    const row = [1, 5, 10, 15, 20, 30].map((lv) => {
      const m = raise(s, lv, firstPick, 1);
      const { stats, maxHp } = memberStats(CONTENT, PROGRESSION, m);
      return `L${lv} ${m.speciesId} HP${maxHp} A${stats.attack} D${stats.defense} SA${stats.spAttack} SD${stats.spDefense} S${stats.speed}`;
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
