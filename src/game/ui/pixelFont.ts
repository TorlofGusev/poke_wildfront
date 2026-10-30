import Phaser from "phaser";

/**
 * A pixel font drawn in code, in the spirit of the handhelds' 8-pixel fonts: 5×7 capitals, lowercase with
 * descenders, digits, the punctuation the battle needs and the Hungarian accented letters. Each glyph is baked
 * white with a 1 px dark outline into a canvas and registered as a bitmap font; tint it for colour and show it at
 * whole scales (2× by default) so the pixels stay square.
 */

/** Rows from the cap line down (row 2 of the cell; rows 0–1 hold capital accents). `#` is ink. */
const GLYPHS: Readonly<Record<string, string>> = {
  A: ".###. #...# #...# ##### #...# #...# #...#",
  B: "####. #...# #...# ####. #...# #...# ####.",
  C: ".###. #...# #.... #.... #.... #...# .###.",
  D: "####. #...# #...# #...# #...# #...# ####.",
  E: "##### #.... #.... ####. #.... #.... #####",
  F: "##### #.... #.... ####. #.... #.... #....",
  G: ".###. #...# #.... #.### #...# #...# .####",
  H: "#...# #...# #...# ##### #...# #...# #...#",
  I: "### .#. .#. .#. .#. .#. ###",
  J: "..### ...#. ...#. ...#. #..#. #..#. .##..",
  K: "#...# #..#. #.#.. ##... #.#.. #..#. #...#",
  L: "#.... #.... #.... #.... #.... #.... #####",
  M: "#...# ##.## #.#.# #.#.# #...# #...# #...#",
  N: "#...# ##..# #.#.# #..## #...# #...# #...#",
  O: ".###. #...# #...# #...# #...# #...# .###.",
  P: "####. #...# #...# ####. #.... #.... #....",
  Q: ".###. #...# #...# #...# #.#.# #..#. .##.#",
  R: "####. #...# #...# ####. #.#.. #..#. #...#",
  S: ".#### #.... #.... .###. ....# ....# ####.",
  T: "##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..",
  U: "#...# #...# #...# #...# #...# #...# .###.",
  V: "#...# #...# #...# #...# #...# .#.#. ..#..",
  W: "#...# #...# #...# #.#.# #.#.# ##.## #...#",
  X: "#...# #...# .#.#. ..#.. .#.#. #...# #...#",
  Y: "#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..",
  Z: "##### ....# ...#. ..#.. .#... #.... #####",
  a: "..... ..... .###. ....# .#### #...# .####",
  b: "#.... #.... ####. #...# #...# #...# ####.",
  c: "..... ..... .###. #.... #.... #.... .###.",
  d: "....# ....# .#### #...# #...# #...# .####",
  e: "..... ..... .###. #...# ##### #.... .###.",
  f: "..## .#.. #### .#.. .#.. .#.. .#..",
  g: "..... ..... .#### #...# #...# #...# .#### ....# .###.",
  h: "#.... #.... ####. #...# #...# #...# #...#",
  i: ".#. ... ##. .#. .#. .#. ###",
  ı: "... ... ##. .#. .#. .#. ###",
  j: "..# ... .## ..# ..# ..# ..# #.# .#.",
  k: "#... #... #..# #.#. ##.. #.#. #..#",
  l: "##. .#. .#. .#. .#. .#. ###",
  m: "..... ..... ##.#. #.#.# #.#.# #.#.# #...#",
  n: "..... ..... ####. #...# #...# #...# #...#",
  o: "..... ..... .###. #...# #...# #...# .###.",
  p: "..... ..... ####. #...# #...# #...# ####. #.... #....",
  q: "..... ..... .#### #...# #...# #...# .#### ....# ....#",
  r: ".... .... #.## ##.. #... #... #...",
  s: "..... ..... .#### #.... .###. ....# ####.",
  t: ".#.. .#.. #### .#.. .#.. .#.. ..##",
  u: "..... ..... #...# #...# #...# #...# .####",
  v: "..... ..... #...# #...# #...# .#.#. ..#..",
  w: "..... ..... #...# #...# #.#.# #.#.# .#.#.",
  x: "..... ..... #...# .#.#. ..#.. .#.#. #...#",
  y: "..... ..... #...# #...# #...# #...# .#### ....# .###.",
  z: "..... ..... ##### ...#. ..#.. .#... #####",
  "0": ".###. #...# #...# #...# #...# #...# .###.",
  "1": "..#.. .##.. ..#.. ..#.. ..#.. ..#.. .###.",
  "2": ".###. #...# ....# ...#. ..#.. .#... #####",
  "3": "####. ....# ....# .###. ....# ....# ####.",
  "4": "...#. ..##. .#.#. #..#. ##### ...#. ...#.",
  "5": "##### #.... ####. ....# ....# #...# .###.",
  "6": ".###. #.... #.... ####. #...# #...# .###.",
  "7": "##### ....# ...#. ..#.. .#... .#... .#...",
  "8": ".###. #...# #...# .###. #...# #...# .###.",
  "9": ".###. #...# #...# .#### ....# ....# .###.",
  ".": ". . . . . . #",
  ",": ". . . . . . .# #.",
  "!": "# # # # # . #",
  "?": ".###. #...# ...#. ..#.. ..#.. ..... ..#..",
  ":": ". . # . . # .",
  ";": ".. .. .# .. .. .# #.",
  "-": ".... .... .... ####",
  "–": "..... ..... ..... #####",
  "—": "..... ..... ..... #####",
  "+": "... ... .#. ### .#.",
  "=": ".... .... #### .... ####",
  "/": "....# ...#. ...#. ..#.. .#... .#... #....",
  "(": ".# #. #. #. #. #. .#",
  ")": "#. .# .# .# .# .# #.",
  "[": "## #. #. #. #. #. ##",
  "]": "## .# .# .# .# .# ##",
  "'": "# #",
  "’": "# #",
  '"': "#.# #.#",
  "„": ". . . . . . #.# #.#",
  "”": "#.# #.#",
  "%": "##..# ##.#. ...#. ..#.. .#... .#.## #..##",
  "·": ". . . #",
  "×": "... ... #.# .#. #.#",
  "…": "..... ..... ..... ..... ..... ..... #.#.#",
  "₽": "####. #...# #...# ####. #.... ###.. #....",
  "●": "..... .###. ##### ##### ##### .###.",
  "○": "..... .###. #...# #...# #...# .###.",
  "▶": "#... ##.. ###. #### ###. ##.. #...",
  "▼": "..... ..... ##### .###. ..#..",
  "←": "..... ..#.. .#... ##### .#... ..#..",
  "→": "..... ..#.. ...#. ##### ...#. ..#..",
  "✕": "..... #...# .#.#. ..#.. .#.#. #...#",
  "⏳": "##### #...# .#.#. ..#.. .#.#. #...# #####",
  "#": ".#.#. ##### .#.#. .#.#. ##### .#.#.",
  "<": "... ..# .#. #.. .#. ..#",
  ">": "... #.. .#. ..# .#. #..",
  "*": "..... #.#.# .###. ##### .###. #.#.#",
  "&": ".##.. #..#. .##.. .#... #.#.# #..#. .##.#",
  // UI icons in place of emoji (which look different on every system): 7×7 at most, tinted like text.
  "◀": "...# ..## .### #### .### ..## ...#",
  "★": "...#... ...#... ####### .#####. ..###.. .##.##. .#...#.",
  "✦": "...#... ...#... ..###.. ####### ..###.. ...#... ...#...",
  "✨": ".#..... ###.... .#..#.. ...###. ..##### ...###. ....#..",
  "✓": "......# .....## #...##. ##.##.. .###... ..#....",
  "\uE000": "####### #.....# #.###.# #.....# #.....# ####### ..#....", // 📖
  "\uE001": "..###.. .#...#. ####### #.....# #.###.# #.....# #######", // 🎒
  "⛺": "...##.. ...#... ..###.. .##.##. ##...## #..#..# #######",
  "\uE002": ".#####. #.....# #.#.#.# #.....# .#####. .#..... #......", // 💬
  "\uE003": ".#####. #..#..# ####### #..#..# #..#..# #..#..# #######", // 📦
  "ⓘ": ".#####. #..#..# #.....# #..#..# #..#..# #..#..# .#####.",
  "\uE004": "#...... ####### .#####. .#####. .#..... ..##### ..#..#.", // 🛒
  "⌂": "...#... ..###.. .#####. ####### .#...#. .#.#.#. .#.#.#.",
  "↩": ".....## ......# ..#...# .##...# ####### .##.... ..#....",
  "⛶": "##...## #.....# ....... ....... ....... #.....# ##...##",
  "♪": "...##.. ...#.#. ...#... ...#... .###... ####... .##....",
  "\uE005": ".###... #...#.. #...#.. #...#.. .####.. ....##. .....##", // 🔍
  "\uE006": ".###. #...# #...# #...# .#.#. .###. .###.", // 💡
  "\uE007": ".###. #...# #...# ##### ##.## ##.## #####", // 🔒
  "\uE008": "##..##. #.##..# #..#..# #..#..# #..#..# #..##.# .##..##", // 🗺
  "♥": ".##.##. ####### ####### .#####. ..###.. ...#...",
  "⚔": "#.....# .#...#. ..#.#.. ...#... ..#.#.. ##...## ##...##",
  "⚡": "...## ..##. .##.. ##### ..##. .##.. ##...",
  "⚠": "...#... ..#.#.. ..#.#.. .#.#.#. .#.#.#. #.....# #######",
  "✚": "..###.. ..###.. ####### ####### ####### ..###.. ..###..",
  "↔": "....... ..#.#.. .#...#. ####### .#...#. ..#.#..",
  "▲": "...#... ..###.. .#####. #######",
};

