import { Grid } from "../grid/Grid";
import { key, type Point } from "../grid/types";
import type { BattleContent } from "./content";
import { createBattle, type BattleOptions, type StepResult, type UnitSetup } from "./battle";

export const MAX_ACTIVE_UNITS = 3;

/** A hand-authored or generated battle before the player has deployed. */
export interface BattleScenario {
  readonly id: string;
  readonly mapRows: readonly string[];
  /** Tiles the player may deploy on. */
  readonly deploymentZone: readonly Point[];
  readonly enemies: readonly UnitSetup[];
  /** Enemy unit ids whose details are hidden until revealed in battle. */
  readonly hiddenEnemies?: readonly string[];
}

/** A party member available for deployment. */
export interface DeployCandidate {
  readonly id: string;
  readonly speciesId: string;
  readonly hp: number;
  /** Level, stats, moves and modifiers from progression; species defaults otherwise. */
  readonly setup?: Omit<UnitSetup, "id" | "side" | "pos" | "speciesId" | "hp">;
}

export interface Placement {
  readonly unitId: string;
  readonly pos: Point;
}

/** All problems with a proposed deployment; empty when it can be locked. */
export function deploymentErrors(
  scenario: BattleScenario,
  party: readonly DeployCandidate[],
  placements: readonly Placement[],
): string[] {
  const errors: string[] = [];
  const grid = Grid.fromAscii(scenario.mapRows);
  const zone = new Set(scenario.deploymentZone.map(key));
  const enemyTiles = new Set(scenario.enemies.map((e) => key(e.pos)));
  const usedUnits = new Set<string>();
  const usedTiles = new Set<string>();

  if (placements.length === 0) errors.push("deploy at least one Pokémon");
  if (placements.length > MAX_ACTIVE_UNITS) errors.push(`at most ${MAX_ACTIVE_UNITS} Pokémon can be deployed`);

  for (const p of placements) {
    const member = party.find((m) => m.id === p.unitId);
    if (!member) errors.push(`${p.unitId} is not in the party`);
    else if (member.hp <= 0) errors.push(`${p.unitId} cannot fight (0 HP)`);
    if (usedUnits.has(p.unitId)) errors.push(`${p.unitId} is placed twice`);
    usedUnits.add(p.unitId);
    const k = key(p.pos);
    if (!zone.has(k)) errors.push(`${k} is outside the deployment zone`);
    else if (!grid.isPassable(p.pos)) errors.push(`${k} is not passable`);
    if (enemyTiles.has(k)) errors.push(`${k} is occupied by an enemy`);
    if (usedTiles.has(k)) errors.push(`${k} has two Pokémon`);
    usedTiles.add(k);
  }
  return errors;
}

/** Locks the deployment and starts the battle. Throws if the deployment is invalid. */
export function lockDeployment(
  content: BattleContent,
  scenario: BattleScenario,
  party: readonly DeployCandidate[],
  placements: readonly Placement[],
  options: BattleOptions = {},
): StepResult {
  const errors = deploymentErrors(scenario, party, placements);
  if (errors.length > 0) throw new Error(`Invalid deployment: ${errors.join("; ")}`);
  const players: UnitSetup[] = placements.map((p) => {
    const member = party.find((m) => m.id === p.unitId)!;
    return { ...member.setup, id: member.id, speciesId: member.speciesId, side: "player", pos: p.pos, hp: member.hp };
  });
  return createBattle(content, scenario.mapRows, [...players, ...scenario.enemies], options);
}
