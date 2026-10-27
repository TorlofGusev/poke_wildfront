// Suggests each line's own option for its archetype tree's skill rows (Lv 6/12/18/24): a move the line can learn,
// preferably of a type the row's shared options don't cover (the line's other types first), at a power that fits
// the row. Usage: node tools/line-options.mjs blaze,bloom,brawler
import fs from "node:fs";

const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const learn = read("tools/data/learnsets.json");
const canon = read("tools/data/canon-moves.json");
const species = read("src/content/species.json");
const moves = { ...read("src/content/mastery/moves.json"), ...read("src/content/moves.json") };
const trees = fs.readdirSync("src/content/mastery/archetypes").map((f) => read(`src/content/mastery/archetypes/${f}`));
const skill = (id) => (id.startsWith("skill:") ? id.slice(6) : null);
const focusMoves = new Set(trees.flatMap((a) => a.lines.flatMap((l) => l.focus.map((f) => skill(f.skill)))));
/** Canon effects the battle engine has no counterpart for (items, berries, switching, weather, terrain, IVs…). */
/** Moves too odd for a tree: no real effect here (Tera Blast) or a weak gimmick (False Swipe). */
const SKIP = new Set(["false-swipe", "tera-blast", "snore", "spit-up"]);
const UNSUPPORTED = /item|heals allies|berry|switch|weather|terrain|IVs|Pledge|sleeping|consecutive use by any|more than once per turn|Dive|fleeing|Ends wild/i;
/** Canon power that fits a row: [min, max]. */
const TIER = { 6: [35, 65], 12: [55, 80], 18: [70, 95], 24: [90, 150] };

const WRITE = process.argv.includes("--write");
for (const id of (process.argv[2] ?? "").split(",").filter(Boolean)) {
  const a = trees.find((t) => t.id === id);
  console.log(`\n== ${a.name} (${a.type})`);
  for (const l of a.lines) {
    const types = [...new Set(l.line.flatMap((s) => species[s].types))];
    const taken = new Set([...Object.values(a.rows).flat().map(skill), ...l.focus.map((f) => skill(f.skill)), ...l.line.flatMap((s) => species[s].moves)]);
    const can = [...new Set(l.line.flatMap((s) => learn[s] ?? []))].filter((m) => canon[m] && moves[m] && !taken.has(m) && !focusMoves.has(m) && canon[m].power && !UNSUPPORTED.test(canon[m].effect) && !SKIP.has(m));
    const used = new Set();
    const usedTypes = new Map();
    console.log(`${l.line[0]} [${types.join("/")}]`);
    for (const lv of ["6", "12", "18", "24"]) {
      const rowTypes = new Set(a.rows[lv].map(skill).filter(Boolean).map((m) => canon[m]?.type));
      const [lo, hi] = TIER[lv];
      const score = (m) => {
        const c = canon[m];
        const t = c.type;
        // The line's other types first, then any type the row lacks; a type the line's own options already use counts less.
        const fit = types.includes(t) && !rowTypes.has(t) ? 0 : !rowTypes.has(t) && t !== "normal" ? 1 : 2;
        return fit * 1000 + 1100 * (usedTypes.get(t) ?? 0) + Math.abs(c.power - (lo + hi) / 2);
      };
      const picks = can.filter((m) => !used.has(m) && canon[m].power >= lo && canon[m].power <= hi).sort((x, y) => score(x) - score(y)).slice(0, 4);
      if (picks[0]) { used.add(picks[0]); usedTypes.set(canon[picks[0]].type, (usedTypes.get(canon[picks[0]].type) ?? 0) + 1); }
      if (WRITE && picks[0] && !l.rows?.[lv]) (l.rows ??= {})[lv] = `skill:${picks[0]}`;
      console.log(`  Lv${lv} shared ${a.rows[lv].map(skill).map((m) => `${m}(${canon[m]?.type})`).join(", ")} | own: ${picks.map((m) => `${m}(${canon[m].type} ${canon[m].power})`).join(", ")}`);
    }
  }
  if (WRITE) fs.writeFileSync(`src/content/mastery/archetypes/${id}.json`, JSON.stringify(a, null, 1) + "\n");
}
