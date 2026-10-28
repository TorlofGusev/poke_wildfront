import Phaser from "phaser";
/** Battle hexes (pointy-top, odd rows shifted right): centre-to-corner radius and width. */
export const HEX_R = 22.4;
export const TILE = Math.sqrt(3) * HEX_R;
/** Unit graphics are drawn for 48 px tiles and scaled to the board. */
export const UNIT_SCALE = TILE / 48;
export const BOARD_X = 12;
export const BOARD_Y = 72;
export const PANEL_X = 664;
/** Side panel width: the rest of the 960 px screen after the board. */
export const PANEL_W = 960 - PANEL_X - 8;

export const FONT = "monospace";

export const COLORS = {
  floor: 0x3b4a3a,
  grass: 0x2f6b34,
  mud: 0x6b5233,
  water: 0x2d5a8c,
  wall: 0x24262b,
  gridLine: 0x000000,
  zone: 0x7fd4ff,
  /** Movement range: teal, distinct from the blue deployment zone. */
  reach: 0x2ec4a6,
  /** Line joining two engaged Pokémon. */
  engage: 0xff8c42,
  /** Corner mark on a foe the active Pokémon would combo. */
  combo: 0xffd23f,
  target: 0xe2574a,
  area: 0xf5a623,
  areaAim: 0x9b6bff,
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
  dark: 0x705848, steel: 0xb8b8d0, fairy: 0xee99ac,
};

/** Centre of a battle hex on screen. */
export const tileToWorld = (p: { x: number; y: number }) => ({
  x: BOARD_X + TILE / 2 + p.x * TILE + (p.y & 1 ? TILE / 2 : 0),
  y: BOARD_Y + HEX_R + p.y * HEX_R * 1.5,
});

/** Screen size of a battle board of w × h hexes. */
/** Free battlefield: pixels per field unit (a hex width), and conversions to and from screen space. */
export const FIELD_S = 40;
export const fieldToWorld = (p: { x: number; y: number }) => ({ x: BOARD_X + p.x * FIELD_S, y: BOARD_Y + p.y * FIELD_S });
export const worldToField = (x: number, y: number) => ({ x: (x - BOARD_X) / FIELD_S, y: (y - BOARD_Y) / FIELD_S });

export const boardSize = (w: number, h: number) => ({ w: TILE * (w + 0.5), h: HEX_R * (1.5 * (h - 1) + 2) });

/** The six corners of a hex around (cx, cy). */
export const hexCorners = (cx: number, cy: number, r = HEX_R) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 30);
    return new Phaser.Math.Vector2(cx + r * Math.cos(a), cy + r * Math.sin(a));
  });

/** The battle hex under a screen point, or null when outside every hex. */
export const worldToTile = (x: number, y: number, w: number, h: number): { x: number; y: number } | null => {
  const row = Math.round((y - BOARD_Y - HEX_R) / (HEX_R * 1.5));
  let best: { x: number; y: number } | null = null, bd = Infinity;
  for (let ry = row - 1; ry <= row + 1; ry++) {
    if (ry < 0 || ry >= h) continue;
    const col = Math.round((x - BOARD_X - TILE / 2 - (ry & 1 ? TILE / 2 : 0)) / TILE);
    for (let rx = col - 1; rx <= col + 1; rx++) {
      if (rx < 0 || rx >= w) continue;
      const c = tileToWorld({ x: rx, y: ry });
      const d = (c.x - x) ** 2 + (c.y - y) ** 2;
      if (d < bd) { bd = d; best = { x: rx, y: ry }; }
    }
  }
  return bd <= HEX_R * HEX_R ? best : null;
};

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

/** Touch device with a small screen (a phone): small text is bumped up so it stays readable once scaled down. */
export const PHONE =
  typeof window !== "undefined" &&
  window.matchMedia?.("(pointer: coarse)").matches === true &&
  Math.min(window.screen.width, window.screen.height) < 600;

const SMALL_TEXT_BUMP = PHONE ? 2 : 0;

/** Font size in px for small UI text (≤ 13px), larger on phones. */
export const fs = (n: number): number => (n <= 13 ? n + SMALL_TEXT_BUMP : n);
export const px = (n: number): string => `${fs(n)}px`;
