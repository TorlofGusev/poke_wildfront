import { powerFromCanon, speciesStats, STAT_TOTAL, STAT_TOTAL_PER_STAGE, type Role, type BaseStats, type BattleContent, type BattleScenario, type MoveDef, type SpeciesDef, type TypeDef } from "../core/battle";
import type { BiomeDef, FatigueRules, WorldContent, WorldDef } from "../core/expedition";
import type { ItemDef, MasteryTree, ProgressionContent, TalentDef } from "../core/progression";
import type { CampRules, MealDef } from "../core/party";
import items from "./items.json";
import progression from "./progression.json";
import typeChart from "./typeChart.json";
import abilities from "./abilities.json";
import camp from "./camp.json";
import meals from "./meals.json";
import terms from "./terms.json";
import balls from "./balls.json";
import biomes from "./biomes.json";
import story from "./story.json";
import keyItems from "./keyItems.json";
import type { StoryStep } from "../core/story";
import capture from "./capture.json";
import fatigue from "./fatigue.json";
import baseMoves from "./moves.json";
import masteryMoves from "./mastery/moves.json";
import passiveData from "./mastery/passives.json";
import roleSwapData from "./mastery/roleSwaps.json";
import route2 from "./worlds/route-2.json";
import rules from "./rules.json";
import speciesData from "./species.json";
import types from "./types.json";
import statuses from "./statuses.json";
import { localized } from "./lang";
import whatsNew from "./whatsNew.json";

export const TYPES: Readonly<Record<string, TypeDef>> = localized("types.json", types) as Record<string, TypeDef>;

const moves: BattleContent["moves"] = Object.assign({}, masteryMoves as BattleContent["moves"], baseMoves as BattleContent["moves"]);
const talents: Record<string, TalentDef> = {};

/**
 * Archetype trees (docs/design/archetype-trees.md): lines grouped by type and role share one tree of rows;
 * each line brings its own Lv 3 focus. Row and focus entries are shared passives (mastery/passives.json),
 * the tree's own capstones, or `skill:<move id>` (a skill that teaches that canon move). Focus skills and the
 * strongest row skills (canon power ≥ progression bondCanonPower) are Bond moves, paid with Bond and hitting
 * harder, so a tree's big hits can't be spammed. Every move has one definition: a tree move turns Bond
 * everywhere. Pokémon start with a basic attack and one typed move (species.json); every other move comes
 * from the tree.
 */
export interface ArchetypeFile {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly rows: Readonly<Record<string, readonly string[]>>;
  /** Each line's focus, and its own extra option per skill row (a move of its other types or a signature move). */
  /** Each line's own options per row, after the shared ones (its utility moves, its basic attacks…). */
  readonly lines: readonly { readonly line: readonly string[]; readonly focus: MasteryTree["focus"]; readonly rows?: Readonly<Record<string, string | readonly string[]>> }[];
  readonly forms?: MasteryTree["forms"];
  readonly passives?: Readonly<Record<string, TalentDef>>;
  /** The tree's own moves (Ditto's). */
  readonly moves?: Readonly<Record<string, MoveDef>>;
  /** Copies any move (Ditto): its row skills need not be learnable. */
  readonly mimic?: boolean;
}
export const ARCHETYPES: readonly ArchetypeFile[] = Object.entries(import.meta.glob("./mastery/archetypes/*.json", { eager: true, import: "default" }) as Record<string, ArchetypeFile>)
  .map(([path, f]) => localized(path.slice(2), f));
Object.assign(talents, localized("mastery/passives.json", passiveData) as Record<string, TalentDef>, ...ARCHETYPES.map((a) => a.passives ?? {}));
Object.assign(moves, ...ARCHETYPES.map((a) => a.moves ?? {}));
const SKILL = "skill:";
/**
 * A line's tree only teaches moves of its role (melee or ranged). Archetype trees are shared by lines, so
 * a move of the other reach is swapped, line by line, for the first of its counterparts (same type, close in
 * canon power; mastery/roleSwaps.json, editable) the tree does not have yet.
 */
