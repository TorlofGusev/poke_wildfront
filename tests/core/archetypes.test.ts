import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ARCHETYPES, CONTENT, PROGRESSION } from "../../src/content";
import learnsets from "../../tools/data/learnsets.json";
import canonMoves from "../../tools/data/canon-moves.json";
import passives from "../../src/content/mastery/passives.json";
import baseMoves from "../../src/content/moves.json";

/** docs/design/archetype-trees.md: the rules every archetype tree file follows. */
const LEVELS = ["4", "6", "9", "12", "15", "18", "21", "24", "27", "30"];
const SKILL_ROWS = new Set(["6", "12", "18", "24"]);
const FOCUS_STATS = new Set(["attack", "defense", "hp"]);
const learn = learnsets as Record<string, string[]>;
const canon = canonMoves as Record<string, { name: string; type: string } | null>;
const moveOf = (id: string) => (id.startsWith("skill:") ? id.slice(6) : null);
/** Every evolution line: first species → members in evolution order (branches side by side). */
const evolvesInto = (id: string) => { const e = CONTENT.species[id]!.evolution; return e ? (e.choices ?? [e.into]) : []; };
const evolved = new Set(Object.keys(CONTENT.species).flatMap(evolvesInto));
const LINES: Record<string, string[]> = Object.fromEntries(Object.keys(CONTENT.species).filter((id) => !evolved.has(id)).map((first) => {
  const line = [first];
  for (let i = 0; i < line.length; i++) line.push(...evolvesInto(line[i]!));
  return [first, line];
}));

