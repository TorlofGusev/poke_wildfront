// Lists the canon moves an archetype's lines can learn, to author archetype trees by hand.
// Usage: node tools/archetype-moves.mjs rattata,tauros,kangaskhan,meowth
//   "common": moves every line can learn (row skill candidates), then per line its other moves (focus candidates).
import fs from "node:fs";

const learn = JSON.parse(fs.readFileSync("tools/data/learnsets.json", "utf8"));
const canon = JSON.parse(fs.readFileSync("tools/data/canon-moves.json", "utf8"));
const lib = { ...JSON.parse(fs.readFileSync("src/content/mastery/moves.json", "utf8")), ...JSON.parse(fs.readFileSync("src/content/moves.json", "utf8")) };
// Evolution lines from species.json: first species → members in evolution order.
const species = JSON.parse(fs.readFileSync("src/content/species.json", "utf8"));
const into = (id) => (species[id].evolution ? species[id].evolution.choices ?? [species[id].evolution.into] : []);
const evolved = new Set(Object.keys(species).flatMap(into));
const lines = Object.fromEntries(Object.keys(species).filter((id) => !evolved.has(id)).map((first) => {
  const line = [first];
  for (let i = 0; i < line.length; i++) line.push(...into(line[i]));
  return [first, line];
}));
const firsts = (process.argv[2] ?? "").split(",").filter(Boolean);
const lineMoves = (first) => new Set(lines[first].flatMap((sp) => learn[sp] ?? []));
const fmt = (id) => {
  const c = canon[id];
  const m = lib[id];
  if (!c || !m) return null;
  const eff = (m.effects ?? []).map((e) => e.kind === "status" ? `${e.status}${e.duration}` : e.kind).join("+");
  return `${id} [${c.type} ${c.cls}${m.power ? ` P${m.power}` : ""} r${m.range.max}${m.shape.kind !== "single" ? ` ${m.shape.kind}${m.shape.radius ?? m.shape.length}` : ""}${eff ? ` ${eff}` : ""}]`;
};
const sets = firsts.map(lineMoves);
const common = [...sets[0]].filter((m) => sets.every((s) => s.has(m))).map(fmt).filter(Boolean).sort();
console.log(`COMMON to ${firsts.join(", ")} (${common.length}):\n  ${common.join("\n  ")}`);
for (const [i, f] of firsts.entries()) {
  const own = [...sets[i]].filter((m) => !sets.every((s) => s.has(m))).map(fmt).filter(Boolean).sort();
  console.log(`\n${f} (${lines[f].join("→")}) also learns (${own.length}):\n  ${own.join("\n  ")}`);
}
