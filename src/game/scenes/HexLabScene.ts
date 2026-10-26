import Phaser from "phaser";
import { CONTENT } from "../../content";
import { moveRange, NO_MODIFIERS, unitTraits, type MoveDef } from "../../core/battle";
import { hexDistance, hexLine, hexNeighbors, hexReachable } from "../../core/grid/hex";
import { samePoint, type Point } from "../../core/grid";
import { animKey, facingFor, hasSprite } from "../sprites";
import { playMoveFx } from "../moveFx";
import { Button } from "../ui/Button";
import { COLORS, FONT, PHONE, px } from "../ui/theme";
import { t } from "../i18n";

/**
 * Hex battle prototype: a fixed arena on a pointy-top hex grid to try how hex movement, ranges and
 * threat zones feel. Simplified rules (flat damage from move power, a greedy enemy); not part of the game.
 */

const W = 16, H = 10;
const R = 22; // hex radius (centre to corner)
const HW = Math.sqrt(3) * R; // hex width
const OX = 14 + HW / 2, OY = 76 + R;

// . floor  , grass  ~ mud  w water  # wall
const MAP = [
  "................",
  "...##.....,,,...",
  "..,,#....~~~,...",
  "..,,.....~ww,...",
  "......#..~ww....",
  "....,,#.....##..",
  "....,,.....,,,..",
  "..~~.....#.,,...",
  "..~~.....#......",
  "................",
];
const TERRAIN: Record<string, { color: number; cost: number | null; flyCost: number | null }> = {
  ".": { color: COLORS.floor, cost: 1, flyCost: 1 },
  ",": { color: COLORS.grass, cost: 1, flyCost: 1 },
  "~": { color: COLORS.mud, cost: 2, flyCost: 1 },
  w: { color: COLORS.water, cost: null, flyCost: 1 },
  "#": { color: COLORS.wall, cost: null, flyCost: null },
};

interface LabUnit {
  id: string;
  speciesId: string;
  side: "player" | "enemy" | "dummy";
  pos: Point;
  hp: number;
  maxHp: number;
  moved: boolean;
  attacked: boolean;
  view?: Phaser.GameObjects.Container;
  bar?: Phaser.GameObjects.Rectangle;
}

const centre = (p: Point) => ({ x: OX + p.x * HW + (p.y & 1 ? HW / 2 : 0), y: OY + p.y * R * 1.5 });
const corners = (cx: number, cy: number, r = R - 1) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 30);
    return new Phaser.Math.Vector2(cx + r * Math.cos(a), cy + r * Math.sin(a));
  });

export class HexLabScene extends Phaser.Scene {
  private units: LabUnit[] = [];
  private selected: LabUnit | null = null;
  private hovered: Point | null = null;
  private overlay!: Phaser.GameObjects.Graphics;
  private info!: Phaser.GameObjects.Text;
  private busy = false;
  private round = 1;
  private header!: Phaser.GameObjects.Text;
  private selectedMove: MoveDef | null = null;
  private moveButtons!: Phaser.GameObjects.Container;

  constructor() {
    super("HexLab");
  }

  create(): void {
    this.units = [];
    this.selected = null;
    this.selectedMove = null;
    this.moveButtonsKey = "";
    this.round = 1;
    this.header = this.add.text(14, 14, "", { fontFamily: FONT, fontSize: "20px", color: "#f5d76e" });
    this.add.text(14, 44, t("Hex prototype · simplified rules (damage = move power / 4)"), { fontFamily: FONT, fontSize: px(12), color: COLORS.dim });
    const g = this.add.graphics();
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const t = TERRAIN[MAP[y]![x]!]!;
        const { x: cx, y: cy } = centre({ x, y });
        g.fillStyle(t.color, 1).fillPoints(corners(cx, cy), true);
        g.lineStyle(1, 0x000000, 0.35).strokePoints(corners(cx, cy), true);
      }
    this.overlay = this.add.graphics().setDepth(1);
    const add = (id: string, speciesId: string, side: LabUnit["side"], x: number, y: number) => {
      const maxHp = side === "dummy" ? 999 : 40;
      this.units.push({ id, speciesId, side, pos: { x, y }, hp: maxHp, maxHp, moved: false, attacked: false });
    };
    // Seven Pokémon with different moves and ranges to try, and a training dummy that never fights back.
    add("p1", "charmander", "player", 1, 1);
    add("p2", "squirtle", "player", 1, 3);
    add("p3", "bulbasaur", "player", 2, 5);
    add("p4", "pikachu", "player", 1, 7);
    add("p5", "abra", "player", 0, 4);
    add("p6", "mankey", "player", 3, 2);
    add("p7", "magnemite", "player", 3, 8);
    add("d1", "geodude", "dummy", 6, 4);
    add("e1", "pidgey", "enemy", 14, 1);
    add("e2", "rattata", "enemy", 13, 5);
    add("e3", "spearow", "enemy", 14, 8);
    for (const u of this.units) this.makeView(u);

