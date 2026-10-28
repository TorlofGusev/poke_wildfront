import { nextRandom } from "../rng";
import type { Point } from "../grid/types";
import { bodyFits, distance, terrainAt, type FreeField, type FreeTerrainId, type FreeZone } from "./field";
import { freeReach } from "./pathing";

/**
 * Procedural battle arenas on the free field: organic patches of the biome's terrain (mud, water, bush, rock)
 * and a formation for the situation. Pure and deterministic: the same options always give the same arena.
 */

export type Formation = "sides" | "cornerVsCorner" | "pincer" | "topBottom" | "surrounded" | "bossCenter";
export type FormationContext = "wild" | "wildAmbush" | "trainer" | "boss";

export interface FreeArenaOptions {
  readonly seed: number;
  /** Biome id or arena style key; used for the palette when `base` is absent. */
  readonly style: string;
  readonly formation: Formation;
  readonly playerCount: number;
  readonly enemyCount: number;
  /** The biome's hand-drawn arena: its characters say which terrains the biome has. */
  readonly base?: { readonly mapRows: readonly string[] };
}

export interface FreeArena {
  readonly field: FreeField;
  /** Spots the player may deploy on: many more than the team, so placing is a real choice. */
  readonly deploymentZone: Point[];
  readonly enemySpawns: Point[];
}

export const ARENA_WIDTH = 16;
export const ARENA_HEIGHT = 10;
/** Deploy spots per Pokémon the player may bring (plus a couple extra). */
const SPOTS_PER_UNIT = 2;
const EXTRA_SPOTS = 2;
/** Spots and spawns stand at least this far apart (room to stand side by side). */
const SPOT_GAP = 1;
/** No foe starts closer than this to a deploy spot. */
const MIN_FOE_GAP = 3.5;
const MAX_TRIES = 16;

interface Palette {
  readonly rock: boolean;
  readonly water: boolean;
  readonly bush: boolean;
  readonly mud: boolean;
  /** Indoor/cave styles (rock but no grass) get rock ridges. */
  readonly enclosed: boolean;
}

/** Small mutable wrapper around the project's Mulberry32 generator. */
class Rng {
  constructor(private state: number) {}
  next(): number {
    const r = nextRandom(this.state);
    this.state = r.state;
    return r.value;
  }
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]!;
  }
}

function paletteFor(style: string, base?: { readonly mapRows: readonly string[] }): Palette {
  let chars: Set<string>;
  if (base && base.mapRows.length > 0) {
    chars = new Set(base.mapRows.join(""));
  } else {
    const s = style.toLowerCase();
    chars = new Set(["."]);
    if (/cave|tunnel|dojo|mansion|lab|tower|office|hideout|hall|gym|plant|town|victory/.test(s)) chars.add("#");
    if (/forest|grass|route|park|safari/.test(s)) { chars.add('"'); chars.add("#"); }
    if (/water|sea|lake|pond|coast|shallows|foam|deck/.test(s)) chars.add("~");
    if (/cave|mountain|forest|moon|plant/.test(s)) chars.add("m");
    if (chars.size === 1) { chars.add('"'); chars.add("#"); }
  }
  const rock = chars.has("#");
  const bush = chars.has('"');
  return { rock, water: chars.has("~"), bush, mud: chars.has("m"), enclosed: rock && !bush };
}

/** A rounded, irregular patch around `c`. */
function patch(rng: Rng, terrain: FreeTerrainId, c: Point, rx: number, ry: number): FreeZone {
  const n = rng.int(7, 10);
  const turn = rng.next() * Math.PI * 2;
  const poly: Point[] = [];
  for (let i = 0; i < n; i++) {
    const a = turn + (i / n) * Math.PI * 2;
    const k = rng.range(0.75, 1.2);
    // Kept on the field: a patch at the edge is cut off by it.
    const x = Math.min(ARENA_WIDTH, Math.max(0, c.x + Math.cos(a) * rx * k));
    const y = Math.min(ARENA_HEIGHT, Math.max(0, c.y + Math.sin(a) * ry * k));
    poly.push({ x: round(x), y: round(y) });
  }
  return { terrain, poly };
}

const round = (v: number): number => Math.round(v * 100) / 100;

/** A ridge of rocks across the field with one or two gaps (chokepoints). */
function ridge(rng: Rng, zones: FreeZone[]): void {
  const vertical = rng.next() < 0.6;
  const len = vertical ? ARENA_HEIGHT : ARENA_WIDTH;
  const at = vertical ? rng.range(6, ARENA_WIDTH - 6) : rng.range(3.5, ARENA_HEIGHT - 3.5);
  const gaps = Array.from({ length: rng.int(1, 2) }, () => rng.range(1.5, len - 1.5));
  for (let t = 0.6; t < len; t += 1.1) {
    if (gaps.some((g) => Math.abs(g - t) < 1.1)) continue;
    const c = vertical ? { x: at + rng.range(-0.3, 0.3), y: t } : { x: t, y: at + rng.range(-0.3, 0.3) };
    zones.push(patch(rng, "rock", c, rng.range(0.55, 0.8), rng.range(0.55, 0.8)));
  }
}