type SwapTable = Readonly<Record<string, readonly string[]>>;
/** Passives work the same way: one that only helps the other reach (Far Sight for a melee line) becomes a counterpart. */
const ROLE_SWAPS = roleSwapData as { readonly toMelee: SwapTable; readonly toRanged: SwapTable; readonly passivesToMelee: SwapTable; readonly passivesToRanged: SwapTable };
const roleOfSpecies = (id: string): Role | undefined => (speciesData as Record<string, { role?: Role }>)[id]?.role;
/** Every move some species starts with: a swap never brings one in, as a tree move would turn it Bond everywhere. */
const STARTING = new Set(Object.values(speciesData as Record<string, { moves: string[] }>).flatMap((s) => s.moves));
const moveOfSkill = (id: string) => (id.startsWith(SKILL) ? id.slice(SKILL.length) : null);
const strong = (id: string) => (moves[id]?.canonPower ?? 0) >= progression.bondCanonPower;
/** The tree as one species sees it: every skill of the other reach swapped for a counterpart of its role. */
function treeForRole(tree: MasteryTree, role: Role | undefined, start: readonly string[] = []): MasteryTree {
  if (!role) return tree;
  // A swap never brings in a move the species starts with, or one the tree already teaches.
  const used = new Set<string>(start);
  // Passives the tree already offers anywhere: a swapped passive never doubles one.
  const passives = new Set([...Object.values(tree.rows).flat(), ...Object.values(tree.forms ?? {}).flatMap((f) => Object.values(f.rows).flat())].filter((id) => !moveOfSkill(id)));
  const fit = (id: string): string => {
    const mv = moveOfSkill(id);
    if (!mv) {
      const swap = (role === "melee" ? ROLE_SWAPS.passivesToMelee : ROLE_SWAPS.passivesToRanged)[id]?.find((p) => !passives.has(p));
      if (!swap) return id;
      passives.add(swap);
      return swap;
    }
    const reach = mv ? moves[mv]?.reach : undefined;
    // A move the species already starts with: another of the same type and reach, closest in power.
    if (mv && start.includes(mv)) {
      const alt = Object.values(moves).filter((m) => m.type === moves[mv]?.type && m.reach === (reach ?? role) && m.kind !== "basic" && !used.has(m.id) && !start.includes(m.id) && (masteryMoves as Record<string, unknown>)[m.id])
        .sort((a, b) => Math.abs((a.canonPower ?? a.power) - (moves[mv]!.canonPower ?? moves[mv]!.power)) - Math.abs((b.canonPower ?? b.power) - (moves[mv]!.canonPower ?? moves[mv]!.power)) || (a.id < b.id ? -1 : 1))[0];
      if (alt) { used.add(alt.id); return SKILL + alt.id; }
    }
    if (!mv || !reach || reach === role) { if (mv) used.add(mv); return id; }
    const swap = (role === "melee" ? ROLE_SWAPS.toMelee : ROLE_SWAPS.toRanged)[mv]?.find((c) => !used.has(c) && !STARTING.has(c)) ?? mv;
    used.add(swap);
    return SKILL + swap;
  };
  const rowsFit = (rows: MasteryTree["rows"]) =>
    Object.fromEntries(Object.entries(rows).sort(([a], [b]) => Number(a) - Number(b)).map(([lv, opts]) => [lv, opts.map(fit)]));
  return {
    ...tree,
    rows: rowsFit(tree.rows),
    focus: tree.focus.map((f) => ({ ...f, skill: fit(f.skill) })),
    ...(tree.forms && { forms: Object.fromEntries(Object.entries(tree.forms).map(([id, f]) => [id, { rows: treeForRole({ ...tree, rows: f.rows, forms: undefined }, roleOfSpecies(id) ?? role, start).rows }])) }),
  };
}

const ownOptions = (l: ArchetypeFile["lines"][number], lv: string): readonly string[] => {
  const own = l.rows?.[lv];
  return own === undefined ? [] : typeof own === "string" ? [own] : own;
};
const ARCHETYPE_TREES: [string, MasteryTree][] = ARCHETYPES.flatMap((a) => a.lines.flatMap((l) => {
  const rows = Object.fromEntries(Object.entries(a.rows).map(([lv, opts]) => [lv, [...opts, ...ownOptions(l, lv)]]));
  const tree: MasteryTree = { line: l.line, focus: l.focus, rows, ...(a.forms && { forms: a.forms }) };
  return l.line.map((id) => [id, treeForRole(tree, roleOfSpecies(id), (speciesData as Record<string, { moves: string[] }>)[id]?.moves)] as [string, MasteryTree]);
}));

/**
 * The move each skill teaches. A move's kind (basic, special or Bond) is its own, in the move data: a row
 * offers moves of one kind, and the focus offers Bond moves.
 */
