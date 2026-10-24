/** Static properties of a terrain type. Content data maps tile ids to these. */
export interface TerrainDef {
  readonly id: string;
  /** Movement points needed to enter the tile; null = impassable. */
  readonly moveCost: number | null;
  /** Whether the tile blocks line of sight. */
  readonly blocksSight: boolean;
  /** Units standing here cannot be targeted from range (> 1 tile). */
  readonly concealsAtRange: boolean;
}

export const DEFAULT_TERRAIN: Readonly<Record<string, TerrainDef>> = {
  floor: { id: "floor", moveCost: 1, blocksSight: false, concealsAtRange: false },
  grass: { id: "grass", moveCost: 1, blocksSight: false, concealsAtRange: true },
  mud: { id: "mud", moveCost: 2, blocksSight: false, concealsAtRange: false },
  water: { id: "water", moveCost: null, blocksSight: false, concealsAtRange: false },
  wall: { id: "wall", moveCost: null, blocksSight: true, concealsAtRange: false },
};