function buildTerrain(rng: Rng, p: Palette): FreeZone[] {
  const zones: FreeZone[] = [];
  if (p.enclosed || (p.rock && rng.next() < 0.35)) ridge(rng, zones);
  const kinds: FreeTerrainId[] = [];
  if (p.mud) kinds.push("mud");
  if (p.water) kinds.push("water", "water");
  if (p.bush) kinds.push("bush", "bush", "bush");
  if (p.rock) kinds.push("rock", "rock");
  if (kinds.length === 0) kinds.push("bush", "rock");
  // Slow ground lies underneath; cover and rocks go on top.
  const order: Record<FreeTerrainId, number> = { floor: 0, mud: 1, water: 2, bush: 3, rock: 4 };
  const count = rng.int(6, 9);
  const extra: FreeZone[] = [];
  for (let i = 0; i < count; i++) {
    const terrain = rng.pick(kinds);
    const big = terrain === "mud" || terrain === "water";
    const c = { x: rng.range(1, ARENA_WIDTH - 1), y: rng.range(1, ARENA_HEIGHT - 1) };
    const r = big ? rng.range(1.1, 2) : rng.range(0.6, 1.2);
    extra.push(patch(rng, terrain, c, r * rng.range(0.8, 1.3), r * rng.range(0.7, 1.1)));
    // Water usually comes with a muddy shore.
    if (terrain === "water" && p.mud && rng.next() < 0.5) extra.push(patch(rng, "mud", c, r * 1.4, r * 1.3));
  }
  extra.sort((a, b) => order[a.terrain] - order[b.terrain]);
  return [...extra.filter((z) => z.terrain !== "rock"), ...zones, ...extra.filter((z) => z.terrain === "rock")];
}

// ---- formations ----

interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

interface Zones {
  readonly player: Box;
  /** One area per enemy group; enemies are dealt round-robin across them. */
  readonly enemies: readonly Box[];
  /** Where the first enemy (the boss) stands. */
  readonly boss?: Point;
  /** Enemies spread out instead of bunching (ambushes, a boss's guard). */
  readonly spread?: boolean;
}

function zonesFor(rng: Rng, f: Formation): Zones {
  const W = ARENA_WIDTH;
  const H = ARENA_HEIGHT;
  const flipX = rng.next() < 0.5;
  const flipY = rng.next() < 0.5;
  const fb = (b: Box): Box => ({
    x0: flipX ? W - b.x1 : b.x0, x1: flipX ? W - b.x0 : b.x1,
    y0: flipY ? H - b.y1 : b.y0, y1: flipY ? H - b.y0 : b.y1,
  });
  const fp = (p: Point): Point => ({ x: flipX ? W - p.x : p.x, y: flipY ? H - p.y : p.y });
  const cx = W / 2;
  const cy = H / 2;
  switch (f) {
    case "sides":
      return { player: fb({ x0: 2.5, y0: 1.5, x1: 5.5, y1: H - 1.5 }), enemies: [fb({ x0: 10.5, y0: 1.5, x1: 13.5, y1: H - 1.5 })] };
    case "topBottom":
      return { player: fb({ x0: 4, y0: H - 3.2, x1: W - 4, y1: H - 0.7 }), enemies: [fb({ x0: 4, y0: 0.7, x1: W - 4, y1: 2.6 })] };
    case "cornerVsCorner":
      return { player: fb({ x0: 1, y0: H - 4.5, x1: 5.5, y1: H - 0.7 }), enemies: [fb({ x0: W - 6, y0: 0.7, x1: W - 1.5, y1: 4 })] };
    case "pincer":
      return {
        player: fb({ x0: 2.5, y0: cy - 2.5, x1: 5.5, y1: cy + 2.5 }),
        enemies: [fb({ x0: 10, y0: 0.7, x1: 13.5, y1: 2.8 }), fb({ x0: 10, y0: H - 2.8, x1: 13.5, y1: H - 0.7 })],
      };
    case "surrounded":
      return {
        player: { x0: cx - 2, y0: cy - 1.6, x1: cx + 2, y1: cy + 1.6 },
        enemies: [{ x0: 0.7, y0: 0.7, x1: W - 0.7, y1: H - 0.7 }],
        spread: true,
      };
    case "bossCenter": {
      const boss = { x: cx + 2.5, y: cy };
      return {
        player: fb({ x0: 1.5, y0: 1.5, x1: 4.5, y1: H - 1.5 }),
        enemies: [fb({ x0: boss.x - 2, y0: boss.y - 2.5, x1: boss.x + 2, y1: boss.y + 2.5 })],
        boss: fp(boss),
        spread: true,
      };
    }
  }
}

