import { describe, expect, it } from "vitest";
import { CONTENT, PROGRESSION } from "../../src/content";
import { NO_MODIFIERS } from "../../src/core/battle/modifiers";
import { movesKnownAt } from "../../src/core/progression";
import type { MasteryTree } from "../../src/core/progression";
import gen1LevelUp from "../../src/content/gen1LevelUp.json";

/** Gen 1 (Red/Blue/Yellow) level-up moves by species, from PokeAPI (src/content/gen1LevelUp.json). */
const GEN1 = gen1LevelUp as Record<string, string[]>;
const canonId = (name: string) => name.toLowerCase().replace(/[.'’]/g, "").replace(/\s+/g, "-");

/** The content rules of docs/design/mastery-trees.md, checked for every hand-made tree. */
const TREE_FILES = import.meta.glob("../../src/content/mastery/trees/*.json", { eager: true, import: "default" }) as Record<string, MasteryTree & { canonLevelUp?: string[]; talents?: Record<string, unknown>; moves?: Record<string, unknown> }>;
const LIBRARY_FILES = import.meta.glob("../../src/content/mastery/library/*/*.json", { eager: true, import: "default" }) as Record<string, { talents?: Record<string, unknown>; moves?: Record<string, unknown> }>;
const trees = Object.entries(TREE_FILES).map(([path, t]) => ({ file: path.split("/").pop()!, ...t }));
const LEVELS = [4, 6, 9, 12, 15, 18, 21, 24, 27, 30];
const SKILL_LEVELS = new Set([6, 12, 18, 24]);
/** How many trees one library passive or skill may appear in (keeps trees distinct). */
const MAX_LIBRARY_REUSE = 4;
const MAX_DESCRIPTION = 110;
/** The only moves whose damage uses another stat, as in the games. */
const CANON_SCALE: Readonly<Record<string, string>> = { "Body Press": "defense", "Electro Ball": "speed" };

const talent = (id: string) => PROGRESSION.talents[id];
const moveOf = (id: string) => (talent(id)?.grantsMove ? CONTENT.moves[talent(id)!.grantsMove!] : undefined);

function treeProblems(tree: (typeof trees)[number]): string[] {
  const out: string[] = [];
  const at = (msg: string) => out.push(`${tree.file}: ${msg}`);
  for (const id of tree.line) if (!CONTENT.species[id]) at(`unknown species ${id}`);
  // Skills are of the line's own types (evolutions included) or Normal; `canonLevelUp` lists the rare
  // off-type moves the line learns by level in the Gen 1 games (Butterfree's Psybeam). No TM moves.
  const lineTypes = new Set(["normal", ...tree.line.filter((id) => CONTENT.species[id]).flatMap((id) => CONTENT.species[id]!.types)]);
  for (const f of tree.focus) { const mv = moveOf(f.skill); if (mv && !lineTypes.has(mv.type) && !(tree.canonLevelUp ?? []).includes(mv.id)) at(`focus: ${mv.id} is ${mv.type}`); }
  const levelUp = new Set(tree.line.flatMap((id) => GEN1[id] ?? []));
  for (const id of tree.canonLevelUp ?? []) {
    const mv = CONTENT.moves[id];
    if (!mv || !levelUp.has(canonId(mv.name))) at(`canonLevelUp ${id} (${mv?.name}) is not a Gen 1 level-up move of the line`);
  }
  const natural = new Set(tree.line.filter((id) => CONTENT.species[id]).flatMap((id) => movesKnownAt(CONTENT.species[id]!, 99)));

  // Focus: three different stats, each with a Bond skill that scales with that stat.
  if (tree.focus.length !== 3) at(`${tree.focus.length} focuses (want 3)`);
  // Two focuses may share a stat (two Attack picks with different Bond skills), never a skill.
  if (new Set(tree.focus.map((f) => f.skill)).size !== tree.focus.length) at("a focus skill twice");
  for (const f of tree.focus) {
    const mv = moveOf(f.skill);
    if (!mv) { at(`focus ${f.stat}: ${f.skill} teaches no move`); continue; }
    // Damage follows the move's canon category; the focus is the build, not the damage stat.
    if (mv.scaleStat && CANON_SCALE[mv.name] !== mv.scaleStat) at(`focus ${f.stat}: ${mv.id} scales with ${mv.scaleStat}, not canon`);
    if (mv.kind !== "bond" || !mv.bondCost) at(`focus ${f.stat}: ${mv.id} is not a Bond move`);
    if (mv.power > 110) at(`focus ${f.stat}: ${mv.id} power ${mv.power}`);
  }

  // Rows: fixed levels, skills or passives, 2–3 options, each option once in the tree.
  const rowSets = [tree.rows, ...Object.values(tree.forms ?? {}).map((f) => ({ ...tree.rows, ...f.rows }))];
  for (const rows of rowSets) {
    const levels = Object.keys(rows).map(Number).sort((a, b) => a - b);
    if (levels.join() !== LEVELS.join()) at(`row levels ${levels.join()}`);
    if (Object.values(rows).filter((o) => o.length === 3).length > 3) at("more than 3 rows with 3 options");
    const seen = new Set(tree.focus.map((f) => f.skill));
    for (const [lv, options] of Object.entries(rows)) {
      if (options.length < 2 || options.length > 3) at(`Lv ${lv}: ${options.length} options`);
      for (const id of options) {
        if (seen.has(id)) at(`${id} twice`);
        seen.add(id);
        const tal = talent(id);
        if (!tal) { at(`Lv ${lv}: unknown talent ${id}`); continue; }
        const skill = SKILL_LEVELS.has(Number(lv));
        if (skill !== Boolean(tal.grantsMove)) at(`Lv ${lv}: ${id} is a ${tal.grantsMove ? "skill" : "passive"} in a ${skill ? "skill" : "passive"} row`);
        const mv = moveOf(id);
        if (mv && !lineTypes.has(mv.type) && !(tree.canonLevelUp ?? []).includes(mv.id)) at(`Lv ${lv}: ${mv.id} is ${mv.type}, not the line's type or Normal`);
        if (mv) {
          if (mv.scaleStat && CANON_SCALE[mv.name] !== mv.scaleStat) at(`Lv ${lv}: ${mv.id} scales with ${mv.scaleStat}, not canon`);
          if (!CONTENT.typeChart.chart[mv.type]) at(`Lv ${lv}: ${mv.id} has type ${mv.type}, not in this game`);
          if (natural.has(mv.id)) at(`Lv ${lv}: ${mv.id} is already in the line's learnset`);
          if (mv.kind !== "special" && mv.kind !== "bond") at(`Lv ${lv}: ${mv.id} kind ${mv.kind}`);
          if (mv.kind === "special" && !(mv.cooldown! >= 2 && mv.cooldown! <= 5)) at(`Lv ${lv}: ${mv.id} cooldown ${mv.cooldown}`);
          if (mv.kind !== "bond" && mv.range.max > 3) at(`Lv ${lv}: ${mv.id} range ${mv.range.max}`);
          if (mv.power > 100) at(`Lv ${lv}: ${mv.id} power ${mv.power}`);
        }
      }
    }
    // No two options of a tree share a name or a move name.
    const names = [...seen].map((id) => talent(id)?.name);
    const dupe = names.find((n, i) => n && names.indexOf(n) !== i);
    if (dupe) at(`name "${dupe}" twice`);
    const moveNames = [...seen].map((id) => moveOf(id)?.name).filter(Boolean);
    const dupeMove = moveNames.find((n, i) => moveNames.indexOf(n) !== i);
    if (dupeMove) at(`move "${dupeMove}" twice`);
  }
  for (const form of Object.keys(tree.forms ?? {})) if (!tree.line.includes(form)) at(`form ${form} not in the line`);
  return out;
}

describe("mastery trees", () => {
  it("every species belongs to exactly one tree", () => {
    const owner = new Map<string, string>();
    const problems: string[] = [];
    for (const t of trees) for (const id of t.line) {
      if (owner.has(id)) problems.push(`${id} in ${owner.get(id)} and ${t.file}`);
      owner.set(id, t.file);
    }
    for (const id of Object.keys(CONTENT.species)) if (!owner.has(id)) problems.push(`${id} has no tree`);
    expect(problems).toEqual([]);
  });

  it("every tree follows the content rules", () => {
    expect(trees.flatMap(treeProblems)).toEqual([]);
  });

  it("talents and moves are defined once, with known modifiers and short texts", () => {
    const problems: string[] = [];
    const defined = new Map<string, string>();
    for (const [path, f] of [...Object.entries(TREE_FILES), ...Object.entries(LIBRARY_FILES)]) {
      for (const id of [...Object.keys(f.talents ?? {}).map((k) => `talent:${k}`), ...Object.keys(f.moves ?? {}).map((k) => `move:${k}`)]) {
        if (defined.has(id)) problems.push(`${id} in ${defined.get(id)} and ${path}`);
        defined.set(id, path);
      }
    }
    const ids = new Set(trees.flatMap((t) => [...t.focus.map((f) => f.skill), ...Object.values(t.rows).flat(), ...Object.values(t.forms ?? {}).flatMap((f) => Object.values(f.rows).flat())]));
    for (const id of ids) {
      const tal = talent(id);
      if (!tal) continue;
      for (const k of Object.keys(tal.mods ?? {})) if (!(k in NO_MODIFIERS)) problems.push(`${id}: unknown modifier ${k}`);
      if (tal.description.length > MAX_DESCRIPTION) problems.push(`${id}: description ${tal.description.length} chars`);
    }
    expect(problems).toEqual([]);
  });

  it("skill texts quote the move's real distances", () => {
    const problems: string[] = [];
    for (const [id, tal] of Object.entries(PROGRESSION.talents)) {
      const mv = tal.grantsMove ? CONTENT.moves[tal.grantsMove] : undefined;
      if (!mv) continue;
      const real = new Set([mv.range.min, mv.range.max, mv.shape.kind === "burst" ? mv.shape.radius : -1, mv.shape.kind === "line" ? mv.shape.length : -1,
        ...(mv.effects ?? []).flatMap((e) => ("distance" in e ? [e.distance] : []))]);
      for (const m of tal.description.matchAll(/(\d+)(?:-hex| hex)/g)) if (!real.has(Number(m[1]))) problems.push(`${id}: "${tal.description}"`);
    }
    expect([...new Set(problems)]).toEqual([]);
  });

  it(`a library talent appears in at most ${MAX_LIBRARY_REUSE} trees`, () => {
    const uses = new Map<string, string[]>();
    for (const t of trees) {
      const own = new Set(Object.keys(t.talents ?? {}));
      for (const id of new Set([...Object.values(t.rows).flat(), ...Object.values(t.forms ?? {}).flatMap((f) => Object.values(f.rows).flat())]))
        if (!own.has(id)) uses.set(id, [...(uses.get(id) ?? []), t.file]);
    }
    expect([...uses].filter(([, files]) => files.length > MAX_LIBRARY_REUSE).map(([id, files]) => `${id}: ${files.join(", ")}`)).toEqual([]);
  });
});
