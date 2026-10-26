import { it } from "vitest";
import process from "node:process";
import { CONTENT, PROGRESSION } from "../src/content";
import { planTurn } from "../src/core/ai";
import { applyAction, createBattle, STAT_NAMES, type UnitSetup } from "../src/core/battle";
import { newMember, type PartyMember } from "../src/core/party";
import {
  chooseRole, chooseTalent, defaultActiveMoves, gainXp, memberStats, pendingChoice, spendPoints, talentOptions, toUnitSetup, xpToNext,
} from "../src/core/progression";

/**
 * Mastery balance report (not a pass/fail test): for every role row with a choice, mirror teams that
 * differ only in that pick fight each other; ~50% means the options are even. Run with:
 *   TALENTS=1 npx vitest run tests/talentBalance.report.test.ts --silent=false
 */
const HALF = ["......", "..\"\"..", ".....#", "..##..", "......", "....\"\"", ".#....", "......"];
const arena = HALF.map((row) => row + [...row].reverse().join(""));
const START = [{ x: 1, y: 1 }, { x: 1, y: 3 }, { x: 1, y: 5 }];
const LEVEL = Number(process.env.TALENT_LEVEL ?? 20);
const SEEDS = 16;

/** Raises a Pokémon to LEVEL with the role, taking `force` whenever offered, else the first option. */
function raise(species: string, role: string, force: string | null, seed: number): PartyMember {
  const develop = (m: PartyMember): PartyMember => {
    let cur = m;
    for (let g = 0; g < 50; g++) {
      const p = pendingChoice(CONTENT, PROGRESSION, cur);
      if (p === "role") cur = chooseRole(CONTENT, PROGRESSION, cur, role);
      else if (p === "talent") {
        const o = talentOptions(CONTENT, PROGRESSION, cur);
        cur = chooseTalent(CONTENT, PROGRESSION, cur, force && o.includes(force) ? force : o[0]!);
      } else break;
    }
    const base = CONTENT.species[cur.speciesId]!.stats;
    const best = [...STAT_NAMES].filter((s) => s !== "hp").sort((a, b) => base[b] - base[a]);
    for (let i = 0; cur.unspentPoints > 0; i++) cur = spendPoints(cur, ([best[0]!, "hp", best[1]!] as const)[i % 3]!, 1, 1);
    return cur;
  };
  let m = develop(newMember(CONTENT, PROGRESSION, species, seed, 1));
  while (m.level < LEVEL) m = develop(gainXp(CONTENT, PROGRESSION, m, xpToNext(PROGRESSION, m.level) - m.xp).member);
  return { ...m, hp: memberStats(CONTENT, PROGRESSION, m).maxHp, activeMoves: defaultActiveMoves(CONTENT, PROGRESSION, m.speciesId, m.knownMoves) };
}

type Setup = Omit<UnitSetup, "id" | "side" | "pos">;
function battle(a: Setup[], b: Setup[], seed: number) {
  const units: UnitSetup[] = [
    ...a.map((p, i) => ({ ...p, id: `p${i}`, side: "player" as const, pos: START[i]! })),
    ...b.map((e, i) => ({ ...e, id: `e${i}`, side: "enemy" as const, pos: { x: arena[0]!.length - 1 - START[i]!.x, y: START[(i + seed) % 3]!.y } })),
  ];
  let { state } = createBattle(CONTENT, arena, units);
  for (let i = 0; i < 600 && state.outcome === "ongoing"; i++)
    for (const act of planTurn(state, CONTENT)) if (state.outcome === "ongoing") state = applyAction(state, CONTENT, act).state;
  return state.outcome;
}
/** A's win share over both side assignments. */
const duel = (a: Setup[], b: Setup[], seed: number) => ((battle(a, b, seed) === "victory" ? 1 : 0) + (battle(b, a, seed) === "defeat" ? 1 : 0)) / 2;

it.skipIf(!process.env.TALENTS)("mastery balance report", () => {
  const speciesFor = (role: string) => Object.values(CONTENT.species).filter((s) => s.roles?.includes(role)).map((s) => s.id);
  const teamOf = (role: string, force: string | null, seed: number, pool = speciesFor(role)) =>
    [0, 1, 2].map((i) => toUnitSetup(CONTENT, PROGRESSION, raise(pool[(seed * 3 + i) % pool.length]!, role, force, seed)));
  for (const [roleId, role] of Object.entries(PROGRESSION.roles)) {
    const rows = new Map<number, string[]>();
    for (const n of role.tree) rows.set(n.level, [...(rows.get(n.level) ?? []), n.talent]);
    for (const [level, opts] of rows) {
      if (opts.length < 2 || level > LEVEL) continue;
      let w = 0;
      for (let seed = 0; seed < SEEDS; seed++) w += duel(teamOf(roleId, opts[0]!, seed), teamOf(roleId, opts[1]!, seed), seed);
      console.log(`${roleId.padEnd(13)} L${String(level).padEnd(3)} ${opts[0]!.padEnd(20)} ${Math.round((w / SEEDS) * 100)}% vs ${opts[1]}`);
    }
  }
  // Roles against each other (first picks), on the same species: only those that can take either role.
  const ids = Object.keys(PROGRESSION.roles);
  for (const a of ids) {
    const line = ids.filter((b) => b !== a).map((b) => {
      const pool = speciesFor(a).filter((s) => CONTENT.species[s]!.roles?.includes(b));
      if (pool.length === 0) return `${b}:—`;
      let w = 0;
      for (let seed = 0; seed < 8; seed++) w += duel(teamOf(a, null, seed, pool), teamOf(b, null, seed, pool), seed);
      return `${b}:${Math.round((w / 8) * 100)}%(${pool.length})`;
    });
    console.log(`ROLE ${a.padEnd(13)} ${line.join(" ")}`);
  }
}, 1_800_000);