/** Accented letters: base glyph and mark (acute, double acute, umlaut). */
const ACCENTS: Readonly<Record<string, [string, "acute" | "double" | "umlaut"]>> = {
  Á: ["A", "acute"], É: ["E", "acute"], Í: ["I", "acute"], Ó: ["O", "acute"], Ö: ["O", "umlaut"], Ő: ["O", "double"],
  Ú: ["U", "acute"], Ü: ["U", "umlaut"], Ű: ["U", "double"],
  á: ["a", "acute"], é: ["e", "acute"], í: ["ı", "acute"], ó: ["o", "acute"], ö: ["o", "umlaut"], ő: ["o", "double"],
  ú: ["u", "acute"], ü: ["u", "umlaut"], ű: ["u", "double"],
};

const MARKS = {
  acute: ["...#", "..#."],
  double: ["..#.#", ".#.#."],
  umlaut: [".....", ".#.#."],
};

export const PIXEL_FONT = "pixel";
/** Cell height at 1×: 2 accent rows, 7 cap rows, 2 descender rows, 1 px outline above and below. */
const CELL_H = 13;
const SPACE = 3;

/** A glyph as rows of 11 (accent rows first) and its ink width. */
function glyphRows(ch: string): { rows: string[]; width: number } | null {
  const accent = ACCENTS[ch];
  const src = GLYPHS[accent ? accent[0] : ch];
  if (src === undefined) return null;
  const body = src.split(" ");
  const width = Math.max(...body.map((r) => r.length));
  const rows = ["", "", ...body];
  while (rows.length < 11) rows.push("");
  if (accent) {
    // Narrow letters (I, i) get a narrower acute.
    const mark = width <= 3 && accent[1] === "acute" ? ["..#", ".#."] : MARKS[accent[1]];
    // Capitals carry it in the two rows above; lowercase over the x-height (their rows 2–3 are empty).
    const at = ch === ch.toUpperCase() ? 0 : 2;
    const shift = Math.max(0, Math.floor((width - mark[0]!.length) / 2));
    mark.forEach((m, i) => (rows[at + i] = (".".repeat(shift) + m).padEnd(width, ".")));
  }
  return { rows: rows.map((r) => r.padEnd(width, ".")), width };
}

