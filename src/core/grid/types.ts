export interface Point {
  readonly x: number;
  readonly y: number;
}

export const key = (p: Point): string => `${p.x},${p.y}`;

export const samePoint = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y;

/** Grid distance with 4-directional movement. */
export const manhattan = (a: Point, b: Point): number =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/**
 * Battle distance with 8-directional movement, diagonals alternating 1 and 2 (1, 3, 4, 6…):
 * all eight surrounding tiles are at distance 1, and long diagonals are not a shortcut.
 */
export const gridDistance = (a: Point, b: Point): number => {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return Math.max(dx, dy) + Math.floor(Math.min(dx, dy) / 2);
};

export const DIAGONAL_OFFSETS: readonly Point[] = [
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];

export const NEIGHBOR_OFFSETS: readonly Point[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];