const taught = new Map<string, string>();
for (const a of ARCHETYPES) {
  for (const id of [a.rows, ...Object.values(a.forms ?? {}).map((f) => f.rows)].flatMap((r) => Object.values(r).flat())) {
    const mv = moveOfSkill(id);
    if (mv) taught.set(id, mv);
  }
  for (const l of a.lines) {
    for (const lv of Object.keys(l.rows ?? {})) for (const id of ownOptions(l, lv)) { const mv = moveOfSkill(id); if (mv) taught.set(id, mv); }
    for (const f of l.focus) { const mv = moveOfSkill(f.skill); if (mv) taught.set(f.skill, mv); }
  }
}
// The counterparts the lines actually got (role swaps) teach their moves the same way.
for (const [, tree] of ARCHETYPE_TREES) {
  for (const id of [...Object.values(tree.rows).flat(), ...Object.values(tree.forms ?? {}).flatMap((f) => Object.values(f.rows).flat()), ...tree.focus.map((f) => f.skill)]) {
    const mv = moveOfSkill(id);
    if (mv && !taught.has(id)) taught.set(id, mv);
  }
}
for (const [skill, id] of taught) {
  const move = moves[id];
  if (move && !talents[skill]) talents[skill] = { id: skill, name: move.name, description: "", grantsMove: move.id };
}


/** Evolution stage of each species: 0 for a first form, 1 for what it evolves into, 2 after that. */
const stageOf = (() => {
  const parent = new Map<string, string>();
  for (const [id, s] of Object.entries(speciesData)) {
    const into = (s as { evolution?: { into: string } }).evolution?.into;
    if (into) parent.set(into, id);
  }
  return (id: string): number => {
    let n = 0;
    for (let p = parent.get(id); p && n < 5; p = parent.get(p)) n++;
    return n;
  };
})();

/**
 * Species with level-1 stats: Speed from the role (with its types' lean), the rest from its types' playstyles,
 * plus a small nudge; every first form has the same total, each evolution stage a little more.
 */
const species: Record<string, SpeciesDef> = Object.fromEntries(
  Object.entries(speciesData).map(([id, s]) => [
    id,
    {
      ...s,
      stats: speciesStats(
        TYPES, s.types, (s as { statNudge?: Partial<BaseStats> }).statNudge, STAT_TOTAL + STAT_TOTAL_PER_STAGE * stageOf(id),
        (s as { role?: Role }).role ? rules.roleSpeed[(s as { role: Role }).role] : undefined,
        { min: 2, max: Math.min(10, 8 + stageOf(id)) },
      ),
    } as SpeciesDef,
  ]),
);

export const CONTENT: BattleContent = {
  terms: localized("terms.json", terms) as typeof terms,
  species,
  abilities: localized("abilities.json", abilities) as BattleContent["abilities"],
  types: TYPES,
  moves,
  statuses: localized("statuses.json", statuses) as typeof statuses,
  typeChart,
  rules,
  balls,
  capture,
};

export interface ScenarioDef extends BattleScenario {
  readonly name: string;
  /** Wild battles allow Poké Balls. */
  readonly captureAllowed?: boolean;
  /** Scripted battles can opt out of knockout counting. */
  readonly countsKnockouts?: boolean;
}

/** Extra biome files (one per region) merged over biomes.json, so regions can be authored separately. */
const REGION_BIOMES = import.meta.glob("./biomes/*.json", { eager: true, import: "default" }) as Record<string, Record<string, BiomeDef>>;

export const WORLD_CONTENT: WorldContent = {
  biomes: Object.assign({}, biomes as Record<string, BiomeDef>, ...Object.values(REGION_BIOMES)),
  fatigue: localized("fatigue.json", fatigue) as FatigueRules,
};


const WORLD_FILES = import.meta.glob("./worlds/*.json", { eager: true, import: "default" }) as Record<string, WorldDef>;

/** Every overworld map by id (every file in worlds/); the game starts on WORLD. */
export const WORLDS: Readonly<Record<string, WorldDef>> = Object.fromEntries(Object.entries(WORLD_FILES).map(([path, w]) => [w.id, localized(path.slice(2), w)]));

export const PROGRESSION: ProgressionContent = {
  trees: Object.fromEntries(ARCHETYPE_TREES),
  talents,
  keyItems: localized("keyItems.json", keyItems),
  items: localized("items.json", items) as unknown as Record<string, ItemDef>,
  rules: progression,
};

export const MEALS: Readonly<Record<string, MealDef>> = localized("meals.json", meals) as Record<string, MealDef>;
export const CAMP: CampRules = localized("camp.json", camp) as CampRules;

/** Where a new game starts: Pallet Town once it exists, else Route 2. */
export const WORLD: WorldDef = WORLDS["pallet-town"] ?? (route2 as unknown as WorldDef);

/** Main story goals in order (the HUD shows the first one not reached). */
export const STORY_STEPS: readonly StoryStep[] = localized("story.json", story).steps;

/** The player-facing changelog, newest first (What's new on the title screen). */
export const WHATS_NEW: readonly { readonly version: string; readonly date: string; readonly items: readonly string[] }[] = localized("whatsNew.json", whatsNew);
