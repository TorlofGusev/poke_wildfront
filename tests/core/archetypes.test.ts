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
/** A line's own options at a row (one id or a list). */
const ownAt = (l: (typeof ARCHETYPES)[number]["lines"][number], lv: string): string[] => { const o = l.rows?.[lv]; return o === undefined ? [] : typeof o === "string" ? [o] : [...o]; };
const ownAll = (l: (typeof ARCHETYPES)[number]["lines"][number]) => Object.keys(l.rows ?? {}).flatMap((lv) => ownAt(l, lv));
/**
 * A focus may teach a move its line cannot learn in canon only to fill a hole: a Bond move of one of the line's
 * types that fits its role, when the line can learn no Bond move of that type fitting its role (no canon melee
 * Bond moves of Bug for Scyther, Pinsir, Beedrill and Paras; none of Grass for Paras or of Rock for Aerodactyl).
 */
const fillsTypeHole = (line: readonly string[], mv: string): boolean => {
  const move = CONTENT.moves[mv];
  const role = CONTENT.species[line[line.length - 1]!]!.role;
  const fits = (m: (typeof CONTENT.moves)[string]) => m.kind === "bond" && (!m.reach || m.reach === role);
  if (!move || !fits(move) || !line.some((sp) => CONTENT.species[sp]!.types.includes(move.type))) return false;
  return !Object.values(CONTENT.moves).some((m) => m.type === move.type && fits(m) && line.some((sp) => learn[sp]?.includes(m.id)));
};
/** What each skill row offers (Lv 18: basic attacks, or skills where the line has too few). */
const ROW_KIND: Record<string, readonly string[]> = { "6": ["special"], "12": ["special"], "18": ["basic", "special"], "24": ["bond"] };
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
        // Skill rows may leave options to the lines (each line's own ones); passive rows offer 2 or 3.
        if (opts.length > 3 || (!SKILL_ROWS.has(lv) && opts.length < 2)) at(`Lv ${lv}: ${SKILL_ROWS.has(lv) ? "at most 3" : "2 or 3"} options`);
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
        if (l.focus.length < 2 || l.focus.length > 3) at(`${l.line[0]}: two or three focus options`);
        for (const lv of SKILL_ROWS) {
          const n = (a.rows[lv]?.length ?? 0) + ownAt(l, lv).length;
          if (!a.mimic && (n < 2 || n > 3)) at(`${l.line[0]}: Lv ${lv} offers ${n} options (2 or 3)`);
        }
        for (const [lv, id] of Object.keys(l.rows ?? {}).flatMap((lv) => ownAt(l, lv).map((id) => [lv, id] as const))) {
          const mv = moveOf(id);
          if (!SKILL_ROWS.has(lv) || !mv) at(`${l.line[0]}: own option ${id} at Lv ${lv} (own options are skills at 6/12/18/24)`);
          else if (!CONTENT.moves[mv]) at(`${l.line[0]}: unknown move ${mv}`);
          else if (!l.line.some((sp) => learn[sp]?.includes(mv))) at(`${l.line[0]}: cannot learn its own option ${mv}`);
          if (a.rows[lv]?.includes(id)) at(`${l.line[0]}: own option ${id} is already a shared option`);
        }
        if (new Set(l.focus.map((f) => f.skill)).size !== l.focus.length) at(`${l.line[0]}: a focus skill twice`);
        for (const f of l.focus) {
          const mv = moveOf(f.skill);
          if (!FOCUS_STATS.has(f.stat)) at(`${l.line[0]}: focus on ${f.stat}`);
          if (a.mimic) { if (!PROGRESSION.talents[f.skill]) at(`unknown focus ${f.skill}`); continue; }
          if (!mv || !CONTENT.moves[mv]) at(`${l.line[0]}: focus ${f.skill} is not a known move`);
          else if (!l.line.some((sp) => learn[sp]?.includes(mv)) && !fillsTypeHole(l.line, mv)) at(`${l.line[0]}: cannot learn ${mv}`);
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

  it("each skill row offers one kind of move, the focus Bond moves; every type of the line appears", () => {
    const problems: string[] = [];
    for (const a of ARCHETYPES) for (const l of a.lines) {
      if (a.mimic) continue;
      const tree = PROGRESSION.trees[l.line[0]!]!;
      for (const lv of SKILL_ROWS) {
        const kinds = new Set((tree.rows[lv] ?? []).map((id) => CONTENT.moves[PROGRESSION.talents[id]?.grantsMove ?? ""]?.kind));
        if (kinds.size !== 1 || !ROW_KIND[lv]!.includes([...kinds][0]!)) problems.push(`${l.line[0]} Lv ${lv}: ${[...kinds].join("+")}`);
      }
      for (const f of tree.focus) if (CONTENT.moves[PROGRESSION.talents[f.skill]!.grantsMove!]!.kind !== "bond") problems.push(`${l.line[0]}: focus ${f.skill} is not a Bond move`);
      const offered = new Set([...[...SKILL_ROWS].flatMap((lv) => tree.rows[lv] ?? []), ...tree.focus.map((f) => f.skill)].map((id) => CONTENT.moves[PROGRESSION.talents[id]!.grantsMove!]!.type));
      for (const ty of new Set(l.line.flatMap((sp) => CONTENT.species[sp]!.types))) if (!offered.has(ty)) problems.push(`${l.line[0]}: no ${ty} skill`);
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
    // Each species' own tree (after its role's swaps).
    for (const [sp, tree] of Object.entries(PROGRESSION.trees)) {
      const own = new Set(CONTENT.species[sp]!.moves);
      const skills = [...Object.values(tree.rows).flat(), ...Object.values(tree.forms?.[sp]?.rows ?? {}).flat(), ...tree.focus.map((f) => f.skill)];
      for (const id of skills) if (own.has(moveOf(id) ?? "")) problems.push(`${sp} starts with ${moveOf(id)}`);
    }
    const lib = JSON.parse(readFileSync("src/content/mastery/moves.json", "utf8")) as Record<string, unknown>;
    problems.push(...Object.keys(baseMoves).filter((id) => id in lib).map((id) => `${id} defined twice`));
    expect(problems).toEqual([]);
  });

  it("a move's kind is its own: Bond = canon power 85+, basic = weak plain hits, the rest special; starting skills stay special", () => {
    const problems: string[] = [];
    const starting = new Set(Object.values(CONTENT.species).flatMap((s) => s.moves));
    const ditto = new Set(ARCHETYPES.filter((a) => a.mimic).flatMap((a) => Object.keys(a.moves ?? {})));
    for (const m of Object.values(CONTENT.moves)) {
      if (starting.has(m.id) || ditto.has(m.id)) continue;
      const canonPower = m.canonPower ?? m.power;
      if (m.kind === "bond" && (m.power === 0 || canonPower < 85)) problems.push(`${m.id}: Bond under 85`);
      if (m.kind !== "bond" && m.power > 0 && canonPower >= 85 && m.kind !== "basic") problems.push(`${m.id}: 85+ but ${m.kind}`);
      if (m.kind === "bond" && m.cooldown) problems.push(`${m.id}: a Bond move with a cooldown`);
    }
    for (const s of Object.values(CONTENT.species)) for (const mv of s.moves) if (CONTENT.moves[mv]!.kind === "bond") problems.push(`${s.id} starts with Bond move ${mv}`);
    expect(problems).toEqual([]);
  });

  it("every species starts with a skill besides its basic attack (a tree's Bond move is never a starting move)", () => {
    const without = Object.values(CONTENT.species).filter((s) => !s.moves.some((m) => CONTENT.moves[m]?.kind === "special" || CONTENT.moves[m]?.kind === "ultimate"));
    expect(without.map((s) => s.id)).toEqual(["ditto"]);
  });

  it("covers every line at most once; a line's tree never offers a move twice", () => {
    const seen = new Map<string, string>();
    const problems: string[] = [];
    for (const a of ARCHETYPES) for (const l of a.lines) {
      const first = l.line[0]!;
      if (a.mimic) continue;
      if (seen.has(first)) problems.push(`${first} in ${seen.get(first)} and ${a.id}`);
      seen.set(first, a.id);
      const tree = PROGRESSION.trees[first]!;
      const offered = [...Object.values(tree.rows).flat(), ...tree.focus.map((f) => f.skill)].map(moveOf).filter(Boolean);
      if (new Set(offered).size !== offered.length) problems.push(`${first}: a move offered twice`);
    }
    expect(problems).toEqual([]);
  });

  it("every library move carries its canon name and type", () => {
    const lib = JSON.parse(readFileSync("src/content/mastery/moves.json", "utf8")) as Record<string, { name: string; type: string }>;
    const off = Object.entries(lib).filter(([id, m]) => canon[id] && (canon[id]!.name !== m.name || canon[id]!.type !== m.type)).map(([id]) => id);
    expect(off).toEqual([]);
  });
});
