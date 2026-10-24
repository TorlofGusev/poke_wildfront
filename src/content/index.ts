import { speciesStats, type BaseStats, type BattleContent, type BattleScenario, type SpeciesDef, type TypeDef } from "../core/battle";
import type { BiomeDef, FatigueRules, WorldContent, WorldDef } from "../core/expedition";
import type { ItemDef, ProgressionContent, RoleDef, TalentDef } from "../core/progression";
import items from "./items.json";
import progression from "./progression.json";
import roles from "./roles.json";
import talents from "./talents.json";
import typeChart from "./typeChart.json";
import abilities from "./abilities.json";
import balls from "./balls.json";
import biomes from "./biomes.json";
import capture from "./capture.json";
import fatigue from "./fatigue.json";
import moves from "./moves.json";
import route2 from "./worlds/route-2.json";
import rules from "./rules.json";
import speciesData from "./species.json";
import types from "./types.json";
import statuses from "./statuses.json";
import viridianForestAmbush from "./scenarios/viridian-forest-ambush.json";

export const TYPES: Readonly<Record<string, TypeDef>> = types as Record<string, TypeDef>;

/** Species with level-1 stats derived from their types' playstyles plus a small nudge. */
const species: Record<string, SpeciesDef> = Object.fromEntries(
  Object.entries(speciesData).map(([id, s]) => [
    id,
    { ...s, stats: speciesStats(TYPES, s.types, (s as { statNudge?: Partial<BaseStats> }).statNudge) } as SpeciesDef,
  ]),
);

export const CONTENT: BattleContent = {
  species,
  abilities: abilities as BattleContent["abilities"],
  types: TYPES,
  moves: moves as BattleContent["moves"],
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

export const WORLD_CONTENT: WorldContent = {
  biomes: biomes as Record<string, BiomeDef>,
  fatigue: fatigue as FatigueRules,
};

export const WORLD: WorldDef = route2 as unknown as WorldDef; // shape checked by tests/content.test.ts

export const PROGRESSION: ProgressionContent = {
  roles: roles as Record<string, RoleDef>,
  talents: talents as Record<string, TalentDef>,
  items: items as unknown as Record<string, ItemDef>,
  rules: progression,
};
