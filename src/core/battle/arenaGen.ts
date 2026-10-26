import { nextRandom } from "../rng";
import { ASCII_LEGEND } from "../grid/Grid";
import { gridDistance, key, type Point } from "../grid/types";

/**
 * Procedural battle arenas: terrain from a biome's palette plus a deployment formation.
 * Pure and deterministic: the same options always produce the same arena.
 */

export type Formation = "sides" | "cornerVsCorner" | "pincer" | "topBottom" | "surrounded" | "bossCenter";
export type FormationContext = "wild" | "wildAmbush" | "trainer" | "boss";

export interface GenerateArenaOptions {
  readonly seed: number;
  /** Biome id or arena style key; used for the palette when `base` is absent. */
  readonly style: string;
  readonly width?: number;
  readonly height?: number;
  readonly formation: Formation;
  readonly playerCount: number;
  readonly enemyCount: number;
  /** The biome's hand-drawn arena: its chars define the palette and its height the default height. */
  readonly base?: { readonly mapRows: readonly string[] };
}

export interface GeneratedArena {
  readonly mapRows: string[];
  readonly deploymentZone: Point[];
  readonly enemySpawns: Point[];
}

const FLOOR = ".";
const GRASS = '"';
const WATER = "~";
const WALL = "#";
const MUD = "m";
const MAX_TRIES = 12;
const DEFAULT_WIDTH = 16;
const DEFAULT_HEIGHT = 10;

interface Palette {
  readonly wall: boolean;
  readonly water: boolean;
  readonly grass: boolean;
  readonly mud: boolean;
  /** Indoor/cave styles (walls but no grass) get rock bands and pockets. */
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
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]!;
  }
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [items[i], items[j]] = [items[j]!, items[i]!];
    }
    return items;
  }
}

function paletteFor(style: string, base?: { readonly mapRows: readonly string[] }): Palette {
  let chars: Set<string>;
  if (base && base.mapRows.length > 0) {
    chars = new Set(base.mapRows.join(""));
  } else {
    const s = style.toLowerCase();
    chars = new Set([FLOOR]);
    if (/cave|tunnel|dojo|mansion|lab|tower|office|hideout|hall|gym|plant|town|victory/.test(s)) chars.add(WALL);
    if (/forest|grass|route|park|safari/.test(s)) { chars.add(GRASS); chars.add(WALL); }
    if (/water|sea|lake|pond|coast|shallows|foam|deck/.test(s)) chars.add(WATER);
    if (/cave|mountain|forest|moon|plant/.test(s)) chars.add(MUD);
    if (chars.size === 1) { chars.add(GRASS); chars.add(WALL); }
  }
  const wall = chars.has(WALL);
  const grass = chars.has(GRASS);
  return { wall, water: chars.has(WATER), grass, mud: chars.has(MUD), enclosed: wall && !grass };
}

type Map2 = string[][];

