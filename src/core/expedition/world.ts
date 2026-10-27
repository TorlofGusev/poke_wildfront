import { MAX_ACTIVE_UNITS, type BattleScenario, type UnitModifiers, type UnitSetup } from "../battle";
import { battleArena, formationLabel } from "../battle/arenaGen";
import { Grid } from "../grid/Grid";
import { reachableTiles } from "../grid/movement";
import type { TerrainDef } from "../grid/terrain";
import { key, manhattan, samePoint, type Point } from "../grid/types";

/** Wild groups never (re)spawn within this many tiles of the party. */
const SPAWN_CLEARANCE = 2;
import { nextRandom, randomInt } from "../rng";
import { generateEncounter, type EncounterTable } from "./encounters";
import { addTravelFatigue, type FatigueRules } from "./fatigue";
import type { Condition, NpcDef, ObstacleDef } from "../story/story";

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
  /** Food found after winning a wild battle here (item id → amount). */
  readonly forage?: Readonly<Record<string, number>>;
  /** Items that may turn up after a won wild battle here, each rolled separately. */
  readonly loot?: readonly { readonly item: string; readonly chance: number }[];
  readonly arena?: ArenaDef;
}

export interface WorldDef {
  readonly id: string;
  readonly name: string;
  readonly rows: readonly string[];
  readonly start: Point;
  readonly spawnZones: readonly {
    readonly biome: string;
    readonly points: readonly Point[];
    readonly count: number;
    /** Overrides the biome's levels, so later maps reuse biomes with stronger Pokémon. */
    readonly levels?: { readonly min: number; readonly max: number };
  }[];
  /** How cleverly its wild Pokémon fight: "tutorial" on the first map, then "novice", default "normal". */
  readonly ai?: "tutorial" | "novice" | "normal";
  /** How many Pokémon the player may deploy per battle here (default 3); wild groups never outnumber it. */
  readonly deploySlots?: number;
  /** Map-specific names for biomes, e.g. which town this is. */
  readonly areaNames?: Readonly<Record<string, string>>;
  /** Edge tiles leading to other maps. Without `to` the way is not open yet. */
  readonly exits?: readonly WorldExit[];
  readonly pickups: readonly WorldPickup[];
  /** Trainers, gym leaders, quest givers and wild bosses standing on this map. */
  readonly npcs?: readonly NpcDef[];
  /** Cut trees, boulders, guards… that block a tile until a condition holds. */
  readonly obstacles?: readonly ObstacleDef[];
}

/** What the party can pass right now: tiles blocked by NPCs/obstacles, and water once Surf is usable. */
export interface WorldAccess {
  readonly blocked: ReadonlySet<string>;
  readonly surf: boolean;
}

export interface WorldExit {
  readonly name: string;
  readonly pos: Point;
  readonly to?: string;
  /** Where the party appears on the target map. */
  readonly arrive?: Point;
  /** The way is shut until this holds (badges, Flash for dark caves…). */
  readonly requires?: Condition;
  readonly lockedText?: string;
}

export interface WorldPickup {
  readonly id: string;
  readonly pos: Point;
  readonly balls?: Readonly<Record<string, number>>;
  readonly items?: Readonly<Record<string, number>>;
  /** Found once at its fixed spot. Others refill after every rest, somewhere else in the same area. */
  readonly once?: boolean;
}

export interface EncounterGroup {
  readonly id: string;
  readonly pos: Point;
  readonly biome: string;
  readonly species: readonly string[];
  /** Level of each species entry. */
  readonly levels: readonly number[];
  /** Where it spawned: it wanders and gives up a chase within LEASH tiles of it. */
  readonly home?: Point;
  /** It has seen the party and is coming for it. */
  readonly chasing?: boolean;
}

export interface WorldState {
  /** Which map the party is on. */
  readonly mapId: string;
  readonly pos: Point;
  readonly fatigue: number;
  /** Where the party last made camp; defeat carries it back here. */
  readonly lastCamp: Point;
  readonly encounters: readonly EncounterGroup[];
  /** One-time pickups already taken. */
  readonly collected: readonly string[];
  /** Pickups lying on this map right now, at their rolled positions. */
  readonly pickups: readonly WorldPickup[];
  readonly rngState: number;
  readonly nextEncounterId: number;
  /** Effect of the last camp meal; lasts until the next rest. */
  readonly meal: ActiveMeal | null;
}

/** A meal's lasting effect, copied from its definition when eaten. */
export interface ActiveMeal {
  readonly id: string;
  readonly name: string;
  readonly bond?: { readonly startBond?: number; readonly maxBond?: number };
  readonly mods?: Partial<UnitModifiers>;
}

export interface WorldContent {
  readonly biomes: Readonly<Record<string, BiomeDef>>;
  readonly fatigue: FatigueRules;
}