/** Registers the font once per game (the texture and font data live in the game's caches). */
export function ensurePixelFont(scene: Phaser.Scene, outline = true): string {
  const font = outline ? PIXEL_FONT : `${PIXEL_FONT}-clean`;
  if (scene.cache.bitmapFont.exists(font)) return font;
  const chars = [...Object.keys(GLYPHS), ...Object.keys(ACCENTS)];
  const glyphs = chars.map((ch) => ({ ch, g: glyphRows(ch)! }));
  const perRow = 16;
  const cellW = 9; // the widest glyph (5) plus outline, with room
  const texW = perRow * cellW, texH = Math.ceil((glyphs.length + 1) / perRow) * CELL_H;
  const tex = scene.textures.createCanvas(`${font}-tex`, texW, texH)!;
  const ctx = tex.getContext();
  const data: Phaser.Types.GameObjects.BitmapText.BitmapFontData = { font, size: CELL_H, lineHeight: CELL_H + 1, retroFont: true, chars: {} };
  const add = (code: number, x: number, y: number, w: number, advance: number) => {
    data.chars[code] = {
      x, y, width: w, height: CELL_H, centerX: Math.floor(w / 2), centerY: Math.floor(CELL_H / 2), xOffset: 0, yOffset: 0, xAdvance: advance,
      data: {}, kerning: {}, u0: x / texW, v0: 1 - y / texH, u1: (x + w) / texW, v1: 1 - (y + CELL_H) / texH,
    } as Phaser.Types.GameObjects.BitmapText.BitmapFontCharacterData;
  };
  glyphs.forEach(({ ch, g }, i) => {
    const ox = (i % perRow) * cellW, oy = Math.floor(i / perRow) * CELL_H;
    const ink = (x: number, y: number) => g.rows[y]?.[x] === "#";
    // Outline first (every empty pixel touching ink, diagonals too), then the ink.
    ctx.fillStyle = outline ? "#10141c" : "rgba(0,0,0,0)";
    for (let y = -1; y <= 11; y++)
      for (let x = -1; x <= g.width; x++) {
        if (ink(x, y)) continue;
        let near = false;
        for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1 && !near; dx++) near = ink(x + dx, y + dy);
        if (near) ctx.fillRect(ox + 1 + x, oy + 1 + y, 1, 1);
      }
    ctx.fillStyle = "#ffffff";
    for (let y = 0; y < 11; y++) for (let x = 0; x < g.width; x++) if (ink(x, y)) ctx.fillRect(ox + 1 + x, oy + 1 + y, 1, 1);
    add(ch.charCodeAt(0), ox, oy, g.width + 2, g.width + 1);
  });
  // The space: an empty cell.
  const si = glyphs.length;
  add(32, (si % perRow) * cellW, Math.floor(si / perRow) * CELL_H, SPACE, SPACE);
  tex.refresh();
  tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
  scene.cache.bitmapFont.add(font, { data, texture: `${font}-tex`, frame: null });
  return font;
}