const inside = (w: number, h: number, x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h;

function blob(rng: Rng, map: Map2, ch: string, size: number): void {
  const h = map.length;
  const w = map[0]!.length;
  let x = rng.int(0, w - 1);
  let y = rng.int(0, h - 1);
  for (let i = 0; i < size; i++) {
    if (inside(w, h, x, y)) map[y]![x] = ch;
    const d = rng.int(0, 3);
    x += d === 0 ? 1 : d === 1 ? -1 : 0;
    y += d === 2 ? 1 : d === 3 ? -1 : 0;
    x = Math.max(0, Math.min(w - 1, x));
    y = Math.max(0, Math.min(h - 1, y));
  }
}

/** A straight wall band across the map with 1–2 gaps of 1–2 tiles (chokepoints). */
function band(rng: Rng, map: Map2, ch: string): void {
  const h = map.length;
  const w = map[0]!.length;
  const vertical = rng.next() < 0.5;
  const len = vertical ? h : w;
  const pos = vertical ? rng.int(4, w - 5) : rng.int(3, h - 4);
  const start = rng.int(0, 1);
  const end = len - 1 - rng.int(0, 1);
  const gaps = new Set<number>();
  const gapCount = rng.int(1, 2);
  for (let g = 0; g < gapCount; g++) {
    const at = rng.int(start + 1, end - 2);
    const width = rng.int(1, 2);
    for (let i = 0; i < width; i++) gaps.add(at + i);
  }
  for (let i = start; i <= end; i++) {
    if (gaps.has(i)) continue;
    if (vertical) map[i]![pos] = ch;
    else map[pos]![i] = ch;
  }
}

/** A small walled room with exactly one opening; the inside may hold cover. */
function pocket(rng: Rng, map: Map2, ch: string, filler: string | null): void {
  const h = map.length;
  const w = map[0]!.length;
  const pw = rng.int(4, 5);
  const ph = rng.int(4, 5);
  const x0 = rng.int(1, w - pw - 1);
  const y0 = rng.int(1, h - ph - 1);
  const border: Point[] = [];
  for (let y = y0; y < y0 + ph; y++) {
    for (let x = x0; x < x0 + pw; x++) {
      const edge = x === x0 || y === y0 || x === x0 + pw - 1 || y === y0 + ph - 1;
      if (edge) {
        map[y]![x] = ch;
        const corner = (x === x0 || x === x0 + pw - 1) && (y === y0 || y === y0 + ph - 1);
        if (!corner) border.push({ x, y });
      } else {
        map[y]![x] = filler && rng.next() < 0.4 ? filler : FLOOR;
      }
    }
  }
  const door = rng.pick(border);
  map[door.y]![door.x] = FLOOR;
}

function density(map: Map2): number {
  let n = 0;
  let total = 0;
  for (const row of map) for (const c of row) { total++; if (c !== FLOOR) n++; }
  return n / total;
}

function buildTerrain(rng: Rng, w: number, h: number, p: Palette): Map2 {
  const map: Map2 = Array.from({ length: h }, () => Array.from({ length: w }, () => FLOOR));
  const obstacle = p.wall ? WALL : p.water ? WATER : null;
  if (obstacle) {
    if (p.enclosed || rng.next() < 0.4) band(rng, map, obstacle);
    const pockets = p.enclosed ? rng.int(1, 2) : rng.int(0, 1);
    for (let i = 0; i < pockets; i++) pocket(rng, map, obstacle, p.grass ? GRASS : p.mud ? MUD : null);
  }
  const target = 0.2 + rng.next() * 0.08;
  const fillers: string[] = [];
  if (p.wall) fillers.push(WALL);
  if (p.water) fillers.push(WATER, WATER);
  if (p.grass) fillers.push(GRASS, GRASS, GRASS);
  if (p.mud) fillers.push(MUD);
  if (fillers.length === 0) fillers.push(GRASS);
  for (let guard = 0; guard < 60 && density(map) < target; guard++) {
    blob(rng, map, rng.pick(fillers), rng.int(2, 5));
  }
  return map;
}

// ---- formations ----

interface Zones {
  readonly player: Point[];
  /** One candidate list per enemy group; enemies are dealt round-robin across groups. */
  readonly enemies: Point[][];
  /** Fixed tile for the first enemy (boss). */
  readonly boss?: Point;
  readonly spread?: boolean;
}

function box(x0: number, y0: number, x1: number, y1: number, w: number, h: number): Point[] {
  const out: Point[] = [];
  for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++)
    for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) out.push({ x, y });
  return out;
}

function zonesFor(rng: Rng, f: Formation, w: number, h: number, playerCount: number): Zones {
  const flipX = rng.next() < 0.5;
  const flipY = rng.next() < 0.5;
  const fx = (p: Point): Point => ({ x: flipX ? w - 1 - p.x : p.x, y: flipY ? h - 1 - p.y : p.y });
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);
  const need = playerCount + 2;
  switch (f) {
    case "sides": {
      const depth = Math.max(2, Math.ceil(need / (h - 2)));
      return { player: box(0, 1, depth - 1, h - 2, w, h).map(fx), enemies: [box(w - 3, 0, w - 1, h - 1, w, h).map(fx)] };
    }
    case "topBottom": {
      const depth = Math.max(2, Math.ceil(need / (w - 4)));
      return { player: box(2, h - depth, w - 3, h - 1, w, h).map(fx), enemies: [box(1, 0, w - 2, 1, w, h).map(fx)] };
    }
    case "cornerVsCorner": {
      const pw = Math.max(4, Math.ceil(need / 3));
      return { player: box(0, h - 3, pw - 1, h - 1, w, h).map(fx), enemies: [box(w - 5, 0, w - 1, 3, w, h).map(fx)] };
    }
    case "pincer": {
      const depth = Math.max(2, Math.ceil(need / 5));
      return {
        player: box(0, cy - 2, depth - 1, cy + 2, w, h).map(fx),
        enemies: [box(w - 4, 0, w - 1, 2, w, h).map(fx), box(w - 4, h - 3, w - 1, h - 1, w, h).map(fx)],
      };
    }
    case "surrounded": {
      const half = Math.max(2, Math.ceil(Math.sqrt(need) / 2) + 1);
      const ring = box(0, 0, w - 1, h - 1, w, h).filter((p) => p.x <= 1 || p.y === 0 || p.x >= w - 2 || p.y === h - 1);
      return { player: box(cx - half, cy - 1, cx + half - 1, cy + 1, w, h), enemies: [ring], spread: true };
    }
    case "bossCenter": {
      const depth = Math.max(2, Math.ceil(need / (h - 2)));
      const boss = { x: cx + 1, y: cy };
      const around = box(boss.x - 2, boss.y - 2, boss.x + 2, boss.y + 2, w, h).filter((p) => gridDistance(p, boss) === 2);
      return { player: box(0, 1, depth - 1, h - 2, w, h).map(fx), enemies: [around.map(fx)], boss: fx(boss), spread: true };
    }
  }
}