export function worldGrid(content: WorldContent, def: WorldDef, access?: WorldAccess): Grid {
  const legend: Record<string, TerrainDef> = {};
  for (const b of Object.values(content.biomes)) {
    // Surf turns open water into a (tiring) route.
    const cost = b.travelCost === null && b.id === "water" && access?.surf ? 2 : b.travelCost;
    legend[b.char] = { id: b.id, moveCost: cost, blocksSight: false, concealsAtRange: false };
  }
  return Grid.fromAscii(def.rows, legend);
}

export const biomeAt = (content: WorldContent, def: WorldDef, p: Point): BiomeDef =>
  content.biomes[worldGrid(content, def).terrainAt(p).id]!;

/** Display name of the area at `p`: the map's own name for that biome, if it has one. */
export const areaName = (content: WorldContent, def: WorldDef, p: Point): string => {
  const biome = biomeAt(content, def, p);
  return def.areaNames?.[biome.id] ?? biome.name;
};

export const exitAt = (def: WorldDef, p: Point): WorldExit | undefined => def.exits?.find((e) => samePoint(e.pos, p));

/**
 * Walking through an open exit: the party arrives on the target map. Fatigue, the meal and
 * collected pickups carry over; the target map's wild groups are rolled fresh.
 */
export function changeMap(content: WorldContent, from: WorldState, target: WorldDef, arrive: Point): WorldState {
  return respawnEncounters(content, target, { ...from, mapId: target.id, pos: arrive, lastCamp: arrive, encounters: [] });
}

export function newWorld(content: WorldContent, def: WorldDef, seed: number): WorldState {
  const base: WorldState = {
    mapId: def.id, pos: def.start, fatigue: 0, lastCamp: def.start, encounters: [], collected: [], pickups: [], rngState: seed >>> 0, nextEncounterId: 1, meal: null,
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
    // Never spawn right on top of the party (e.g. after camping next to a spawn point).
    const free = zone.points.filter((p) => manhattan(p, world.pos) > SPAWN_CLEARANCE);
    for (let i = 0; i < zone.count && free.length > 0; i++) {
      const idx = randomInt(rng, 0, free.length - 1);
      rng = idx.state;
      const pos = free.splice(idx.value, 1)[0]!;
      const rolled = generateEncounter(zone.levels ? { ...table, levels: zone.levels } : table, rng);
      rng = rolled.rngState;
      groups.push({ id: `wild${nextId++}`, pos, home: pos, biome: zone.biome, species: rolled.species, levels: rolled.levels });
    }
  }
  return rollPickups(def, content, { ...world, encounters: groups, rngState: rng, nextEncounterId: nextId });
}

/**
 * Places this map's pickups: one-time finds at their fixed spot until taken, the rest on a random
 * reachable tile of the same area as their defined spot (so cave finds stay in the cave).
 */
function rollPickups(def: WorldDef, content: WorldContent, world: WorldState): WorldState {
  const grid = worldGrid(content, def);
  const reachable = reachableTiles(grid, world.pos, Number.MAX_SAFE_INTEGER, { isAlly: () => false, isEnemy: () => false }).destinations;
  const taken = new Set([...world.encounters.map((e) => key(e.pos)), ...(def.exits ?? []).map((e) => key(e.pos)), key(world.pos)]);
  let rng = world.rngState;
  const pickups: WorldPickup[] = [];
  for (const p of def.pickups) {
    if (p.once) {
      if (!world.collected.includes(p.id)) {
        pickups.push(p);
        taken.add(key(p.pos));
      }
      continue;
    }
    const area = grid.terrainAt(p.pos).id;
    const spots = reachable.filter((t) => grid.terrainAt(t).id === area && !taken.has(key(t)) && manhattan(t, world.pos) > SPAWN_CLEARANCE);
    if (!spots.length) continue;
    const pick = randomInt(rng, 0, spots.length - 1);
    rng = pick.state;
    const pos = spots[pick.value]!;
    taken.add(key(pos));
    pickups.push({ ...p, pos });
  }
  return { ...world, pickups, rngState: rng };
}

export interface TravelResult {
  readonly world: WorldState;
  /** Tiles walked, in order. */
  readonly path: readonly Point[];
  readonly pickedUp: readonly WorldPickup[];
  /** Set when the walk ended on a wild group. */
  readonly encounter: EncounterGroup | null;
}

/** Shortest (least tiring) path to `to`; wild groups block the way unless they are the destination. */
export function travelPath(content: WorldContent, def: WorldDef, world: WorldState, to: Point, access?: WorldAccess): Point[] | null {
  const grid = worldGrid(content, def, access);
  const blocked = new Set([...world.encounters.filter((e) => !samePoint(e.pos, to)).map((e) => key(e.pos)), ...(access?.blocked ?? [])]);
  return reachableTiles(grid, world.pos, Number.MAX_SAFE_INTEGER, {
    isAlly: () => false,
    isEnemy: (p) => blocked.has(key(p)),
  }).pathTo(to);
}

