import type Phaser from "phaser";

/**
 * Small drawn item icons (24×24), in the spirit of the ball icons: a few simple shapes in the item's
 * colours, so the bag, shop and equipment lists read at a glance. Unknown items get a plain pouch.
 */

type Ctx = CanvasRenderingContext2D;
const OUT = "#111";

const stroke = (g: Ctx, w = 1.5) => {
  g.lineWidth = w;
  g.strokeStyle = OUT;
  g.stroke();
};
const fill = (g: Ctx, color: string, line = true) => {
  g.fillStyle = color;
  g.fill();
  if (line) stroke(g);
};
const circle = (g: Ctx, x: number, y: number, r: number, color: string) => {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  fill(g, color);
};
const poly = (g: Ctx, pts: readonly (readonly [number, number])[], color: string) => {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  fill(g, color);
};
const rect = (g: Ctx, x: number, y: number, w: number, h: number, color: string) => {
  g.beginPath();
  g.rect(x, y, w, h);
  fill(g, color);
};

/** A spray bottle (Potion family). */
const bottle = (body: string) => (g: Ctx) => {
  rect(g, 9, 2, 6, 4, "#d8d8d8");
  rect(g, 7, 6, 10, 15, body);
  rect(g, 9, 10, 6, 6, "#f4f4f4");
};
/** A round berry with a leaf. */
const berry = (color: string) => (g: Ctx) => {
  circle(g, 12, 14, 7.5, color);
  poly(g, [[12, 6], [17, 2], [19, 5]], "#3f9c35");
  circle(g, 9.5, 11.5, 1.6, "rgba(255,255,255,0.7)");
};
/** A drop (water, fairy). */
const drop = (color: string) => (g: Ctx) => {
  g.beginPath();
  g.moveTo(12, 2);
  g.bezierCurveTo(20, 12, 19, 21, 12, 21);
  g.bezierCurveTo(5, 21, 4, 12, 12, 2);
  fill(g, color);
  circle(g, 9.5, 15, 1.6, "rgba(255,255,255,0.7)");
};
/** A rough stone or lump. */
const lump = (color: string) => (g: Ctx) => poly(g, [[5, 15], [7, 7], [13, 4], [19, 8], [20, 16], [14, 20], [8, 20]], color);
/** A crystal (ice, metal). */
const crystal = (color: string) => (g: Ctx) => poly(g, [[12, 2], [19, 9], [16, 21], [8, 21], [5, 9]], color);
/** A band or ring of cloth. */
const band = (color: string) => (g: Ctx) => {
  g.beginPath();
  g.ellipse(12, 12, 9, 6, 0, 0, Math.PI * 2);
  g.lineWidth = 5;
  g.strokeStyle = OUT;
  g.stroke();
  g.lineWidth = 3;
  g.strokeStyle = color;
  g.stroke();
};
/** A pointed fang, beak or barb. */
const spike = (color: string) => (g: Ctx) => poly(g, [[6, 4], [18, 4], [12, 21]], color);
/** Sparkling powder. */
const powder = (color: string) => (g: Ctx) => {
  circle(g, 12, 16, 6, color);
  for (const [x, y] of [[5, 5], [18, 4], [20, 11]] as const) poly(g, [[x, y - 3], [x + 1, y], [x, y + 3], [x - 1, y]], "#fff8c0");
};
/** A paper tag or ticket. */
const card = (color: string, mark: string) => (g: Ctx) => {
  rect(g, 4, 6, 16, 12, color);
  rect(g, 7, 10, 10, 4, mark);
};
/** A disc (the HMs). */
const disc = (color: string) => (g: Ctx) => {
  circle(g, 12, 12, 9, color);
  circle(g, 12, 12, 2.5, "#f4f4f4");
};
/** A fossil shell, spiral or dome. */
const shell = (color: string) => (g: Ctx) => {
  g.beginPath();
  g.arc(12, 15, 8, Math.PI, 0);
  g.closePath();
  fill(g, color);
  for (const x of [8, 12, 16]) {
    g.beginPath();
    g.moveTo(x, 15);
    g.lineTo(12, 8);
    stroke(g, 1);
  }
};
/** A key. */
const key = (color: string) => (g: Ctx) => {
  circle(g, 8, 8, 5, color);
  rect(g, 11, 11, 10, 3, color);
  rect(g, 17, 14, 3, 4, color);
};

