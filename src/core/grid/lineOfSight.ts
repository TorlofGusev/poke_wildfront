import type { Grid } from "./Grid";
import { samePoint, type Point } from "./types";

/**
 * Tiles crossed by the straight line between tile centres, excluding both ends.
 * Uses a supercover walk; when the line passes exactly through a corner,
 * both adjacent tiles are included, so corners block conservatively and
 * the result is symmetric.
 */
export function tilesBetween(a: Point, b: Point): Point[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const nx = Math.abs(dx);
  const ny = Math.abs(dy);
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const out: Point[] = [];
  let x = a.x;
  let y = a.y;
  let ix = 0;
  let iy = 0;
  while (ix < nx || iy < ny) {
    const decision = (1 + 2 * ix) * ny - (1 + 2 * iy) * nx;
    if (decision === 0) {
      // Exactly through a corner: record both side tiles, then step diagonally.
      out.push({ x: x + sx, y }, { x, y: y + sy });
      x += sx;
      y += sy;
      ix++;
      iy++;
    } else if (decision < 0) {
      x += sx;
      ix++;
    } else {
      y += sy;
      iy++;
    }
    out.push({ x, y });
  }
  return out.filter((p) => !samePoint(p, a) && !samePoint(p, b));
}

/** True if no sight-blocking terrain (and no tile `blocked` marks, e.g. a standing Pokémon) lies strictly between a and b. */
export function hasLineOfSight(grid: Grid, a: Point, b: Point, blocked?: (p: Point) => boolean): boolean {
  return tilesBetween(a, b).every((p) => !grid.terrainAt(p).blocksSight && !blocked?.(p));
}