describe("archetype trees", () => {
  it("each follows the row rhythm, uses known passives and skills, and only canon moves its lines can learn", () => {
    const problems: string[] = [];
    for (const a of ARCHETYPES) {
      const at = (msg: string) => problems.push(`${a.id}: ${msg}`);
      if (JSON.stringify(Object.keys(a.rows).sort((x, y) => +x - +y)) !== JSON.stringify(LEVELS)) at("rows must be exactly Lv 4,6,9,12,15,18,21,24,27,30");
      const canLearn = (move: string) => a.mimic || a.lines.every((l) => l.line.some((sp) => learn[sp]?.includes(move)));
      for (const [lv, opts] of Object.entries(a.rows)) {
        if (opts.length < 2 || opts.length > 3) at(`Lv ${lv}: 2 or 3 options`);
        if (new Set(opts).size !== opts.length) at(`Lv ${lv}: an option twice`);
        for (const id of opts) {
          const mv = moveOf(id);
          if (SKILL_ROWS.has(lv) !== !!mv) at(`Lv ${lv}: ${id} (skills at 6/12/18/24, passives elsewhere)`);
          if (mv) {
            if (!CONTENT.moves[mv]) at(`unknown move ${mv}`);
            else if (!canLearn(mv)) at(`Lv ${lv}: not every line can learn ${mv}`);
          } else if (!PROGRESSION.talents[id]) at(`unknown passive ${id}`);
          else if (lv !== "30" && !(id in passives) && !a.mimic) at(`Lv ${lv}: ${id} must come from the shared passives (own passives only as capstones)`);
        }
      }
      for (const l of a.lines) {
        if (JSON.stringify(LINES[l.line[0]!]) !== JSON.stringify(l.line)) at(`line ${l.line.join("→")} is not an evolution line`);
        if (l.focus.length !== 3) at(`${l.line[0]}: three focus options`);
        for (const [lv, id] of Object.entries(l.rows ?? {})) {
          const mv = moveOf(id);
          if (!SKILL_ROWS.has(lv) || !mv) at(`${l.line[0]}: own option ${id} at Lv ${lv} (own options are skills at 6/12/18/24)`);
          else if (!CONTENT.moves[mv]) at(`${l.line[0]}: unknown move ${mv}`);
          else if (!l.line.some((sp) => learn[sp]?.includes(mv))) at(`${l.line[0]}: cannot learn its own option ${mv}`);
          if (a.rows[lv]?.includes(id)) at(`${l.line[0]}: own option ${id} is already a shared option`);
          if ((a.rows[lv]?.length ?? 0) + 1 > 3) at(`${l.line[0]}: Lv ${lv} would offer more than 3 options`);
        }
        if (new Set(l.focus.map((f) => f.skill)).size !== l.focus.length) at(`${l.line[0]}: a focus skill twice`);
        for (const f of l.focus) {
          const mv = moveOf(f.skill);
          if (!FOCUS_STATS.has(f.stat)) at(`${l.line[0]}: focus on ${f.stat}`);
          if (a.mimic) { if (!PROGRESSION.talents[f.skill]) at(`unknown focus ${f.skill}`); continue; }
          if (!mv || !CONTENT.moves[mv]) at(`${l.line[0]}: focus ${f.skill} is not a known move`);
          else if (!l.line.some((sp) => learn[sp]?.includes(mv))) at(`${l.line[0]}: cannot learn ${mv}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("a branching evolution's form rows follow the same rules for that form", () => {
    const problems: string[] = [];
    for (const a of ARCHETYPES) for (const [form, f] of Object.entries(a.forms ?? {})) {
      const at = (msg: string) => problems.push(`${a.id}/${form}: ${msg}`);
      const line = a.lines.find((l) => l.line.includes(form))?.line;
      if (!line) at("not a member of the tree's lines");
      for (const [lv, opts] of Object.entries(f.rows)) {
        if (!LEVELS.includes(lv)) at(`Lv ${lv} is not a row level`);
        if (opts.length < 2 || opts.length > 3 || new Set(opts).size !== opts.length) at(`Lv ${lv}: 2 or 3 distinct options`);
        for (const id of opts) {
          const mv = moveOf(id);
          if (SKILL_ROWS.has(lv) !== !!mv) at(`Lv ${lv}: ${id} (skills at 6/12/18/24, passives elsewhere)`);
          if (mv) { if (!CONTENT.moves[mv] || !PROGRESSION.talents[id]) at(`unknown move ${mv}`); else if (!learn[form]?.includes(mv)) at(`${form} cannot learn ${mv}`); }
          else if (!PROGRESSION.talents[id]) at(`unknown passive ${id}`);
          else if (lv !== "30" && !(id in passives)) at(`Lv ${lv}: ${id} must come from the shared passives`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("each line's skill rows are varied: two types per row, every type of the line, at most two Normal attacks", () => {
    const problems: string[] = [];
    for (const a of ARCHETYPES) for (const l of a.lines) {
      if (a.mimic || a.forms) continue;
      const rows = [...SKILL_ROWS].map((lv) => [...a.rows[lv]!, ...(l.rows?.[lv] ? [l.rows[lv]!] : [])].map(moveOf).filter((m): m is string => !!m));
      const typeOf = (m: string) => canon[m]?.type ?? CONTENT.moves[m]!.type;
      rows.forEach((r, i) => { if (new Set(r.map(typeOf)).size < 2) problems.push(`${l.line[0]} Lv ${[...SKILL_ROWS][i]}: one type only`); });
      const offered = new Set(rows.flat().map(typeOf));
      for (const ty of new Set(l.line.flatMap((sp) => CONTENT.species[sp]!.types))) if (!offered.has(ty)) problems.push(`${l.line[0]}: no ${ty} skill`);
      const normal = rows.flat().filter((m) => typeOf(m) === "normal" && CONTENT.moves[m]!.power > 0).length;
      if (normal > 2 && !l.line.some((sp) => CONTENT.species[sp]!.types.includes("normal"))) problems.push(`${l.line[0]}: ${normal} Normal skills`);
    }
    expect(problems).toEqual([]);
  });

  it("a line's focuses grow its main stat: two pure (+2), one mixed with its second stat (+1/+1)", () => {
    const problems: string[] = [];
    for (const a of ARCHETYPES) for (const l of a.lines) {
      if (a.mimic) continue;
      const mains = new Set(l.focus.map((f) => f.stat));
      const mixed = l.focus.filter((f) => f.second);
      if (mains.size !== 1 || mixed.length !== 1 || mixed[0]!.second === mixed[0]!.stat) problems.push(`${l.line[0]}: ${JSON.stringify(l.focus)}`);
    }
    expect(problems).toEqual([]);
  });

  it("every species is in exactly one tree", () => {
    const counted = ARCHETYPES.flatMap((a) => a.lines.flatMap((l) => l.line));
    expect(counted.slice().sort()).toEqual(Object.keys(CONTENT.species).sort());
  });

  it("a move comes from one place: a line's tree never offers a move its species start with, and every move has one definition", () => {
    const problems: string[] = [];
    for (const a of ARCHETYPES) for (const l of a.lines) {
      const own = new Set(l.line.flatMap((sp) => CONTENT.species[sp]!.moves));
      const skills = [...Object.values(a.rows).flat(), ...Object.values(l.rows ?? {}), ...Object.values(a.forms ?? {}).flatMap((f) => Object.values(f.rows).flat()), ...l.focus.map((f) => f.skill)];
      for (const id of skills) if (own.has(moveOf(id) ?? "")) problems.push(`${a.id}: ${l.line[0]} starts with ${moveOf(id)}`);
    }
    const lib = JSON.parse(readFileSync("src/content/mastery/moves.json", "utf8")) as Record<string, unknown>;
    problems.push(...Object.keys(baseMoves).filter((id) => id in lib).map((id) => `${id} defined twice`));
    expect(problems).toEqual([]);
  });

  it("focus skills and the strongest row skills teach Bond moves; starting moves keep their kind", () => {
    const taught = (id: string) => CONTENT.moves[PROGRESSION.talents[id]!.grantsMove!]!;
    const problems: string[] = [];
    for (const a of ARCHETYPES) {
      for (const l of a.lines) for (const f of l.focus) if (taught(f.skill).kind !== "bond") problems.push(`${a.id}: focus ${f.skill}`);
      for (const id of [...Object.values(a.rows).flat(), ...a.lines.flatMap((l) => Object.values(l.rows ?? {}))]) {
        const mv = moveOf(id);
        if (!mv) continue;
        if (!PROGRESSION.talents[id]) { problems.push(`${a.id}: no talent ${id}`); continue; }
        const strong = (CONTENT.moves[mv]?.canonPower ?? 0) >= PROGRESSION.rules.bondCanonPower;
        if (strong !== (taught(id).kind === "bond")) problems.push(`${a.id}: ${id} Bond should be ${strong}`);
      }
    }
    expect(problems).toEqual([]);
    expect(Object.values(baseMoves).every((m) => CONTENT.moves[m.id]!.kind === m.kind), "base moves keep their kind").toBe(true);
  });

  it("covers every line at most once; a focus (Bond) move is never also a row skill", () => {
    const seen = new Map<string, string>();
    const rowMoves = new Set(ARCHETYPES.flatMap((a) => [...Object.values(a.rows).flat(), ...a.lines.flatMap((l) => Object.values(l.rows ?? {}))].map(moveOf).filter(Boolean)));
    const problems: string[] = [];
    for (const a of ARCHETYPES) for (const l of a.lines) {
      const first = l.line[0]!;
      if (seen.has(first)) problems.push(`${first} in ${seen.get(first)} and ${a.id}`);
      seen.set(first, a.id);
      for (const f of l.focus) if (rowMoves.has(moveOf(f.skill))) problems.push(`${first}: ${f.skill} is a focus Bond move and a row skill`);
    }
    expect(problems).toEqual([]);
  });

  it("every library move carries its canon name and type", () => {
    const lib = JSON.parse(readFileSync("src/content/mastery/moves.json", "utf8")) as Record<string, { name: string; type: string }>;
    const off = Object.entries(lib).filter(([id, m]) => canon[id] && (canon[id]!.name !== m.name || canon[id]!.type !== m.type)).map(([id]) => id);
    expect(off).toEqual([]);
  });
});