/** Open floor where a body fits, clear of every other point in `taken`. */
function goodSpot(field: FreeField, p: Point, taken: readonly Point[]): boolean {
  return terrainAt(field, p).id === "floor" && bodyFits(field, p) && taken.every((q) => distance(p, q) >= SPOT_GAP);
}

/** Up to `count` spots in `box`, scattered (dart throwing), on open floor. */
function scatter(rng: Rng, field: FreeField, box: Box, count: number, taken: readonly Point[], ok: (p: Point) => boolean): Point[] {
  const out: Point[] = [];
  for (let tries = 0; tries < count * 40 && out.length < count; tries++) {
    const p = { x: round(rng.range(box.x0, box.x1)), y: round(rng.range(box.y0, box.y1)) };
    if (ok(p) && goodSpot(field, p, [...taken, ...out])) out.push(p);
  }
  return out;
}

function place(rng: Rng, field: FreeField, zones: Zones, playerCount: number, enemyCount: number): FreeArena | null {
  const want = playerCount * SPOTS_PER_UNIT + EXTRA_SPOTS;
  const spots = scatter(rng, field, zones.player, want, [], () => true);
  if (spots.length < playerCount + EXTRA_SPOTS) return null;
  const farEnough = (p: Point) => spots.every((s) => distance(s, p) >= MIN_FOE_GAP);
  const enemies: Point[] = [];
  if (zones.boss && enemyCount > 0) {
    if (!farEnough(zones.boss) || !goodSpot(field, zones.boss, spots)) return null;
    enemies.push(zones.boss);
  }
  for (let stalls = 0, g = 0; enemies.length < enemyCount && stalls < zones.enemies.length; g++) {
    const box = zones.enemies[g % zones.enemies.length]!;
    const candidates = scatter(rng, field, box, zones.spread ? 8 : 1, [...spots, ...enemies], farEnough);
    if (candidates.length === 0) {
      stalls++;
      continue;
    }
    stalls = 0;
    // Spread formations take the candidate farthest from the foes already placed.
    const score = (p: Point) => (enemies.length ? Math.min(...enemies.map((e) => distance(e, p))) : 0);
    enemies.push(zones.spread ? candidates.reduce((a, b) => (score(b) > score(a) ? b : a)) : candidates[0]!);
  }
  if (enemies.length < enemyCount) return null;
  // Everyone must be able to reach everyone: walk from the first spot with an unlimited budget.
  const reach = freeReach(field, spots[0]!, 1000, [], false);
  if (![...spots, ...enemies].every((p) => p === spots[0] || reach.pathTo(p))) return null;
  return { field, deploymentZone: spots, enemySpawns: enemies };
}

export function generateFreeArena(opts: FreeArenaOptions): FreeArena {
  const palette = paletteFor(opts.style, opts.base);
  const rng = new Rng((opts.seed ^ 0x9e3779b9) >>> 0);
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const field: FreeField = { width: ARENA_WIDTH, height: ARENA_HEIGHT, zones: buildTerrain(rng, palette) };
    const result = place(rng, field, zonesFor(rng, opts.formation), opts.playerCount, opts.enemyCount);
    if (result) return result;
  }
  // Fallback: an open field always fits the formation.
  for (let n = opts.enemyCount; n >= 0; n--) {
    const field: FreeField = { width: ARENA_WIDTH, height: ARENA_HEIGHT, zones: [] };
    const result = place(rng, field, zonesFor(rng, opts.formation), opts.playerCount, n);
    if (result) return result;
  }
  throw new Error(`generateFreeArena: cannot fit ${opts.playerCount} players`);
}

/** A battle arena for a biome: generated with a formation for the situation, on the biome's terrain. */
export function battleArena(
  base: { readonly mapRows: readonly string[] }, style: string, seed: number, context: FormationContext, playerCount: number, enemyCount: number,
): FreeArena & { readonly formation: Formation } {
  const formation = pickFormation(seed, context);
  return { ...generateFreeArena({ seed, style, formation, playerCount, enemyCount, base }), formation };
}

export function pickFormation(seed: number, context: FormationContext): Formation {
  const options: Record<FormationContext, readonly Formation[]> = {
    wild: ["sides", "cornerVsCorner", "pincer", "topBottom"],
    wildAmbush: ["surrounded", "pincer"],
    trainer: ["sides", "topBottom"],
    boss: ["bossCenter"],
  };
  const list = options[context];
  return list[Math.floor(nextRandom(seed >>> 0).value * list.length)]!;
}

const LABELS: Record<Formation, string> = {
  sides: "Face-off",
  cornerVsCorner: "Flanking",
  pincer: "Pincer!",
  topBottom: "Head-on",
  surrounded: "Ambush!",
  bossCenter: "Boss",
};

export function formationLabel(f: Formation): string {
  return LABELS[f];
}
