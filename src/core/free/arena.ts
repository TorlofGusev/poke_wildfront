import { nextRandom } from "../rng";
import type { Point } from "../grid/types";
import { bodyFits, distance, distToSegment, pointInPoly, terrainAt, UNIT_RADIUS, type FreeField, type FreeTerrainId, type FreeZone } from "./field";
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

/** Where a patch sits, roughly: its centre and outer radius (for keeping patches apart). */
interface Spot {
  readonly c: Point;
  readonly r: number;
  readonly terrain: FreeTerrainId;
}

/** A ridge of rocks across the field with one or two gaps (chokepoints). */
function ridge(rng: Rng, zones: FreeZone[], spots: Spot[]): void {
  const vertical = rng.next() < 0.6;
  const len = vertical ? ARENA_HEIGHT : ARENA_WIDTH;
  const at = vertical ? rng.range(6, ARENA_WIDTH - 6) : rng.range(3.5, ARENA_HEIGHT - 3.5);
  const gaps = Array.from({ length: rng.int(1, 2) }, () => rng.range(1.5, len - 1.5));
  for (let t = 0.6; t < len; t += 1.1) {
    if (gaps.some((g) => Math.abs(g - t) < 1.1)) continue;
    const c = vertical ? { x: at + rng.range(-0.3, 0.3), y: t } : { x: t, y: at + rng.range(-0.3, 0.3) };
    const rx = rng.range(0.55, 0.8), ry = rng.range(0.55, 0.8);
    zones.push(patch(rng, "rock", c, rx, ry));
    spots.push({ c, r: Math.max(rx, ry) * 1.2, terrain: "rock" });
  }
}

/**
 * Whether a new patch would sit on another one. Rocks, bushes and water each stand on open ground,
 * a little apart, as on a drawn route: no rock lying on a bush, no bush in a pond. Only a muddy shore
 * may run under its own water.
 */
function crowded(spots: readonly Spot[], c: Point, r: number): boolean {
  return spots.some((s) => Math.hypot(s.c.x - c.x, s.c.y - c.y) < s.r + r + 0.35);
}