const passable = (c: string): boolean => (ASCII_LEGEND[c]?.moveCost ?? null) !== null;

/** Connected passable region from `start`. With the engine's no-corner-cutting rule, 8-dir connectivity equals 4-dir. */
function region(map: Map2, start: Point): Set<string> {
  const h = map.length;
  const w = map[0]!.length;
  const seen = new Set<string>([key(start)]);
  const queue: Point[] = [start];
  while (queue.length > 0) {
    const p = queue.shift()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const n = { x: p.x + dx, y: p.y + dy };
      if (!inside(w, h, n.x, n.y) || seen.has(key(n)) || !passable(map[n.y]![n.x]!)) continue;
      seen.add(key(n));
      queue.push(n);
    }
  }
  return seen;
}

function place(rng: Rng, map: Map2, zones: Zones, enemyCount: number, minDist: number, playerCount: number): GeneratedArena | null {
  const clear = (p: Point): void => { map[p.y]![p.x] = FLOOR; };
  zones.player.forEach(clear);
  if (zones.boss) clear(zones.boss);
  const reach = region(map, zones.player[0]!);
  const deploymentZone = zones.player.filter((p) => reach.has(key(p)));
  if (deploymentZone.length < playerCount + 2) return null;
  const farEnough = (p: Point): boolean => deploymentZone.every((d) => gridDistance(d, p) >= minDist);

  const enemySpawns: Point[] = [];
  const taken = new Set<string>();
  if (zones.boss && enemyCount > 0) {
    if (!reach.has(key(zones.boss)) || !farEnough(zones.boss)) return null;
    enemySpawns.push(zones.boss);
    taken.add(key(zones.boss));
  }
  const ok = (p: Point): boolean => map[p.y]![p.x] === FLOOR && reach.has(key(p)) && !taken.has(key(p)) && farEnough(p);
  const groups = zones.enemies.map((g) => rng.shuffle(g.filter(ok)));
  let gi = 0;
  let stalls = 0;
  while (enemySpawns.length < enemyCount && stalls < groups.length) {
    const g = groups[gi % groups.length]!.filter((p) => !taken.has(key(p)));
    gi++;
    if (g.length === 0) { stalls++; continue; }
    stalls = 0;
    let best = g[0]!;
    if (zones.spread && enemySpawns.length > 0) {
      const score = (p: Point): number => Math.min(...enemySpawns.map((e) => gridDistance(e, p)));
      for (const p of g) if (score(p) > score(best)) best = p;
    }
    enemySpawns.push(best);
    taken.add(key(best));
  }
  if (enemySpawns.length < enemyCount) return null;
  return { mapRows: map.map((r) => r.join("")), deploymentZone, enemySpawns };
}

export function generateArena(opts: GenerateArenaOptions): GeneratedArena {
  const width = opts.width ?? DEFAULT_WIDTH;
  const height = opts.height ?? (opts.base?.mapRows.length || DEFAULT_HEIGHT);
  const palette = paletteFor(opts.style, opts.base);
  const minDist = opts.formation === "surrounded" ? 2 : 3;
  const rng = new Rng((opts.seed ^ 0x9e3779b9) >>> 0);
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const map = buildTerrain(rng, width, height, palette);
    const zones = zonesFor(rng, opts.formation, width, height, opts.playerCount);
    const result = place(rng, map, zones, opts.enemyCount, minDist, opts.playerCount);
    if (result) return result;
  }
  // Fallback: open map; place as many enemies as the formation allows.
  for (let n = opts.enemyCount; n >= 0; n--) {
    const map: Map2 = Array.from({ length: height }, () => Array.from({ length: width }, () => FLOOR));
    const zones = zonesFor(rng, opts.formation, width, height, opts.playerCount);
    const result = place(rng, map, zones, n, minDist, opts.playerCount);
    if (result) return result;
  }
  throw new Error(`generateArena: cannot fit ${opts.playerCount} players on a ${width}x${height} map`);
}

/** A battle arena for a biome: generated with a formation for the situation, on the biome's terrain. */
export function battleArena(
  base: { readonly mapRows: readonly string[] }, style: string, seed: number, context: FormationContext, playerCount: number, enemyCount: number,
): GeneratedArena & { readonly formation: Formation } {
  const formation = pickFormation(seed, context);
  return { ...generateArena({ seed, style, formation, playerCount, enemyCount, base }), formation };
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
