import { speciesStats, type BaseStats, type BattleContent, type BattleScenario, type SpeciesDef, type TypeDef } from "../core/battle";
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
import skillVariants from "./skillVariants.json";
import route2 from "./worlds/route-2.json";
import rules from "./rules.json";
import speciesData from "./species.json";
import types from "./types.json";
import statuses from "./statuses.json";
import viridianForestAmbush from "./scenarios/viridian-forest-ambush.json";
import { localized } from "./lang";

export const TYPES: Readonly<Record<string, TypeDef>> = types as Record<string, TypeDef>;

/**
 * Mastery content (docs/design/mastery-trees.md): the library (mastery/library/**) holds shared skills and
 * passives with their moves; each tree file (mastery/trees/*.json) is one evolution line's hand-made tree and
 * may define its own line-unique moves and talents.
 */
interface MasteryFile {
  readonly moves?: Readonly<Record<string, unknown>>;
  readonly talents?: Readonly<Record<string, TalentDef>>;
  readonly variants?: Readonly<Record<string, Record<string, string>>>;
}
const LIBRARY = Object.entries(import.meta.glob(["./mastery/library/*/*.json"], { eager: true, import: "default" }) as Record<string, MasteryFile>)
  .map(([path, f]) => localized(path.slice(2), f));
const TREES = Object.entries(import.meta.glob("./mastery/trees/*.json", { eager: true, import: "default" }) as Record<string, MasteryFile & MasteryTree>)
  .map(([path, f]) => localized(path.slice(2), f));
const MASTERY_FILES: readonly MasteryFile[] = [...LIBRARY, ...TREES];

/** Library skills may come in a version per type (skillVariants.json: base move → type → name), ids `base--type`. */
const VARIANTS: Record<string, Record<string, string>> = Object.assign({}, skillVariants as Record<string, Record<string, string>>, ...MASTERY_FILES.map((k) => k.variants ?? {}));
const variantId = (base: string, type: string) => `${base}--${type}`;
const moves: BattleContent["moves"] = Object.assign({}, baseMoves as BattleContent["moves"], ...MASTERY_FILES.map((k) => k.moves ?? {}));
for (const [base, byType] of Object.entries(VARIANTS)) {
  const def = moves[base]!;
  for (const [type, name] of Object.entries(byType))
    (moves as Record<string, unknown>)[variantId(base, type)] = { ...def, id: variantId(base, type), name, type: (def.power ?? 0) > 0 ? type : def.type };
}
const talents: Record<string, TalentDef> = Object.assign({}, localized("talents.json", talentData), ...MASTERY_FILES.map((k) => k.talents ?? {}));

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
  trees: Object.fromEntries(TREES.flatMap((t) => t.line.map((id) => [id, t as MasteryTree]))),
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