function buildTerrain(rng: Rng, p: Palette): FreeZone[] {
  const zones: FreeZone[] = [];
  const spots: Spot[] = [];
  if (p.enclosed || (p.rock && rng.next() < 0.35)) ridge(rng, zones, spots);
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
    const r = big ? rng.range(1.1, 2) : rng.range(0.6, 1.2);
    const kx = rng.range(0.8, 1.3), ky = rng.range(0.7, 1.1);
    const outer = r * Math.max(kx, ky) * 1.2;
    // A free spot for it, or it is left out.
    let c: Point | null = null;
    for (let tries = 0; tries < 12 && !c; tries++) {
      const at = { x: rng.range(1, ARENA_WIDTH - 1), y: rng.range(1, ARENA_HEIGHT - 1) };
      if (!crowded(spots, at, outer * (terrain === "water" && p.mud ? 1.4 : 1))) c = at;
    }
    if (!c) continue;
    extra.push(patch(rng, terrain, c, r * kx, r * ky));
    // Water usually comes with a muddy shore.
    const shore = terrain === "water" && p.mud && rng.next() < 0.5;
    if (shore) extra.push(patch(rng, "mud", c, r * 1.4, r * 1.3));
    spots.push({ c, r: outer * (shore ? 1.4 : 1), terrain });
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
      return { player: fb({ x0: 0.8, y0: 1.2, x1: 3.8, y1: H - 1.2 }), enemies: [fb({ x0: W - 3.8, y0: 1.2, x1: W - 0.8, y1: H - 1.2 })] };
    case "topBottom":
      return { player: fb({ x0: 2.5, y0: H - 2.3, x1: W - 2.5, y1: H - 0.7 }), enemies: [fb({ x0: 2.5, y0: 0.7, x1: W - 2.5, y1: 2.3 })] };
    case "cornerVsCorner":
      return { player: fb({ x0: 1, y0: H - 4.5, x1: 5.5, y1: H - 0.7 }), enemies: [fb({ x0: W - 6, y0: 0.7, x1: W - 1.5, y1: 4 })] };
    case "pincer":
      return {
        player: fb({ x0: 0.8, y0: cy - 2.5, x1: 3.8, y1: cy + 2.5 }),
        enemies: [fb({ x0: W - 5, y0: 0.7, x1: W - 0.8, y1: 2.6 }), fb({ x0: W - 5, y0: H - 2.6, x1: W - 0.8, y1: H - 0.7 })],
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

/** Three Pokémon side by side must fit through any passage: half that width, from a passage's middle to its sides. */
const ABREAST = 3;
const ROOM = ABREAST * UNIT_RADIUS;
/** How finely passages are measured (hex widths). */
const CLEAR_STEP = 0.2;
/** A narrow nook smaller than this (area) is a corner, not a passage: left alone. */
const NOOK_AREA = 0.6;

interface Rock { readonly poly: readonly Point[]; readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }

/** Distance from `p` to the nearest rock or field edge (0 inside rock). */
function clearance(field: FreeField, rocks: readonly Rock[], p: Point): number {
  let d = Math.min(p.x, p.y, field.width - p.x, field.height - p.y);
  for (const z of rocks) {
    // Rocks whose bounding box is already further than the nearest edge found cannot be nearer.
    if (Math.max(z.x0 - p.x, p.x - z.x1, 0) ** 2 + Math.max(z.y0 - p.y, p.y - z.y1, 0) ** 2 >= d * d) continue;
    if (pointInPoly(p, z.poly)) return 0;
    for (let i = 0; i < z.poly.length; i++) d = Math.min(d, distToSegment(p, z.poly[i]!, z.poly[(i + 1) % z.poly.length]!));
  }
  return d;
}

/**
 * Narrow passages: ground a Pokémon can stand on that no three-abreast-wide space reaches (a morphological
 * opening of the walkable ground). Each is returned as its points; tiny corner nooks are left out.
 */
export function narrowPassages(field: FreeField): Point[][] {
  const rocks: Rock[] = field.zones.filter((z) => z.terrain === "rock").map((z) => ({
    poly: z.poly, x0: Math.min(...z.poly.map((q) => q.x)), y0: Math.min(...z.poly.map((q) => q.y)),
    x1: Math.max(...z.poly.map((q) => q.x)), y1: Math.max(...z.poly.map((q) => q.y)),
  }));
  const cols = Math.floor(field.width / CLEAR_STEP), rows = Math.floor(field.height / CLEAR_STEP);
  const at = (c: number, r: number): Point => ({ x: (c + 0.5) * CLEAR_STEP, y: (r + 0.5) * CLEAR_STEP });
  const clear = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) clear[r * cols + c] = clearance(field, rocks, at(c, r));
  // Covered: within ROOM of a point with ROOM of clearance (a three-wide disc fits there).
  const covered = new Uint8Array(cols * rows);
  const k = Math.ceil(ROOM / CLEAR_STEP);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (clear[r * cols + c]! < ROOM) continue;
    for (let dr = -k; dr <= k; dr++) for (let dc = -k; dc <= k; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= rows || cc >= cols || (dr * dr + dc * dc) * CLEAR_STEP * CLEAR_STEP > ROOM * ROOM) continue;
      covered[rr * cols + cc] = 1;
    }
  }
  const narrow = (i: number) => clear[i]! >= UNIT_RADIUS && !covered[i];
  const seen = new Uint8Array(cols * rows);
  const out: Point[][] = [];
  for (let i = 0; i < cols * rows; i++) {
    if (seen[i] || !narrow(i)) continue;
    const part: Point[] = [];
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop()!;
      part.push(at(j % cols, Math.floor(j / cols)));
      for (const n of [j - 1, j + 1, j - cols, j + cols]) {
        if (n < 0 || n >= cols * rows || seen[n] || (Math.abs((n % cols) - (j % cols)) > 1) || !narrow(n)) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    if (part.length * CLEAR_STEP * CLEAR_STEP >= NOOK_AREA) out.push(part);
  }
  return out;
}

/**
 * Bottlenecks between open areas: where three abreast fit, the ground splits into areas; when one can only be
 * reached from the largest through a gap narrower than that, the narrowest point of the way there (one per area;
 * for an area walled off entirely, the wall between it and the largest).
 * (A thin wall's gap can sit close to open ground on both sides, so narrowPassages alone misses it.)
 */
