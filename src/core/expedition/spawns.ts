import type { Point } from "../grid/types";
import { biomeAt, type WorldContent, type WorldDef } from "./world";

/** One species that can turn up in an area, for the "wild Pokémon here" panel. */
export interface SpawnInfo {
  readonly speciesId: string;
  /** Share of wild Pokémon in this area that are this species (from the encounter weights). */
  readonly chance: number;
  readonly levels: { readonly min: number; readonly max: number };
  /** Limit per group, if any. */
  readonly maxPerGroup?: number;
}

/**
 * What can spawn in the area at `p` on this map, most common first. Levels follow the map's spawn
 * zones of that biome (later maps reuse biomes with stronger Pokémon). Empty where nothing spawns.
 */
export function spawnsAt(content: WorldContent, def: WorldDef, p: Point): SpawnInfo[] {
  const biome = biomeAt(content, def, p);
  const table = biome.encounters;
  if (!table) return [];
  const zones = def.spawnZones.filter((z) => z.biome === biome.id);
  if (zones.length === 0) return [];
  const ranges = zones.map((z) => z.levels ?? table.levels);
  const levels = { min: Math.min(...ranges.map((r) => r.min)), max: Math.max(...ranges.map((r) => r.max)) };
  const total = table.entries.reduce((s, e) => s + e.weight, 0);
  return table.entries
    .map((e) => ({ speciesId: e.speciesId, chance: e.weight / total, levels, ...(e.maxPerGroup !== undefined && { maxPerGroup: e.maxPerGroup }) }))
    .sort((a, b) => b.chance - a.chance);
}

/** Where the wild list looks from `p`: there, or off spawn ground (paths, towns) the nearest spawn spot of the map. */
export function spawnSpotNear(content: WorldContent, def: WorldDef, p: Point): Point {
  if (spawnsAt(content, def, p).length) return p;
  const spots = def.spawnZones.flatMap((z) => z.points);
  const d = (q: Point) => Math.hypot(q.x - p.x, q.y - p.y);
  return spots.reduce<Point>((best, q) => (d(q) < d(best) ? q : best), spots[0] ?? p);
}