export function travel(content: WorldContent, def: WorldDef, world: WorldState, to: Point, access?: WorldAccess): TravelResult {
  const path = travelPath(content, def, world, to, access);
  if (!path) throw new Error(`cannot travel to ${key(to)}`);
  const grid = worldGrid(content, def, access);
  let fatigue = world.fatigue;
  const collected = [...world.collected];
  let pickups = world.pickups;
  const pickedUp: WorldPickup[] = [];
  for (const step of path) {
    fatigue = addTravelFatigue(content.fatigue, fatigue, grid.terrainAt(step).moveCost!);
    const pickup = pickups.find((p) => samePoint(p.pos, step));
    if (pickup) {
      if (pickup.once) collected.push(pickup.id);
      pickups = pickups.filter((p) => p !== pickup);
      pickedUp.push(pickup);
    }
  }
  const encounter = world.encounters.find((e) => samePoint(e.pos, to)) ?? null;
  return { world: { ...world, pos: to, fatigue, collected, pickups }, path, pickedUp, encounter };
}

/**
 * Making camp, possible anywhere: fatigue to 0, remember the spot, wild groups move.
 * HP is restored by the roster layer. When to camp is the player's call.
 */
export function makeCamp(content: WorldContent, def: WorldDef, world: WorldState): WorldState {
  return respawnEncounters(content, def, { ...world, fatigue: 0, lastCamp: world.pos });
}

/** After a defeat the party is carried back to the last camp and rests there. */
export function returnToLastCamp(content: WorldContent, def: WorldDef, world: WorldState): WorldState {
  return makeCamp(content, def, { ...world, pos: world.lastCamp });
}

export function removeEncounter(world: WorldState, id: string): WorldState {
  return { ...world, encounters: world.encounters.filter((e) => e.id !== id) };
}

/**
 * The part of a wild group that actually fights: never more Pokémon than the player can field
 * (healthy party members, at most the map's deploy slots), so a lone starter is not swarmed.
 * Keeps the strongest members.
 */
export function effectiveGroup(
  group: EncounterGroup, healthyPartyMembers: number, deploySlots = MAX_ACTIVE_UNITS,
  /** Learning maps: no wild Pokémon above this level (the party's highest). */
  maxLevel?: number,
): EncounterGroup {
  if (maxLevel !== undefined && group.levels.some((lv) => lv > maxLevel)) group = { ...group, levels: group.levels.map((lv) => Math.min(lv, Math.max(1, maxLevel))) };
  const cap = Math.max(1, Math.min(deploySlots, healthyPartyMembers));
  if (group.species.length <= cap) return group;
  const keep = group.levels
    .map((lv, i) => ({ lv, i }))
    .sort((a, b) => b.lv - a.lv || a.i - b.i)
    .slice(0, cap)
    .map((e) => e.i)
    .sort((a, b) => a - b);
  return { ...group, species: keep.map((i) => group.species[i]!), levels: keep.map((i) => group.levels[i]!) };
}

/** A wild group sees the party within this many tiles (walking distance on open ground). */
export const SIGHT = 3;
/** Wild groups stay within this many tiles of where they spawned. */
export const LEASH = 6;
/** Chance per party step that an idle group takes a step of its own. */
const WANDER_CHANCE = 0.4;
/** Chance per party step that a chasing group closes in: slower than the party, so it can be outrun. */
const CHASE_CHANCE = 0.6;
/** Towns are safe zones: wild groups never enter them, and a party inside one is not chased. */
const SAFE_AREA = "town";

export interface GroupsStep {
  readonly world: WorldState;
  /** A chasing group that reached the party: the battle starts as its ambush. */
  readonly caught: EncounterGroup | null;
}

/**
 * The world's answer to one party step (the overworld is turn-based like a roguelike: groups only move
 * when the party does). A group that sees the party within SIGHT first stops (its "!" warns the player),
 * then chases it (never into a town), slower than the party walks, as long as it stays within LEASH of home; otherwise it
 * wanders now and then. Groups keep to tiles the party
 * could walk, never step on each other, NPCs, obstacles or exits, and a chaser next to the party catches it.
 */
