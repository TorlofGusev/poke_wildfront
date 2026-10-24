import type { BattleContent, BattleScenario } from "../core/battle";
import balls from "./balls.json";
import capture from "./capture.json";
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
