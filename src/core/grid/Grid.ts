import { DEFAULT_TERRAIN, type TerrainDef } from "./terrain";
import { NEIGHBOR_OFFSETS, type Point } from "./types";

/** Immutable rectangular battle grid of terrain tiles. */
export class Grid {
  private readonly tiles: readonly TerrainDef[];

  constructor(
    readonly width: number,
    readonly height: number,
    tiles: readonly TerrainDef[],
  ) {
    if (tiles.length !== width * height) {
      throw new Error(`Grid expects ${width * height} tiles, got ${tiles.length}`);
    }
    this.tiles = tiles;
  }

  /**
   * Builds a grid from rows of characters, e.g. for tests and scenarios.
   * The legend maps each character to a terrain definition.
   */
  static fromAscii(
    rows: readonly string[],
    legend: Readonly<Record<string, TerrainDef>> = ASCII_LEGEND,
  ): Grid {
    const height = rows.length;
    const width = rows[0]?.length ?? 0;
    const tiles = rows.flatMap((row, y) => {
      if (row.length !== width) throw new Error(`Row ${y} has length ${row.length}, expected ${width}`);
      return [...row].map((ch) => {
        const def = legend[ch];
        if (!def) throw new Error(`Unknown terrain character '${ch}'`);
        return def;
      });
    });
    return new Grid(width, height, tiles);
  }

  inBounds(p: Point): boolean {
    return p.x >= 0 && p.y >= 0 && p.x < this.width && p.y < this.height;
  }

  terrainAt(p: Point): TerrainDef {
    if (!this.inBounds(p)) throw new Error(`Out of bounds: ${p.x},${p.y}`);
    return this.tiles[p.y * this.width + p.x]!;
  }

  isPassable(p: Point): boolean {
    return this.inBounds(p) && this.terrainAt(p).moveCost !== null;
  }

  neighbors(p: Point): Point[] {
    return NEIGHBOR_OFFSETS.map((o) => ({ x: p.x + o.x, y: p.y + o.y })).filter((n) =>
      this.inBounds(n),
    );
  }
}

export const ASCII_LEGEND: Readonly<Record<string, TerrainDef>> = {
  ".": DEFAULT_TERRAIN.floor!,
  '"': DEFAULT_TERRAIN.grass!,
  "~": DEFAULT_TERRAIN.water!,
  "#": DEFAULT_TERRAIN.wall!,
  m: DEFAULT_TERRAIN.mud!,
};