export function stepGroups(content: WorldContent, def: WorldDef, world: WorldState, access?: WorldAccess): GroupsStep {
  const grid = worldGrid(content, def, access);
  const party = world.pos;
  const blocked = new Set([...(access?.blocked ?? []), ...(def.exits ?? []).map((e) => key(e.pos))]);
  let rng = world.rngState;
  const occupied = new Set(world.encounters.map((e) => key(e.pos)));
  const safe = (p: Point) => biomeAt(content, def, p).id === SAFE_AREA;
  const open = (p: Point, home: Point) =>
    grid.inBounds(p) && grid.terrainAt(p).moveCost !== null && !safe(p) && !blocked.has(key(p)) && !occupied.has(key(p)) && !samePoint(p, party) && manhattan(p, home) <= LEASH;
  const neighbors = (p: Point): Point[] => [{ x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 }];
  let caught: EncounterGroup | null = null;
  const encounters = world.encounters.map((g) => {
    const home = g.home ?? g.pos;
    const sees = !safe(party) && manhattan(g.pos, party) <= SIGHT && manhattan(party, home) <= LEASH + 1;
    let pos = g.pos;
    const roll = nextRandom(rng);
    rng = roll.state;
    if (sees) {
      if (g.chasing && roll.value < CHASE_CHANCE && manhattan(pos, party) > 1) {
        // Chase: the free neighbour closest to the party.
        const next = neighbors(pos).filter((n) => open(n, home)).sort((a, b) => manhattan(a, party) - manhattan(b, party))[0];
        if (next && manhattan(next, party) < manhattan(pos, party)) pos = next;
      }
    } else {
      if (roll.value < WANDER_CHANCE) {
        // Wander, drifting back home when far; staying in its own biome keeps grass groups in the grass.
        const options = neighbors(pos).filter((n) => open(n, home) && biomeAt(content, def, n).id === g.biome);
        const homeward = manhattan(pos, home) > 2 ? options.filter((n) => manhattan(n, home) < manhattan(pos, home)) : options;
        const pool = homeward.length ? homeward : options;
        if (pool.length) {
          const pick = randomInt(rng, 0, pool.length - 1);
          rng = pick.state;
          pos = pool[pick.value]!;
        }
      }
    }
    occupied.delete(key(g.pos));
    occupied.add(key(pos));
    const moved: EncounterGroup = { ...g, pos, home, chasing: sees };
    if (sees && !caught && manhattan(pos, party) <= 1) caught = moved;
    return moved;
  });
  return { world: { ...world, encounters, rngState: rng }, caught };
}

/**
 * Builds the battle for a wild group on its biome's terrain. With a seed the arena is generated with a
 * random formation (sometimes an ambush); without one the biome's hand-drawn arena is used.
 */
export function wildScenario(
  content: WorldContent,
  group: EncounterGroup,
  setup: (speciesId: string, level: number) => Omit<UnitSetup, "id" | "side" | "pos">,
  maxDeploy = MAX_ACTIVE_UNITS,
  seed?: number,
  /** The group caught the party: its ambush formations (surrounded, pincer). */
  ambush = false,
): BattleScenario & { name: string; captureAllowed: boolean } {
  const biome = content.biomes[group.biome]!;
  let arena: { readonly mapRows: readonly string[]; readonly deploymentZone: readonly Point[]; readonly enemySpawns: readonly Point[] } | undefined = biome.arena;
  if (!arena) throw new Error(`biome ${biome.id} has no arena`);
  let name = `Wild Pokémon · ${biome.name}`;
  if (seed !== undefined) {
    const gen = battleArena(arena, biome.id, seed, ambush ? "wildAmbush" : "wild", maxDeploy, group.species.length);
    arena = gen;
    name = `${name} · ${formationLabel(gen.formation)}`;
  }
  if (group.species.length > arena.enemySpawns.length) throw new Error(`arena for ${biome.id} has too few spawn points`);
  const enemies: UnitSetup[] = group.species.map((speciesId, i) => ({
    ...setup(speciesId, group.levels[i] ?? 1), id: `${group.id}-${i}`, side: "enemy", pos: arena.enemySpawns[i]!,
  }));
  return { id: group.id, name, mapRows: arena.mapRows, deploymentZone: arena.deploymentZone, enemies, captureAllowed: true, maxDeploy };
}

/** Rolls a won battle's loot table in order: at most one item turns up (the first that hits). */
export function rollLoot(table: readonly { readonly item: string; readonly chance: number }[], rngState: number): { item: string | null; rngState: number } {
  let state = rngState;
  for (const { item, chance } of table) {
    const r = nextRandom(state);
    state = r.state;
    if (r.value < chance) return { item, rngState: state };
  }
  return { item: null, rngState: state };
}

export type PickupKind = "rare" | "held" | "ball" | "heal" | "food";

/** What a pickup looks like on the map: one-time finds are marked rare, otherwise its most valuable content decides. */
export function pickupKind(p: WorldPickup, itemKind: (id: string) => string | undefined): PickupKind {
  if (p.once) return "rare";
  const kinds = Object.keys(p.items ?? {}).map(itemKind);
  if (kinds.includes("held")) return "held";
  if (Object.keys(p.balls ?? {}).length) return "ball";
  if (kinds.some((k) => k === "potion" || k === "remedy")) return "heal";
  return "food";
}