/** Symbols drawn with another glyph; emoji map to private-use stand-ins (bitmap text reads one UTF-16 unit per glyph). */
const ALIASES: Readonly<Record<string, string>> = { "➜": "→", "❤": "♥", "⭐": "★", "🌟": "★", "📖": "\uE000", "🎒": "\uE001", "💬": "\uE002", "📦": "\uE003", "🛒": "\uE004", "🔍": "\uE005", "💡": "\uE006", "🔒": "\uE007", "🗺": "\uE008" };

/** Whether this is a symbol (not a letter, digit or punctuation) the pixel font draws: a leading one becomes a pixel icon. */
export const hasPixGlyph = (c: string): boolean => !/[\p{L}\p{N}\p{P}+=<>]/u.test(c) && GLYPHS[ALIASES[c] ?? c] !== undefined;

/** Letters the font lacks fall back to near ones (or go). */
function normalize(s: string): string {
  return [...s].map((c) => {
    const k = ALIASES[c] ?? c;
    return k === "\n" || k === " " || GLYPHS[k] !== undefined || ACCENTS[k] ? k : "";
  }).join("");
}

/** Pixel text at a whole scale (2× reads like the handhelds on this screen), tinted. */
export function pixText(scene: Phaser.Scene, x: number, y: number, text: string, color = 0xffffff, scale = 2, outline = true): Phaser.GameObjects.BitmapText {
  return scene.add.bitmapText(x, y, ensurePixelFont(scene, outline), normalize(text), CELL_H * scale).setTint(color);
}

/** Changes a pixel text's words, with the same fallbacks. */
export function setPixText(t: Phaser.GameObjects.BitmapText, text: string): Phaser.GameObjects.BitmapText {
  return t.setText(normalize(text));
}