    const px0 = 14 + HW * (W + 0.5) + 12;
    this.moveButtons = this.add.container(px0, 0);
    this.info = this.add.text(px0, 76, "", { fontFamily: FONT, fontSize: px(12), color: COLORS.text, wordWrap: { width: 960 - px0 - 10 } });
    new Button(this, px0, 400, 960 - px0 - 10, 28, PHONE ? t("End turn") : t("End turn [Space]"), () => void this.endTurn());
    new Button(this, px0, 436, 960 - px0 - 10, 28, "↺ Restart", () => this.scene.restart());
    new Button(this, px0, 472, 960 - px0 - 10, 28, t("⌂ Title"), () => this.scene.start("Title"));
    this.input.keyboard?.on("keydown-SPACE", () => void this.endTurn());

    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      const t = this.hexAt(p.worldX, p.worldY);
      if (t === this.hovered || (t && this.hovered && samePoint(t, this.hovered))) return;
      this.hovered = t;
      this.redraw();
    });
    this.input.on("pointerdown", (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (over.length || this.busy) return;
      const t = this.hexAt(p.worldX, p.worldY);
      this.hovered = t;
      if (t) void this.click(t);
      this.redraw();
    });
    this.redraw();
  }

  // ------------------------------------------------------------ rules

  private movePoints(u: LabUnit): number {
    const s = CONTENT.species[u.speciesId]!;
    const r = CONTENT.rules;
    return Math.min(r.moveMax, r.moveBase + Math.floor(s.stats.speed / r.speedPerMove));
  }

  private flies(u: LabUnit): boolean {
    return Boolean(unitTraits(CONTENT, CONTENT.species[u.speciesId]!.types).flies);
  }

  private alive(): LabUnit[] {
    return this.units.filter((u) => u.hp > 0);
  }

  private unitAt(p: Point): LabUnit | undefined {
    return this.alive().find((u) => samePoint(u.pos, p));
  }

  private terrain(p: Point) {
    return TERRAIN[MAP[p.y]?.[p.x] ?? "#"]!;
  }

  /** Hexes the unit can end a move on. */
  private reach(u: LabUnit, mp = this.movePoints(u)): Point[] {
    const fly = this.flies(u);
    const costs = hexReachable(W, H, u.pos, mp, (p) => (fly ? this.terrain(p).flyCost : this.terrain(p).cost), (p) => {
      const o = this.unitAt(p);
      return !!o && o.side !== u.side && !fly;
    });
    return [...costs.keys()].map((k) => {
      const [x, y] = k.split(",").map(Number);
      return { x: x!, y: y! };
    }).filter((p) => !samePoint(p, u.pos) && !this.unitAt(p));
  }

  private damagingMoves(u: LabUnit) {
    return CONTENT.species[u.speciesId]!.moves.map((m) => CONTENT.moves[m]!).filter((m) => m && m.power > 0);
  }

  /** Walls and other Pokémon block shots (the end hexes do not count). */
  private clearShot(a: Point, b: Point): boolean {
    return hexLine(a, b).slice(1, -1).every((p) => MAP[p.y]![p.x] !== "#" && !this.unitAt(p));
  }

  /** The strongest move that hits `target` from `from`, if any. */
  private canHit(u: LabUnit, m: MoveDef, from: Point, target: Point): boolean {
    const d = hexDistance(from, target);
    const r = moveRange({ mods: NO_MODIFIERS }, m);
    return d >= r.min && d <= r.max && (d === 1 || this.clearShot(from, target));
  }

  private bestMove(u: LabUnit, from: Point, target: Point) {
    return this.damagingMoves(u).filter((m) => this.canHit(u, m, from, target)).sort((a, b) => b.power - a.power)[0];
  }

  private threat(u: LabUnit): { reach: Point[]; strike: Point[] } {
    const reach = this.reach(u);
    const stands = [u.pos, ...reach];
    const ranges = this.damagingMoves(u).map((m) => moveRange({ mods: NO_MODIFIERS }, m));
    const inReach = new Set(stands.map((p) => `${p.x},${p.y}`));
    const strike: Point[] = [];
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const p = { x, y };
        if (inReach.has(`${x},${y}`) || MAP[y]![x] === "#") continue;
        if (stands.some((s) => ranges.some((r) => { const d = hexDistance(s, p); return d >= r.min && d <= r.max; }))) strike.push(p);
      }
    return { reach, strike };
  }

  // ------------------------------------------------------------ input

  private async click(t: Point): Promise<void> {
    const other = this.unitAt(t);
    if (other?.side === "player") {
      this.selected = other.hp > 0 && !(other.moved && other.attacked) ? other : null;
      this.selectedMove = null;
      return;
    }
    const u = this.selected;
    if (!u) return;
    if (other && !u.attacked) {
      // The chosen move, or else the strongest one that reaches.
      const move = this.selectedMove ? (this.canHit(u, this.selectedMove, u.pos, t) ? this.selectedMove : undefined) : this.bestMove(u, u.pos, t);
      if (move) {
        await this.attack(u, other, move);
        this.selectedMove = null;
      }
      return;
    }
    if (!u.moved && this.reach(u).some((p) => samePoint(p, t))) {
      await this.walk(u, t);
      u.moved = true;
    }
  }

  private async endTurn(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.selected = null;
    this.redraw();
    for (const e of this.alive().filter((x) => x.side === "enemy")) {
      const foes = this.alive().filter((x) => x.side === "player");
      if (!foes.length) break;
      // Greedy: the reachable hex (or staying) from which it can hit someone, else the one closest to a foe.
      const stands = [e.pos, ...this.reach(e)];
      let best: { p: Point; target?: LabUnit; score: number } = { p: e.pos, score: -Infinity };
      for (const p of stands) {
        const target = foes.find((f) => this.bestMove(e, p, f.pos));
        const near = Math.min(...foes.map((f) => hexDistance(p, f.pos)));
        const score = (target ? 100 : 0) - near;
        if (score > best.score) best = { p, target, score };
      }
      if (!samePoint(best.p, e.pos)) await this.walk(e, best.p);
      const target = foes.find((f) => this.bestMove(e, e.pos, f.pos));
      if (target) {
        const m = this.bestMove(e, e.pos, target.pos)!;
        await this.attack(e, target, m);
      }
    }
    for (const u of this.units) {
      u.moved = u.attacked = false;
      // The dummy patches itself up between rounds.
      if (u.side === "dummy") {
        u.hp = u.maxHp;
        u.bar!.width = 30;
      }
    }
    this.round++;
    this.busy = false;
    this.redraw();
  }

  // ------------------------------------------------------------ actions

  private async walk(u: LabUnit, to: Point): Promise<void> {
    this.busy = true;
    const fly = this.flies(u);
    // Re-run the search to recover a path: step back from `to` along decreasing cost.
    const costs = hexReachable(W, H, u.pos, 99, (p) => (fly ? this.terrain(p).flyCost : this.terrain(p).cost), (p) => {
      const o = this.unitAt(p);
      return !!o && o.side !== u.side && !fly;
    });
    const path: Point[] = [to];
    while (!samePoint(path[0]!, u.pos)) {
      const cur = path[0]!;
      const prev = hexNeighbors(cur).filter((n) => costs.has(`${n.x},${n.y}`)).sort((a, b) => costs.get(`${a.x},${a.y}`)! - costs.get(`${b.x},${b.y}`)!)[0]!;
      path.unshift(prev);
    }
    for (const step of path.slice(1)) {
      const c = centre(step);
      const sprite = u.view!.getAt(1) as Phaser.GameObjects.Sprite | undefined;
      if (sprite && hasSprite(u.speciesId)) sprite.play(animKey(u.speciesId, "walk", facingFor(c.x - u.view!.x, c.y - u.view!.y)), true);
      await new Promise<void>((r) => this.tweens.add({ targets: u.view, x: c.x, y: c.y, duration: 140, onComplete: () => r() }));
      u.pos = step;
    }
    const sprite = u.view!.getAt(1) as Phaser.GameObjects.Sprite | undefined;
    if (sprite && hasSprite(u.speciesId)) sprite.play(animKey(u.speciesId, "idle", 0), true);
    this.busy = false;
  }

  private async attack(a: LabUnit, d: LabUnit, move: MoveDef): Promise<void> {
    const { name, power } = move;
    this.busy = true;
    a.attacked = true;
    const dmg = Math.max(1, Math.round(power / 4));
    d.hp = Math.max(0, d.hp - dmg);
    const from = centre(a.pos), to = centre(d.pos);
    await playMoveFx(this, move, from, [to]);
    const line = this.add.line(0, 0, from.x, from.y, to.x, to.y, 0xffffff, 0).setOrigin(0).setDepth(5);
    const txt = this.add.text(to.x, to.y - 20, `${name} −${dmg}`, { fontFamily: FONT, fontSize: px(12), color: "#ff6b6b", stroke: "#000", strokeThickness: 3 }).setOrigin(0.5).setDepth(6);
    await new Promise<void>((r) => this.tweens.add({ targets: [line, txt], alpha: 0, delay: 350, duration: 300, onComplete: () => r() }));
    line.destroy();
    txt.destroy();
    d.bar!.width = 30 * (d.hp / d.maxHp);
    if (d.hp === 0) d.view!.setVisible(false);
    this.busy = false;
  }

  // ------------------------------------------------------------ drawing

  private makeView(u: LabUnit): void {
    const c = centre(u.pos);
    const ring = this.add.ellipse(0, 10, 30, 10).setStrokeStyle(2, u.side === "player" ? COLORS.player : COLORS.enemy);
    const body: Phaser.GameObjects.GameObject = u.side === "dummy"
      ? this.add.container(0, 0, [
        this.add.rectangle(0, 6, 4, 14, 0x8b6b3d),
        this.add.circle(0, -4, 11, 0xf5f0e0).setStrokeStyle(3, 0xd0021b),
        this.add.circle(0, -4, 5, 0xd0021b),
      ])
      : hasSprite(u.speciesId)
      ? this.add.sprite(0, 10, `${u.speciesId}-idle`).setOrigin(0.5, 0.82).play(animKey(u.speciesId, "idle", u.side === "player" ? 1 : 3))
      : this.add.circle(0, 0, 12, u.side === "player" ? COLORS.player : COLORS.enemy);
    const back = this.add.rectangle(-15, 16, 30, 4, 0x2a3242).setOrigin(0, 0.5);
    u.bar = this.add.rectangle(-15, 16, 30, 4, 0x7ed321).setOrigin(0, 0.5);
    u.view = this.add.container(c.x, c.y, [ring, body, back, u.bar]).setDepth(3);
  }

  private hexAt(x: number, y: number): Point | null {
    let best: Point | null = null, bd = Infinity;
    const row = Math.round((y - OY) / (R * 1.5));
    for (let ry = row - 1; ry <= row + 1; ry++)
      for (let rx = 0; rx < W; rx++) {
        if (ry < 0 || ry >= H) continue;
        const c = centre({ x: rx, y: ry });
        const d = (c.x - x) ** 2 + (c.y - y) ** 2;
        if (d < bd) { bd = d; best = { x: rx, y: ry }; }
      }
    return bd <= R * R ? best : null;
  }

  private fill(tiles: readonly Point[], color: number, alpha: number): void {
    this.overlay.fillStyle(color, alpha);
    for (const p of tiles) {
      const c = centre(p);
      this.overlay.fillPoints(corners(c.x, c.y, R - 3), true);
    }
  }

  private redraw(): void {
    this.overlay.clear();
    const players = this.alive().filter((u) => u.side === "player").length;
    const enemies = this.alive().filter((u) => u.side === "enemy").length;
    this.renderMoveButtons();
    this.header.setText(!enemies ? t("Victory!") : !players ? t("Defeat") : t("Round {round} · your turn", { round: this.round }));
    const u = this.selected;
    if (u && !this.busy) {
      if (this.selectedMove && !u.attacked) {
        // The chosen move's range from here; targets it can hit glow stronger.
        const r = moveRange({ mods: NO_MODIFIERS }, this.selectedMove);
        const ring: Point[] = [];
        for (let y = 0; y < H; y++)
          for (let x = 0; x < W; x++) {
            const d = hexDistance(u.pos, { x, y });
            if (d >= r.min && d <= r.max) ring.push({ x, y });
          }
        this.fill(ring, COLORS.target, 0.2);
      } else if (!u.moved) this.fill(this.reach(u), COLORS.reach, 0.35);
      if (!u.attacked) this.fill(this.alive().filter((e) => e.side !== "player" && (this.selectedMove ? this.canHit(u, this.selectedMove, u.pos, e.pos) : this.bestMove(u, u.pos, e.pos))).map((e) => e.pos), COLORS.target, 0.6);
      const c = centre(u.pos);
      this.overlay.lineStyle(3, COLORS.active, 1).strokePoints(corners(c.x, c.y, R - 2), true);
    }
    const foe = this.hovered ? this.unitAt(this.hovered) : undefined;
    let text = t("Tap your Pokémon, then a teal hex to move. Pick an attack above (or tap a red target for the strongest).\nTap or hover a foe to see its reach (orange) and attack range (red).");
    if (foe?.side === "enemy" && !this.busy && !(u && !u.attacked && this.bestMove(u, u.pos, foe.pos))) {
      const { reach, strike } = this.threat(foe);
      // Solid colours, so the zone reads the same over any terrain.
      this.fill(strike, COLORS.target, 0.8);
      this.fill([foe.pos, ...reach], COLORS.engage, 0.9);
    }
    const shown = foe ?? u;
    if (shown) {
      const s = CONTENT.species[shown.speciesId]!;
      const moves = this.damagingMoves(shown).map((m) => { const r = moveRange({ mods: NO_MODIFIERS }, m); return `${m.name} ${m.power} (${r.min === r.max ? r.max : `${r.min}-${r.max}`})`; });
      text = shown.side === "dummy" ? `${t("Training dummy\nHP {hp}/{max} · never moves or attacks, heals each round", { hp: shown.hp, max: shown.maxHp })}\n\n${text}` : `${t(shown.side === "player" ? "{name} (yours)" : "{name} (foe)", { name: s.name })}\n${t("HP {hp}/{max} · Move {move}", { hp: shown.hp, max: shown.maxHp, move: this.movePoints(shown) })}${this.flies(shown) ? t(" (flies)") : ""}\n${moves.join("\n")}\n\n${text}`;
    }
    if (this.hovered) {
      const c = centre(this.hovered);
      this.overlay.lineStyle(2, 0xffffff, 0.8).strokePoints(corners(c.x, c.y, R - 2), true);
    }
    this.info.setText(text);
    this.info.setY(76 + this.moveButtonsHeight);
  }

  private moveButtonsHeight = 0;
  private moveButtonsKey = "";

  /** The selected Pokémon's attacks as buttons: pick one to see its range and aim it. */
  private renderMoveButtons(): void {
    // Rebuild only when the choice changes: a hover redraw must not destroy the button being clicked.
    const k = `${this.selected?.id}|${this.selectedMove?.id}|${this.selected?.attacked}|${this.busy}`;
    if (k === this.moveButtonsKey) return;
    this.moveButtonsKey = k;
    this.moveButtons.removeAll(true);
    this.moveButtonsHeight = 0;
    const u = this.selected;
    if (!u || u.attacked || this.busy) return;
    const width = 960 - this.moveButtons.x - 10;
    this.damagingMoves(u).forEach((m, i) => {
      const r = moveRange({ mods: NO_MODIFIERS }, m);
      const label = `${m.name.padEnd(13)} ${String(m.power).padStart(3)}  ${t("range")} ${r.min === r.max ? r.max : `${r.min}-${r.max}`}`;
      this.moveButtons.add(new Button(this, 0, 76 + i * 32, width, 28, label, () => {
        this.selectedMove = this.selectedMove === m ? null : m;
        // Next frame: a button rebuilt under the pointer would otherwise catch this same press.
        this.time.delayedCall(0, () => this.redraw());
      }).setHighlighted(this.selectedMove === m));
    });
    this.moveButtonsHeight = this.damagingMoves(u).length * 32 + 8;
  }
}
