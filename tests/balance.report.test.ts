import { it } from "vitest";
import process from "node:process";
import { CONTENT, PROGRESSION } from "../src/content";
import { planTurn } from "../src/core/ai";
import { applyAction, createBattle, movementPoints } from "../src/core/battle";
import { newMember } from "../src/core/party";
import { toUnitSetup, wildSetup } from "../src/core/progression";

const arena = ["............", "..\"\"........", "......#.....", "..##........", "......\"\"....", "......\"\"..#.", "....#.......", "............"];
function fight(team: string[], foes: [string, number][], seed: number) {
  const players = team.map((s, i) => ({ ...toUnitSetup(CONTENT, PROGRESSION, newMember(CONTENT, PROGRESSION, s, i, 5)), id: `p${i}`, side: "player" as const, pos: { x: 1, y: 2 + i * 2 } }));
  const spawns = [{ x: 10, y: 1 }, { x: 10, y: 4 }, { x: 11, y: 6 }, { x: 9, y: 2 }];
  const enemies = foes.map(([s, lv], i) => ({ ...wildSetup(CONTENT, PROGRESSION, s, lv), id: `e${i}`, side: "enemy" as const, pos: spawns[(i + seed) % 4]! }));
  let { state } = createBattle(CONTENT, arena, [...players, ...enemies]);
  for (let i = 0; i < 400 && state.outcome === "ongoing"; i++)
    for (const a of planTurn(state, CONTENT)) if (state.outcome === "ongoing") state = applyAction(state, CONTENT, a).state;
  return { outcome: state.outcome, rounds: state.round, alive: state.units.filter((u) => u.side === "player" && u.hp > 0).length };
}
/**
 * AI-vs-AI balance report (not a pass/fail test). Run with:
 *   BALANCE=1 npx vitest run tests/balance.report.test.ts --silent=false
 */
it.skipIf(!process.env.BALANCE)("balance report", () => {
  const show = (s: string, lv: number) => {
    const u = wildSetup(CONTENT, PROGRESSION, s, lv);
    const { state } = createBattle(CONTENT, ["...."], [{ ...u, id: "x", side: "player", pos: { x: 0, y: 0 } }]);
    return `${s} L${lv} stats=${JSON.stringify(u.stats)} hp=${u.maxHp} move=${movementPoints(CONTENT, state.units[0]!)}`;
  };
  for (const [s, l] of [["pikachu", 5], ["charmander", 5], ["pidgey", 5], ["rattata", 3], ["rattata", 4], ["geodude", 5]] as const) console.log(show(s, l));
  for (const [team, foes] of [
    [["pikachu", "charmander", "pidgey"], [["rattata", 3], ["rattata", 4], ["rattata", 4]]],
    [["pikachu", "charmander", "pidgey"], [["rattata", 4], ["pidgey", 4], ["spearow", 4]]],
    [["bulbasaur", "squirtle", "geodude"], [["caterpie", 5], ["weedle", 5], ["oddish", 4], ["pikachu", 4]]],
    [["pikachu", "charmander"], [["rattata", 4], ["rattata", 4], ["rattata", 4]]],
    [["pikachu", "charmander", "pidgey"], [["mankey", 8], ["spearow", 8], ["geodude", 8]]],
    [["pikachu", "charmander", "pidgey"], [["zubat", 9], ["diglett", 9], ["geodude", 9], ["zubat", 9]]],
  ] as [string[], [string, number][]][]) {
    const res = [0, 1, 2].map((seed) => fight(team, foes, seed));
    console.log(team.join("/"), "vs", foes.map((f) => f.join("")).join(","), JSON.stringify(res));
  }
});
