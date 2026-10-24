import type { BattleContent, BattleScenario, DeployCandidate } from "../core/battle";
import moves from "./moves.json";
import rules from "./rules.json";
import viridianForestAmbush from "./scenarios/viridian-forest-ambush.json";
import species from "./species.json";
import statuses from "./statuses.json";
import typeChart from "./typeChart.json";

export const CONTENT: BattleContent = {
  species,
  moves: moves as BattleContent["moves"],
  statuses,
  typeChart,
  rules,
};

export const SCENARIOS: Readonly<Record<string, BattleScenario & { name: string }>> = {
  [viridianForestAmbush.id]: viridianForestAmbush as BattleScenario & { name: string },
};

/** Prototype starting party until the party/save system exists (Phase 3). */
export const PROTOTYPE_PARTY: readonly DeployCandidate[] = [
  "bulbasaur", "charmander", "squirtle", "pikachu", "geodude", "pidgey",
].map((speciesId) => ({ id: `party-${speciesId}`, speciesId, hp: Math.round(species[speciesId as keyof typeof species].stats.hp * rules.hpMultiplier) }));
