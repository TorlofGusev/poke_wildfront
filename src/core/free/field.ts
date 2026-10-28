import type { Point } from "../grid/types";

/**
 * Free-movement battlefield (prototype): no grid, Pokémon stand anywhere. Distances are in hex widths,
 * so movement points and move ranges keep their meaning (1 hex step ≈ 1 unit).
 */

export type FreeTerrainId = "floor" | "mud" | "water" | "bush" | "rock";

export interface FreeTerrainDef {
  readonly id: FreeTerrainId;
  /** Movement cost per unit walked; null = impassable. */
  readonly moveCost: number | null;
  /** Cost for fliers (they skim over water and mud). */
  readonly flyCost: number | null;
  /** Lines of sight passing through it are blocked. */
  readonly blocksSight: boolean;
}

export const FREE_TERRAIN: Readonly<Record<FreeTerrainId, FreeTerrainDef>> = {
  floor: { id: "floor", moveCost: 1, flyCost: 1, blocksSight: false },
  mud: { id: "mud", moveCost: 2, flyCost: 1, blocksSight: false },
  water: { id: "water", moveCost: 2, flyCost: 1, blocksSight: false },
  bush: { id: "bush", moveCost: 1.5, flyCost: 1, blocksSight: true },
  rock: { id: "rock", moveCost: null, flyCost: null, blocksSight: true },
};

export interface FreeZone {
  readonly terrain: FreeTerrainId;
  /** Polygon corners, in order. */
  readonly poly: readonly Point[];
}

export interface FreeField {
  readonly width: number;
  readonly height: number;
  /** Later zones lie on top of earlier ones. */
  readonly zones: readonly FreeZone[];
}

/** Every Pokémon is a circle of this radius. */
export const UNIT_RADIUS = 0.3;
/** Allies may stand a little closer than their bodies (they shuffle together). */
export const ALLY_GAP = 0.45;
/** Two units this close (centre to centre) are in melee reach of each other; touching is 0.8. */
export const MELEE_REACH = 1.25;
/** Free movement: a base stride plus a share of Speed, so every Speed point counts. */
export const FREE_MOVE_BASE = 1.5;
export const FREE_MOVE_PER_SPEED = 0.5;
export const FREE_MOVE_MAX = 6;
export const freeMovement = (speed: number): number => Math.min(FREE_MOVE_MAX, FREE_MOVE_BASE + speed * FREE_MOVE_PER_SPEED);

export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

export function pointInPoly(p: Point, poly: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Shortest distance from `p` to the segment a–b. */
export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function inBounds(field: FreeField, p: Point, margin = 0): boolean {
  return p.x >= margin && p.y >= margin && p.x <= field.width - margin && p.y <= field.height - margin;
}

export function terrainAt(field: FreeField, p: Point): FreeTerrainDef {
  for (let i = field.zones.length - 1; i >= 0; i--) {
    if (pointInPoly(p, field.zones[i]!.poly)) return FREE_TERRAIN[field.zones[i]!.terrain];
  }
  return FREE_TERRAIN.floor;
}

/** Whether a unit's body fits at `p`: inside the field and clear of impassable zones. */
export function bodyFits(field: FreeField, p: Point): boolean {
  if (!inBounds(field, p, UNIT_RADIUS)) return false;
  // The centre and eight points on the rim must stand on passable ground.
  if (terrainAt(field, p).moveCost === null) return false;
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    if (terrainAt(field, { x: p.x + Math.cos(a) * UNIT_RADIUS, y: p.y + Math.sin(a) * UNIT_RADIUS }).moveCost === null) return false;
  }
  return true;
}

const SIGHT_STEP = 0.1;

/**
 * Whether sight-blocking terrain (rock, bush) lies between a and b. The first and last `skip` units
 * (the bodies of the shooter and the target) are ignored, so a Pokémon standing in a bush can still be seen.
 */
export function sightBlocked(field: FreeField, a: Point, b: Point, skipStart = UNIT_RADIUS, skipEnd = UNIT_RADIUS): boolean {
  const len = distance(a, b);
  for (let d = skipStart; d <= len - skipEnd; d += SIGHT_STEP) {
    const t = d / len;
    if (terrainAt(field, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }).blocksSight) return true;
  }
  return false;
}

/** How far a body can travel from `from` towards `dir` (a unit vector), up to `max`, before hitting terrain or a blocker. */
export function sweep(field: FreeField, from: Point, dir: Point, max: number, blockers: readonly Point[]): { to: Point; blocked: boolean } {
  let last = from;
  // Steps of SIGHT_STEP, the last one landing exactly on `max`.
  for (let d = Math.min(SIGHT_STEP, max); d <= max + 1e-9; d = d < max ? Math.min(d + SIGHT_STEP, max) : Infinity) {
    const p = { x: from.x + dir.x * d, y: from.y + dir.y * d };
    if (!bodyFits(field, p) || blockers.some((b) => distance(b, p) < UNIT_RADIUS * 2)) return { to: last, blocked: true };
    last = p;
  }
  return { to: last, blocked: false };
}