const DRAW: Readonly<Record<string, (g: Ctx) => void>> = {
  potion: bottle("#9b59d0"),
  "super-potion": bottle("#e8762d"),
  candy: (g) => {
    poly(g, [[3, 8], [7, 12], [3, 16]], "#6ec6ff");
    poly(g, [[21, 8], [17, 12], [21, 16]], "#6ec6ff");
    circle(g, 12, 12, 6, "#2f6fd6");
    circle(g, 10, 10, 1.6, "rgba(255,255,255,0.8)");
  },
  "oran-berry": berry("#3a6fd8"),
  "cheri-berry": berry("#e3350d"),
  "pecha-berry": berry("#f29ac0"),
  "rawst-berry": berry("#4cc0b0"),
  "revival-herb": (g) => {
    poly(g, [[12, 21], [5, 8], [12, 3]], "#3f9c35");
    poly(g, [[12, 21], [19, 8], [12, 3]], "#57b847");
  },
  charcoal: lump("#5a5a5a"),
  "mystic-water": drop("#3a8ee8"),
  "miracle-seed": (g) => {
    g.beginPath();
    g.ellipse(12, 13, 5, 8, 0.4, 0, Math.PI * 2);
    fill(g, "#7ed321");
    poly(g, [[13, 5], [18, 2], [17, 6]], "#3f9c35");
  },
  magnet: (g) => {
    g.beginPath();
    g.arc(12, 11, 7, Math.PI, 0);
    g.lineWidth = 6;
    g.strokeStyle = OUT;
    g.stroke();
    g.lineWidth = 4;
    g.strokeStyle = "#e3350d";
    g.stroke();
    rect(g, 3, 11, 5, 8, "#d8d8d8");
    rect(g, 16, 11, 5, 8, "#d8d8d8");
  },
  "hard-stone": lump("#9a9a8a"),
  "sharp-beak": spike("#f5c518"),
  "focus-band": band("#e3350d"),
  leftovers: (g) => {
    circle(g, 12, 13, 7, "#e3350d");
    rect(g, 11, 3, 2, 4, "#6b4226");
    rect(g, 13, 10, 4, 6, "#f4e3b0");
  },
  "muscle-band": band("#e8762d"),
  "soft-sand": (g) => poly(g, [[3, 19], [8, 10], [12, 7], [17, 10], [21, 19]], "#e0c27a"),
  "never-melt-ice": crystal("#9fe3f5"),
  "spell-tag": card("#f4efd8", "#7a4fb0"),
  "black-belt": band("#5a5a5a"),
  "poison-barb": spike("#9b59d0"),
  "silver-powder": powder("#c8c8d8"),
  "twisted-spoon": (g) => {
    g.beginPath();
    g.ellipse(8, 8, 4, 5, -0.6, 0, Math.PI * 2);
    fill(g, "#c8c8d8");
    g.beginPath();
    g.moveTo(10, 12);
    g.quadraticCurveTo(18, 12, 17, 21);
    g.lineWidth = 4;
    g.strokeStyle = OUT;
    g.stroke();
    g.lineWidth = 2;
    g.strokeStyle = "#c8c8d8";
    g.stroke();
  },
  "dragon-fang": spike("#f4f4f4"),
  "silk-scarf": (g) => poly(g, [[3, 6], [21, 6], [19, 12], [21, 20], [14, 14], [3, 12]], "#f4f4f4"),
  "black-glasses": (g) => {
    rect(g, 3, 9, 8, 6, "#4a4a5a");
    rect(g, 13, 9, 8, 6, "#4a4a5a");
    rect(g, 10, 10, 4, 2, "#4a4a5a");
  },
  "metal-coat": crystal("#b0b8c8"),
  "fairy-feather": (g) => {
    g.beginPath();
    g.ellipse(12, 11, 5, 9, 0.5, 0, Math.PI * 2);
    fill(g, "#f29ac0");
    g.beginPath();
    g.moveTo(7, 20);
    g.lineTo(16, 4);
    stroke(g, 1);
  },
  "shell-bell": shell("#f2d0a0"),
  "bright-powder": powder("#f5e27a"),
  "kings-rock": (g) => poly(g, [[4, 19], [4, 8], [8, 13], [12, 5], [16, 13], [20, 8], [20, 19]], "#f5c518"),
  "shed-shell": shell("#d8c070"),
  "hm-cut": disc("#3f9c35"),
  "hm-flash": disc("#f5c518"),
  "hm-surf": disc("#3a8ee8"),
  "hm-strength": disc("#a0522d"),
  "ss-ticket": card("#f4f4f4", "#3a6fd8"),
  "poke-flute": (g) => {
    rect(g, 3, 9, 18, 6, "#e8c070");
    for (const x of [8, 12, 16]) circle(g, x, 12, 1.2, OUT);
  },
  "silph-scope": (g) => {
    circle(g, 10, 10, 6, "#9fe3f5");
    rect(g, 14, 14, 7, 4, "#5a5a5a");
  },
  tea: (g) => {
    g.beginPath();
    g.arc(11, 11, 7, 0, Math.PI);
    g.closePath();
    fill(g, "#f4f4f4");
    rect(g, 4, 10, 14, 2, "#c8a060");
  },
  "card-key": card("#d0e8ff", "#e3350d"),
  "lift-key": key("#c8c8d8"),
  "secret-key": key("#f5c518"),
  "helix-fossil": shell("#c0a070"),
  "dome-fossil": shell("#a08060"),
  "old-amber": (g) => {
    poly(g, [[12, 2], [20, 10], [16, 21], [8, 21], [4, 10]], "#e8a030");
    circle(g, 12, 13, 2, "#6b4226");
  },
};

/** Whether this item has a drawing of its own (else the pouch). */
export const hasItemIcon = (id: string): boolean => id in DRAW;

function itemCanvas(id: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 24;
  const g = c.getContext("2d")!;
  g.lineJoin = "round";
  (DRAW[id] ?? ((x: Ctx) => poly(x, [[6, 9], [18, 9], [20, 21], [4, 21]], "#b08050")))(g);
  return c;
}

/** Texture key of an item's icon, drawn once per game. */
export function itemIcon(scene: Phaser.Scene, id: string): string {
  const k = `item-icon-${id}`;
  if (!scene.textures.exists(k)) scene.textures.addCanvas(k, itemCanvas(id));
  return k;
}
