import { powerFromCanon, speciesStats, type BaseStats, type BattleContent, type BattleScenario, type MoveDef, type SpeciesDef, type TypeDef } from "../core/battle";
import type { BiomeDef, FatigueRules, WorldContent, WorldDef } from "../core/expedition";
import type { ItemDef, MasteryTree, ProgressionContent, TalentDef } from "../core/progression";
import type { CampRules, MealDef } from "../core/party";
import items from "./items.json";
import progression from "./progression.json";
import talentData from "./talents.json";
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
import route2 from "./worlds/route-2.json";
import rules from "./rules.json";
import speciesData from "./species.json";
import types from "./types.json";
import statuses from "./statuses.json";
import viridianForestAmbush from "./scenarios/viridian-forest-ambush.json";
import { localized } from "./lang";

export const TYPES: Readonly<Record<string, TypeDef>> = types as Record<string, TypeDef>;

const moves: BattleContent["moves"] = Object.assign({}, masteryMoves as BattleContent["moves"], baseMoves as BattleContent["moves"]);
const talents: Record<string, TalentDef> = { ...localized("talents.json", talentData) };

/**
 * Archetype trees (docs/design/archetype-trees.md): lines grouped by type and role share one tree of rows;
 * each line brings its own Lv 3 focus. Row and focus entries are shared passives (mastery/passives.json),
 * the tree's own capstones, or `skill:<move id>` (a skill that teaches that canon move). Focus skills and the
 * strongest row skills (canon power ≥ progression bondCanonPower) are Bond moves, paid with Bond and hitting
 * harder, so a tree's big hits can't be spammed. A library move turns Bond everywhere (one definition per
 * move); a species' own move (moves.json) stays as it is and the skill teaches its Bond version `<id>--bond`.
 */
export interface ArchetypeFile {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly rows: Readonly<Record<string, readonly string[]>>;
  readonly lines: readonly { readonly line: readonly string[]; readonly focus: MasteryTree["focus"] }[];
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
const BOND = "--bond";
const moveOfSkill = (id: string) => (id.startsWith(SKILL) ? id.slice(SKILL.length) : null);
const strong = (id: string) => (moves[id]?.canonPower ?? 0) >= progression.bondCanonPower;
/** A species' own move (moves.json) keeps its kind; its Bond version is `<id>--bond`. Library moves turn Bond in place. */
const bondOf = (id: string) => (id in baseMoves && moves[id]?.kind !== "bond" ? `${id}${BOND}` : id);
/** The move each skill teaches: focus skills (`skill:<own move>--bond` for a species' own move) and strong row skills teach a Bond move. */
const taught = new Map<string, string>();
const bonds = new Set<string>();
const teach = (skill: string, id: string, bond: boolean) => { taught.set(skill, id); if (bond) bonds.add(id); };
for (const a of ARCHETYPES) {
  for (const id of [a.rows, ...Object.values(a.forms ?? {}).map((f) => f.rows)].flatMap((r) => Object.values(r).flat())) { const mv = moveOfSkill(id); if (mv) teach(id, strong(mv) ? bondOf(mv) : mv, strong(mv)); }
  for (const l of a.lines) for (const f of l.focus) { const mv = moveOfSkill(f.skill); if (mv) teach(f.skill, mv.endsWith(BOND) ? mv : bondOf(mv), true); }
}
for (const id of bonds) {
  const def = moves[id.endsWith(BOND) ? id.slice(0, -BOND.length) : id];
  if (!def || moves[id]?.kind === "bond") continue;
  const strongMove = (def.canonPower ?? 0) >= progression.bondCanonPower;
  const bond = { ...def, id, kind: "bond" as const, bondCost: strongMove ? 3 : 2 };
  delete (bond as { cooldown?: number }).cooldown;
  (moves as Record<string, MoveDef>)[id] = def.canonPower ? { ...bond, power: powerFromCanon(rules.movePower, bond, def.canonPower) } : bond;
}
for (const [skill, id] of taught) {
  const move = moves[id];
  if (move && !talents[skill]) talents[skill] = { id: skill, name: move.name, description: "", grantsMove: move.id };
}
const ARCHETYPE_TREES: [string, MasteryTree][] = ARCHETYPES.flatMap((a) => a.lines.flatMap((l) => {
  const tree: MasteryTree = { line: l.line, focus: l.focus, rows: a.rows, ...(a.forms && { forms: a.forms }) };
  return l.line.map((id) => [id, tree] as [string, MasteryTree]);
}));

/** Species with level-1 stats derived from their types' playstyles plus a small nudge. */
const species: Record<string, SpeciesDef> = Object.fromEntries(
  Object.entries(speciesData).map(([id, s]) => [
    id,
    { ...s, stats: speciesStats(TYPES, s.types, (s as { statNudge?: Partial<BaseStats> }).statNudge) } as SpeciesDef,
  ]),
);

export const CONTENT: BattleContent = {
  terms,
  species,
  abilities: localized("abilities.json", abilities) as BattleContent["abilities"],
  types: TYPES,
  moves,
  statuses,
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

export const SCENARIOS: Readonly<Record<string, ScenarioDef>> = {
  [viridianForestAmbush.id]: viridianForestAmbush as ScenarioDef,
};

/** Extra biome files (one per region) merged over biomes.json, so regions can be authored separately. */
const REGION_BIOMES = import.meta.glob("./biomes/*.json", { eager: true, import: "default" }) as Record<string, Record<string, BiomeDef>>;

export const WORLD_CONTENT: WorldContent = {
  biomes: Object.assign({}, biomes as Record<string, BiomeDef>, ...Object.values(REGION_BIOMES)),
  fatigue: fatigue as FatigueRules,
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
