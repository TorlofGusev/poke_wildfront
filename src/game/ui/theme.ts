export const TILE = 48;
export const BOARD_X = 16;
export const BOARD_Y = 72;
export const PANEL_X = 616;

export const FONT = "monospace";

export const COLORS = {
  floor: 0x3b4a3a,
  grass: 0x2f6b34,
  mud: 0x6b5233,
  water: 0x2d5a8c,
  wall: 0x24262b,
  gridLine: 0x000000,
  zone: 0x4a90e2,
  reach: 0x4a90e2,
  target: 0xe2574a,
  area: 0xf5a623,
  player: 0x4a90e2,
  enemy: 0xd0021b,
  active: 0xf5d76e,
  text: "#e8ecf4",
  dim: "#8a93a6",
  good: "#7ed321",
  bad: "#ff6b6b",
} as const;

/** Placeholder unit colours by primary type (no Pokémon artwork yet). */
export const TYPE_COLORS: Record<string, number> = {
  normal: 0xa8a878, fire: 0xf08030, water: 0x6890f0, electric: 0xf8d030, grass: 0x78c850,
  ice: 0x98d8d8, fighting: 0xc03028, poison: 0xa040a0, ground: 0xe0c068, flying: 0xa890f0,
  psychic: 0xf85888, bug: 0xa8b820, rock: 0xb8a038, ghost: 0x705898, dragon: 0x7038f8,
};

export const tileToWorld = (p: { x: number; y: number }) => ({
  x: BOARD_X + p.x * TILE + TILE / 2,
  y: BOARD_Y + p.y * TILE + TILE / 2,
});