export function bottlenecks(field: FreeField): Point[] {
  const rocks: Rock[] = field.zones.filter((z) => z.terrain === "rock").map((z) => ({
    poly: z.poly, x0: Math.min(...z.poly.map((q) => q.x)), y0: Math.min(...z.poly.map((q) => q.y)),
    x1: Math.max(...z.poly.map((q) => q.x)), y1: Math.max(...z.poly.map((q) => q.y)),
  }));
  const cols = Math.floor(field.width / CLEAR_STEP), rows = Math.floor(field.height / CLEAR_STEP);
  const at = (i: number): Point => ({ x: ((i % cols) + 0.5) * CLEAR_STEP, y: (Math.floor(i / cols) + 0.5) * CLEAR_STEP });
  const clear = new Float32Array(cols * rows);
  for (let i = 0; i < cols * rows; i++) clear[i] = clearance(field, rocks, at(i));
  const near = (j: number) => [j - 1, j + 1, j - cols, j + cols].filter((n) => n >= 0 && n < cols * rows && Math.abs((n % cols) - (j % cols)) <= 1);
  // Open areas: connected ground where three abreast fit.
  const area = new Int32Array(cols * rows).fill(-1);
  const sizes: number[] = [];
  for (let i = 0; i < cols * rows; i++) {
    if (area[i]! >= 0 || clear[i]! < ROOM) continue;
    const id = sizes.length;
    let size = 0;
    const stack = [i];
    area[i] = id;
    while (stack.length) {
      const j = stack.pop()!;
      size++;
      for (const n of near(j)) if (area[n]! < 0 && clear[n]! >= ROOM) { area[n] = id; stack.push(n); }
    }
    sizes.push(size);
  }
  const big = sizes.map((s, id) => (s * CLEAR_STEP * CLEAR_STEP >= NOOK_AREA ? id : -1)).filter((id) => id >= 0);
  if (big.length < 2) return [];
  const main = big.reduce((a, b) => (sizes[b]! > sizes[a]! ? b : a));
  // Widest-path search from the main area over walkable ground: each other area's best way in and its narrowest point.
  const width = new Float32Array(cols * rows).fill(-1);
  const pinch = new Int32Array(cols * rows).fill(-1);
  const queue: number[] = [];
  for (let i = 0; i < cols * rows; i++) if (area[i] === main) { width[i] = Infinity; queue.push(i); }
  while (queue.length) {
    // Largest bottleneck first (a simple widest-path search; the grid is small).
    let bi = 0;
    for (let q = 1; q < queue.length; q++) if (width[queue[q]!]! > width[queue[bi]!]!) bi = q;
    const j = queue.splice(bi, 1)[0]!;
    for (const n of near(j)) {
      if (clear[n]! < UNIT_RADIUS) continue;
      const w = Math.min(width[j]!, clear[n]!);
      if (w <= width[n]!) continue;
      width[n] = w;
      pinch[n] = clear[n]! < width[j]! ? n : pinch[j]!;
      queue.push(n);
    }
  }
  const out: Point[] = [];
  for (const id of big) {
    if (id === main) continue;
    let cell = -1;
    for (let i = 0; i < cols * rows; i++) if (area[i] === id && width[i]! >= 0 && (cell < 0 || width[i]! > width[cell]!)) cell = i;
    if (cell >= 0) {
      if (width[cell]! < ROOM && pinch[cell]! >= 0) out.push(at(pinch[cell]!));
      continue;
    }
    // Walled off entirely: the wall between it and the main area, halfway along their nearest points.
    let a = -1, b = -1, best = Infinity;
    for (let i = 0; i < cols * rows; i += 3) if (area[i] === id) for (let j = 0; j < cols * rows; j += 3) if (area[j] === main) {
      const p = at(i), q = at(j), d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
      if (d < best) { best = d; a = i; b = j; }
    }
    if (a >= 0) out.push({ x: (at(a).x + at(b).x) / 2, y: (at(a).y + at(b).y) / 2 });
  }
  return out;
}

/** Widens every narrow passage: the rock nearest to each goes, until three Pokémon fit abreast everywhere. */
function widenPassages(field: FreeField): FreeField {
  let cur = field;
  for (let guard = 0; guard < 12; guard++) {
    const points = [...narrowPassages(cur).map((passage) => passage[Math.floor(passage.length / 2)]!), ...bottlenecks(cur)];
    const rocks = cur.zones.filter((z) => z.terrain === "rock");
    if (!points.length || !rocks.length) return cur;
    // One rock per passage each round (the one nearest its middle), then measure again.
    const gone = new Set(points.map((mid) => {
      const edge = (z: FreeZone) => Math.min(...z.poly.map((q, i) => distToSegment(mid, q, z.poly[(i + 1) % z.poly.length]!)));
      return rocks.reduce((best, z) => (edge(z) < edge(best) ? z : best));
    }));
    cur = { ...cur, zones: cur.zones.filter((z) => !gone.has(z)) };
  }
  return cur;
}

export function generateFreeArena(opts: FreeArenaOptions): FreeArena {
  const palette = paletteFor(opts.style, opts.base);
  const rng = new Rng((opts.seed ^ 0x9e3779b9) >>> 0);
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const field = widenPassages({ width: ARENA_WIDTH, height: ARENA_HEIGHT, zones: buildTerrain(rng, palette) });
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
