export interface Point {
  readonly x: number;
  readonly y: number;
}

export const key = (p: Point): string => `${p.x},${p.y}`;

export const samePoint = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y;

/** Grid distance with 4-directional movement. */
export const manhattan = (a: Point, b: Point): number =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** Battle distance: battles use a hex grid (see hex.ts), so the six surrounding hexes are at distance 1. */
export { hexDistance as gridDistance } from "./hex";

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
