import type { BattleScenario, UnitSetup } from "../battle";
import { Grid } from "../grid/Grid";
import { reachableTiles } from "../grid/movement";
import type { TerrainDef } from "../grid/terrain";
import { key, samePoint, type Point } from "../grid/types";
import { randomInt } from "../rng";
import { generateEncounter, type EncounterTable } from "./encounters";
import { addTravelFatigue, type FatigueRules } from "./fatigue";

export interface ArenaDef {
  readonly mapRows: readonly string[];
  readonly deploymentZone: readonly Point[];
  readonly enemySpawns: readonly Point[];
}

export interface BiomeDef {
  readonly id: string;
  readonly name: string;
  /** Map character for this biome on the overworld. */
  readonly char: string;
  /** Fatigue per tile entered; null = impassable. */
  readonly travelCost: number | null;
  readonly encounters?: EncounterTable;
  readonly arena?: ArenaDef;
}

export interface WorldDef {
  readonly id: string;
  readonly name: string;
  readonly rows: readonly string[];
  readonly start: Point;
  readonly camps: readonly { readonly id: string; readonly name: string; readonly pos: Point }[];
  readonly spawnZones: readonly { readonly biome: string; readonly points: readonly Point[]; readonly count: number }[];
  readonly pickups: readonly { readonly id: string; readonly pos: Point; readonly balls: Readonly<Record<string, number>> }[];
}

export interface EncounterGroup {
  readonly id: string;
  readonly pos: Point;
  readonly biome: string;
  readonly species: readonly string[];
}

export interface WorldState {
  readonly pos: Point;
  readonly fatigue: number;
  readonly lastCamp: string;
  readonly encounters: readonly EncounterGroup[];
  readonly collected: readonly string[];
  readonly rngState: number;
  readonly nextEncounterId: number;
}

export interface WorldContent {
  readonly biomes: Readonly<Record<string, BiomeDef>>;
  readonly fatigue: FatigueRules;
}

export function worldGrid(content: WorldContent, def: WorldDef): Grid {
  const legend: Record<string, TerrainDef> = {};
  for (const b of Object.values(content.biomes)) {
    legend[b.char] = { id: b.id, moveCost: b.travelCost, blocksSight: false, concealsAtRange: false };
  }
  return Grid.fromAscii(def.rows, legend);
}

export const biomeAt = (content: WorldContent, def: WorldDef, p: Point): BiomeDef =>
  content.biomes[worldGrid(content, def).terrainAt(p).id]!;

export function newWorld(content: WorldContent, def: WorldDef, seed: number): WorldState {
  const base: WorldState = {
    pos: def.start, fatigue: 0, lastCamp: def.camps[0]!.id, encounters: [], collected: [], rngState: seed >>> 0, nextEncounterId: 1,
  };
  return respawnEncounters(content, def, base);
}

/** Replaces all wild groups with freshly rolled ones in every spawn zone. */
export function respawnEncounters(content: WorldContent, def: WorldDef, world: WorldState): WorldState {
  let rng = world.rngState;
  let nextId = world.nextEncounterId;
  const groups: EncounterGroup[] = [];
  for (const zone of def.spawnZones) {
    const table = content.biomes[zone.biome]?.encounters;
    if (!table) throw new Error(`biome ${zone.biome} has no encounter table`);
    const free = zone.points.filter((p) => !samePoint(p, world.pos));
    for (let i = 0; i < zone.count && free.length > 0; i++) {
      const idx = randomInt(rng, 0, free.length - 1);
      rng = idx.state;
      const pos = free.splice(idx.value, 1)[0]!;
      const rolled = generateEncounter(table, rng);
      rng = rolled.rngState;
      groups.push({ id: `wild${nextId++}`, pos, biome: zone.biome, species: rolled.species });
    }
  }
  return { ...world, encounters: groups, rngState: rng, nextEncounterId: nextId };
}

export interface TravelResult {
  readonly world: WorldState;
  /** Tiles walked, in order. */
  readonly path: readonly Point[];
  readonly pickedUp: readonly WorldDef["pickups"][number][];
  /** Set when the walk ended on a wild group. */
  readonly encounter: EncounterGroup | null;
}

/** Shortest (least tiring) path to `to`; wild groups block the way unless they are the destination. */
export function travelPath(content: WorldContent, def: WorldDef, world: WorldState, to: Point): Point[] | null {
  const grid = worldGrid(content, def);
  const blocked = new Set(world.encounters.filter((e) => !samePoint(e.pos, to)).map((e) => key(e.pos)));
  return reachableTiles(grid, world.pos, Number.MAX_SAFE_INTEGER, {
    isAlly: () => false,
    isEnemy: (p) => blocked.has(key(p)),
  }).pathTo(to);
}

export function travel(content: WorldContent, def: WorldDef, world: WorldState, to: Point): TravelResult {
  const path = travelPath(content, def, world, to);
  if (!path) throw new Error(`cannot travel to ${key(to)}`);
  const grid = worldGrid(content, def);
  let fatigue = world.fatigue;
  const collected = [...world.collected];
  const pickedUp: WorldDef["pickups"][number][] = [];
  for (const step of path) {
    fatigue = addTravelFatigue(content.fatigue, fatigue, grid.terrainAt(step).moveCost!);
    const pickup = def.pickups.find((p) => samePoint(p.pos, step) && !collected.includes(p.id));
    if (pickup) {
      collected.push(pickup.id);
      pickedUp.push(pickup);
    }
  }
  const encounter = world.encounters.find((e) => samePoint(e.pos, to)) ?? null;
  return { world: { ...world, pos: to, fatigue, collected }, path, pickedUp, encounter };
}

export function campAt(def: WorldDef, pos: Point) {
  return def.camps.find((c) => samePoint(c.pos, pos)) ?? null;
}

/** Making camp: fatigue to 0, remember the camp, respawn wild groups. HP is restored by the roster layer. */
export function makeCamp(content: WorldContent, def: WorldDef, world: WorldState): WorldState {
  const camp = campAt(def, world.pos);
  if (!camp) throw new Error("not at a camp site");
  return respawnEncounters(content, def, { ...world, fatigue: 0, lastCamp: camp.id });
}

/** After a defeat the party is carried back to the last camp and rests there. */
export function returnToLastCamp(content: WorldContent, def: WorldDef, world: WorldState): WorldState {
  const camp = def.camps.find((c) => c.id === world.lastCamp) ?? def.camps[0]!;
  return makeCamp(content, def, { ...world, pos: camp.pos });
}

export function removeEncounter(world: WorldState, id: string): WorldState {
  return { ...world, encounters: world.encounters.filter((e) => e.id !== id) };
}

/** Builds the battle for a wild group on its biome's arena. */
export function wildScenario(content: WorldContent, group: EncounterGroup): BattleScenario & { name: string; captureAllowed: boolean } {
  const biome = content.biomes[group.biome]!;
  const arena = biome.arena;
  if (!arena) throw new Error(`biome ${biome.id} has no arena`);
  if (group.species.length > arena.enemySpawns.length) throw new Error(`arena for ${biome.id} has too few spawn points`);
  const enemies: UnitSetup[] = group.species.map((speciesId, i) => ({
    id: `${group.id}-${i}`, speciesId, side: "enemy", pos: arena.enemySpawns[i]!,
  }));
  return {
    id: group.id, name: `Wild Pokémon · ${biome.name}`, mapRows: arena.mapRows, deploymentZone: arena.deploymentZone,
    enemies, captureAllowed: true,
  };
}
