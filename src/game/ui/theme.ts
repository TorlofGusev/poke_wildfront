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

const toHex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

/** Semantic colours for `{key|text}` markup; any Pokémon type name also works as a key. */
export const MARKUP_COLORS: Record<string, string> = {
  dmg: "#ff8a5c",
  heal: "#7ed321",
  status: "#c58cff",
  player: "#8fb8f0",
  enemy: "#f08f8f",
  num: "#f5d76e",
  dim: "#8a93a6",
  good: "#7ed321",
  bad: "#ff6b6b",
  basic: "#c8d0e0",
  special: "#6fc3ff",
  ultimate: "#ffb347",
  ko: "#ff5050",
  title: "#f5d76e",
};

/** Team chip backgrounds for `ally:<type>` / `foe:<type>` markup. */
export const TEAM_BACKGROUNDS = { ally: "#0f3a1c", foe: "#4a1016" } as const;

/** Mixes a #rrggbb colour towards white so type colours stay readable on dark chips. */
function lighten(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return toHex((mix(n >> 16) << 16) | (mix((n >> 8) & 0xff) << 8) | mix(n & 0xff));
}

export interface MarkupStyle {
  readonly color: string;
  readonly background?: string;
}

export function markupStyle(key: string): MarkupStyle {
  const [team, type] = key.split(":");
  if ((team === "ally" || team === "foe") && type) {
    return { color: type === "unknown" ? "#d0d4dc" : lighten(markupColor(type), 0.35), background: TEAM_BACKGROUNDS[team] };
  }
  return { color: markupColor(key) };
}

export function markupColor(key: string): string {
  if (MARKUP_COLORS[key]) return MARKUP_COLORS[key]!;
  const typeColor = TYPE_COLORS[key];
  return typeColor !== undefined ? toHex(typeColor) : "#e8ecf4";
}
