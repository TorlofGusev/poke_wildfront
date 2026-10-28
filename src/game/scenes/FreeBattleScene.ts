import Phaser from "phaser";
import { CONTENT } from "../../content";
import {
  activeUnit, livingUnits, moveUnavailableReason, partnerOf, unitById, type BattleEvent, type BattleState, type HitPreview, type MoveDef,
} from "../../core/battle";
import {
  applyFreeAction, breaksEngagement, CELL, createFreeBattle, MELEE_REACH, freeAim, freeRange, freeReachFor, planFreeAction,
  previewFreeMove, previewFreeWalk, PROTO_FIELD, UNIT_RADIUS, type FreeAction, type FreeArea, type FreeReach, type FreeTerrainId,
} from "../../core/free";
import type { Point } from "../../core/grid";
import { playCry, sfx } from "../audio";
import { t } from "../i18n";
import { playMoveFx } from "../moveFx";
import { animKey, facingFor, FACE_LEFT, FACE_RIGHT, hasSprite, type Facing, type SpriteAnim } from "../sprites";
import { Button } from "../ui/Button";
import { formatEvent, type LogEntry } from "../ui/combatLog";
import { stripMarkup, tag } from "../ui/markup";
import { RichText } from "../ui/RichText";
import { COLORS, FONT, PANEL_W, PANEL_X, px, TYPE_COLORS } from "../ui/theme";

/** Pixels per hex width, and the field's top-left corner on screen. */
const S = 40;
const FX = 12;
const FY = 64;

const ZONE_COLORS: Record<FreeTerrainId, number> = {
  floor: 0x3b4a3a, mud: 0x6b5233, water: 0x2d5a8c, bush: 0x24532a, rock: 0x4a4d55,
};

interface UnitView {
  readonly container: Phaser.GameObjects.Container;
  readonly sprite: Phaser.GameObjects.Sprite | null;
  readonly hpBar: Phaser.GameObjects.Rectangle;
  readonly speciesId: string;
  facing: Facing;
}

const toScreen = (p: Point) => new Phaser.Math.Vector2(FX + p.x * S, FY + p.y * S);

/**
 * Prototype battle with free (Wartales-like) movement: Pokémon walk anywhere within their movement,
 * slowed by mud and water, around rocks and foes; moves reach by distance with line of sight.
 */
export class FreeBattleScene extends Phaser.Scene {
  private state!: BattleState;
  private units = new Map<string, UnitView>();
  private reachGfx!: Phaser.GameObjects.Graphics;
  private reachImage!: Phaser.GameObjects.RenderTexture;
  private reachFor: { state: BattleState; reach: FreeReach } | null = null;
  /** Hover moved since the aim was last drawn (refreshed at most once a frame). */
  private aimDirty = false;
  private aimGfx!: Phaser.GameObjects.Graphics;
  private markGfx!: Phaser.GameObjects.Graphics;
  /** Damage and hit chances shown over the Pokémon an aimed move would hit. */
  private aimLabels: Phaser.GameObjects.Text[] = [];
  private panel: Phaser.GameObjects.GameObject[] = [];
  private header!: Phaser.GameObjects.Text;
  private info!: RichText;
  private logText!: RichText;
  private log: LogEntry[] = [];
  private reach: FreeReach | null = null;
  private selectedMove: string | null = null;
  private hovered: Point | null = null;
  /** Touch: the first tap previews, a second tap on the same spot confirms. */
  private armed: Point | null = null;
  private busy = false;
  /** False once the scene shuts down: a pending enemy turn must not play on. */
  private alive = false;

  constructor() {
    super("FreeBattle");
  }

  create(): void {
    this.units.clear();
    this.log = [];
    this.selectedMove = null;
    this.hovered = null;
    this.aimDirty = false;
    this.reachFor = null;
    this.armed = null;
    this.busy = false;
    this.alive = true;
    this.events.once("shutdown", () => (this.alive = false));
    this.state = createFreeBattle(CONTENT).state;

    this.header = this.add.text(FX, 16, "", { fontFamily: FONT, fontSize: px(15), color: "#f5d76e" });
    this.add.text(FX, 38, t("Prototype: free movement · right click or Esc cancels a move"), { fontFamily: FONT, fontSize: px(11), color: COLORS.dim });
    this.drawField();
    this.reachGfx = this.make.graphics({}, false);
    this.reachImage = this.add.renderTexture(0, 0, this.scale.width, this.scale.height).setOrigin(0).setDepth(1);
    this.markGfx = this.add.graphics().setDepth(2);
    this.aimGfx = this.add.graphics().setDepth(3);
    for (const u of this.state.units) this.createUnitView(u.id);
    this.info = new RichText(this, PANEL_X, 300, PANEL_W, 12);
    this.logText = new RichText(this, PANEL_X, 420, PANEL_W, 11, COLORS.dim, 14);

    const field = this.add.zone(FX, FY, PROTO_FIELD.width * S, PROTO_FIELD.height * S).setOrigin(0).setInteractive();
    field.on("pointermove", (p: Phaser.Input.Pointer) => this.onHover(p));
    field.on("pointerout", () => {
      this.hovered = null;
      this.refreshAim();
    });
    field.on("pointerdown", (p: Phaser.Input.Pointer) => this.onFieldClick(p));
    this.input.mouse?.disableContextMenu();
    this.input.keyboard?.on("keydown-ESC", () => this.cancelSelection());

    this.refreshAll();
    void this.runEnemyTurns();
  }

  // ------------------------------------------------------------ drawing

  private drawField(): void {
    // Drawn once into a texture: a Graphics with hundreds of shapes is redrawn every frame (slow on phones).
    const g = this.make.graphics({}, false);
    g.fillStyle(ZONE_COLORS.floor, 1).fillRect(FX, FY, PROTO_FIELD.width * S, PROTO_FIELD.height * S);
    // Grass tufts, seeded so the field looks the same every time.
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    g.lineStyle(1, 0x557a4f, 0.6);
    for (let i = 0; i < 260; i++) {
      const x = FX + rnd() * PROTO_FIELD.width * S;
      const y = FY + rnd() * PROTO_FIELD.height * S;
      g.lineBetween(x, y, x - 2, y - 4).lineBetween(x, y, x + 2, y - 4);
    }
    for (const z of PROTO_FIELD.zones) {
      const pts = z.poly.map(toScreen);
      g.fillStyle(ZONE_COLORS[z.terrain], 1).fillPoints(pts, true);
      g.lineStyle(2, z.terrain === "rock" ? 0x2a2c31 : 0x000000, z.terrain === "rock" ? 1 : 0.25).strokePoints(pts, true, true);
    }
    this.add.renderTexture(0, 0, this.scale.width, this.scale.height).setOrigin(0).setDepth(0).draw(g).render();
    g.destroy();
    // A legend under the field.
    const legend: [FreeTerrainId, string][] = [["mud", t("Mud ×2")], ["water", t("Water ×2")], ["bush", t("Bush ×1.5, blocks sight")], ["rock", t("Rock: impassable")]];
    legend.forEach(([id, label], i) => {
      const x = FX + i * 160;
      const y = FY + PROTO_FIELD.height * S + 12;
      this.add.rectangle(x, y, 12, 12, ZONE_COLORS[id]).setOrigin(0, 0.5).setStrokeStyle(1, 0x000000);
      this.add.text(x + 18, y, label, { fontFamily: FONT, fontSize: px(11), color: COLORS.dim }).setOrigin(0, 0.5);
    });
  }

  private createUnitView(id: string): void {
    const u = unitById(this.state, id);
    const species = CONTENT.species[u.speciesId]!;
    const team = u.side === "player" ? COLORS.player : COLORS.enemy;
    // The footprint is the body's true size: what blocks and collides.
    const foot = this.add.circle(0, 0, UNIT_RADIUS * S, team, 0.25).setStrokeStyle(2, team);
    const facing = u.side === "player" ? FACE_RIGHT : FACE_LEFT;
    const sprite = hasSprite(u.speciesId) && this.textures.exists(`${u.speciesId}-idle`)
      ? this.add.sprite(0, 6, `${u.speciesId}-idle`).setOrigin(0.5, 0.82).setScale((1.25 * S) / 48).play(animKey(u.speciesId, "idle", facing))
      : null;
    const body = sprite ? null : this.add.circle(0, 0, 12, TYPE_COLORS[species.types[0]!] ?? 0x888888);
    const hpBg = this.add.rectangle(-16, 20, 32, 4, 0x000000).setOrigin(0, 0.5);
    const hpBar = this.add.rectangle(-16, 20, 32, 4, 0x7ed321).setOrigin(0, 0.5);
    const { x, y } = toScreen(u.pos);
    const container = this.add.container(x, y, [foot, ...(sprite ? [sprite] : []), ...(body ? [body] : []), hpBg, hpBar]).setDepth(5);
    this.units.set(id, { container, sprite, hpBar, speciesId: u.speciesId, facing });
  }

  private animate(unitId: string, anim: SpriteAnim, facing?: Facing): void {
    const view = this.units.get(unitId);
    if (!view?.sprite) return;
    if (facing !== undefined) view.facing = facing;
    view.sprite.play(animKey(view.speciesId, anim, view.facing), true);
  }

  private syncUnits(): void {
    for (const u of this.state.units) {
      const view = this.units.get(u.id)!;
      const alive = u.hp > 0 && !u.captured;
      view.container.setVisible(alive || view.container.alpha < 1);
      view.hpBar.width = 32 * Math.max(0, u.hp / u.maxHp);
      view.hpBar.setFillStyle(u.hp * 2 < u.maxHp ? (u.hp * 4 < u.maxHp ? 0xe2574a : 0xf5a623) : 0x7ed321);
      if (alive) view.container.setPosition(toScreen(u.pos).x, toScreen(u.pos).y).setDepth(5 + u.pos.y / 100);
    }
  }

  /** Engagement lines and the ring around whoever is acting. */
  private drawMarks(): void {
    const g = this.markGfx.clear();
    for (const u of livingUnits(this.state)) {
      const p = partnerOf(this.state, u);
      if (p && u.id < p.id) {
        const a = toScreen(u.pos);
        const b = toScreen(p.pos);
        g.lineStyle(3, COLORS.engage, 0.9).lineBetween(a.x, a.y, b.x, b.y);
      }
    }
    const active = activeUnit(this.state);
    if (active) {
      const c = toScreen(active.pos);
      g.lineStyle(3, COLORS.active, 1).strokeCircle(c.x, c.y, UNIT_RADIUS * S + 4);
    }
  }

  private drawReach(): void {
    const g = this.reachGfx.clear();
    this.reachImage.clear();
    this.reach = null;
    if (!this.isPlayerTurn() || this.busy || this.selectedMove) return;
    // The same state always gives the same reach: reuse it (selecting and cancelling moves redraws often).
    if (this.reachFor?.state !== this.state) this.reachFor = { state: this.state, reach: freeReachFor(this.state, this.state.turn!.unitId) };
    this.reach = this.reachFor.reach;
    g.fillStyle(COLORS.reach, 0.22);
    // Neighbouring cells on a row merge into one strip: far fewer shapes to draw.
    const half = CELL / 2;
    const rows = new Map<number, number[]>();
    for (const c of this.reach.cells) {
      const r = Math.floor(c.y / CELL);
      (rows.get(r) ?? rows.set(r, []).get(r)!).push(c.x);
    }
    for (const [r, xs] of rows) {
      xs.sort((a, b) => a - b);
      let start = xs[0]!;
      let prev = start;
      for (const x of [...xs.slice(1), Infinity]) {
        if (x - prev > CELL * 1.5) {
          const p = toScreen({ x: start - half, y: r * CELL });
          g.fillRect(p.x, p.y, (prev - start + CELL) * S, CELL * S);
          start = x;
        }
        prev = x;
      }
    }
    this.reachImage.draw(g).render();
  }

  private drawArea(g: Phaser.GameObjects.Graphics, area: FreeArea, color: number, alpha: number): void {
    if (area.kind === "single") {
      const c = toScreen(area.at);
      g.fillStyle(color, alpha).fillCircle(c.x, c.y, UNIT_RADIUS * S + 3);
    } else if (area.kind === "circle") {
      const c = toScreen(area.at);
      g.fillStyle(color, alpha).fillCircle(c.x, c.y, area.radius * S);
      g.lineStyle(2, color, 0.9).strokeCircle(c.x, c.y, area.radius * S);
    } else {
      const a = toScreen(area.from);
      const b = toScreen(area.to);
      g.lineStyle(area.width * 2 * S, color, alpha).lineBetween(a.x, a.y, b.x, b.y);
    }
  }

  /** Hover feedback: the walk and its cost, or the move's range, aim, line of sight and expected damage. */
  private refreshAim(): void {
    const g = this.aimGfx.clear();
    for (const l of this.aimLabels) l.destroy();
    this.aimLabels = [];
    const lines: string[] = [];
    const hover = this.armed ?? this.hovered;
    if (this.isPlayerTurn() && !this.busy) {
      const unit = activeUnit(this.state)!;
      const from = toScreen(unit.pos);
      if (this.selectedMove) {
        const move = CONTENT.moves[this.selectedMove]!;
        const range = freeRange(unit, move);
        const ring = move.shape.kind === "line" ? move.shape.length + 0.3 : range.max;
        if (ring > 0) {
          g.fillStyle(COLORS.target, 0.08).fillCircle(from.x, from.y, ring * S);
          g.lineStyle(2, COLORS.target, 0.7).strokeCircle(from.x, from.y, ring * S);
          if (range.min > 0) g.lineStyle(1, COLORS.target, 0.5).strokeCircle(from.x, from.y, range.min * S);
        }
        // Every Pokémon this move could be aimed at right now.
        for (const u of livingUnits(this.state)) {
          if (u.id === unit.id && range.max > 0) continue;
          if (freeAim(this.state, CONTENT, unit.id, this.selectedMove, u.pos).ok) {
            const c = toScreen(u.pos);
            g.lineStyle(2, COLORS.target, 1).strokeCircle(c.x, c.y, UNIT_RADIUS * S + 6);
          }
        }
        if (hover) {
          const aim = freeAim(this.state, CONTENT, unit.id, this.selectedMove, hover);
          if (aim.area) this.drawArea(g, aim.area, aim.ok ? (move.shape.kind === "single" ? COLORS.target : COLORS.areaAim) : 0x8a93a6, 0.3);
          if (aim.ok) {
            this.drawArea(g, aim.area, move.shape.kind === "single" ? COLORS.target : COLORS.areaAim, 0.3);
            const to = toScreen(aim.target);
            if (move.requiresLineOfSight) g.lineStyle(2, 0x7ed321, 0.9).lineBetween(from.x, from.y, to.x, to.y);
            const hits = previewFreeMove(this.state, CONTENT, unit.id, this.selectedMove, hover);
            lines.push(...this.previewLines(hits));
            // A ranged shot at one Pokémon shows its odds: the rest go to the ally who may catch it.
            const ranged = move.shape.kind === "single" && range.max > MELEE_REACH && move.affects === "enemies";
            const catchChance = aim.interceptor ? Math.round(aim.interceptChance! * 100) : 0;
            for (const h of hits) {
              const odds = ranged && h.unitId === aim.affected[0]?.id ? ` ${100 - catchChance}%` : "";
              const text = (h.damage ? `−${h.damage}` : h.healed ? `+${h.healed}` : "") + (h.knockedOut ? " KO" : "") + odds;
              if (text.trim()) this.aimLabel(h.unitId, text.trim(), h.healed && !h.damage ? "#7ed321" : "#ff6b5e");
            }
            if (aim.interceptor) this.aimLabel(aim.interceptor.id, `${catchChance}%`, "#f5a623");
            if (aim.interceptor) {
              const at = toScreen(aim.interceptor.pos);
              g.lineStyle(2, 0xf5a623, 1).strokeCircle(at.x, at.y, UNIT_RADIUS * S + 6);
              lines.push(tag("bad", t("⚠ {chance}% chance to hit {name} instead", {
                chance: Math.round(aim.interceptChance! * 100), name: stripMarkup(this.name(aim.interceptor.id)),
              })));
            }
            if (this.armed) lines.push(tag("good", t("Tap again to confirm")));
          } else {
            if (aim.reason === "no line of sight") {
              const to = toScreen(hover);
              g.lineStyle(2, 0xe2574a, 0.9).lineBetween(from.x, from.y, to.x, to.y);
            }
            lines.push(tag("bad", t(aim.reason)));
          }
        }
      } else if (hover && this.reach) {
        const cost = this.reach.costTo(hover);
        const path = this.reach.pathTo(hover);
        if (cost !== null && path) {
          g.lineStyle(3, 0xffffff, 0.85).beginPath().moveTo(from.x, from.y);
          for (const p of path) g.lineTo(toScreen(p).x, toScreen(p).y);
          g.strokePath();
          const end = toScreen(hover);
          g.lineStyle(2, 0xffffff, 0.9).strokeCircle(end.x, end.y, UNIT_RADIUS * S);
          const left = this.state.turn!.movePointsLeft;
          lines.push(t("Walk: {cost} of {left} movement", { cost: tag("num", cost.toFixed(1)), left: left.toFixed(1) }));
          if (breaksEngagement(this.state, unit.id, hover)) {
            const strike = previewFreeWalk(this.state, CONTENT, unit.id, hover).find((h) => h.unitId === unit.id);
            const partner = partnerOf(this.state, unit)!;
            lines.push(tag("bad", strike
              ? t("⚠ Free attack: {name} −{dmg}{ko}", { name: stripMarkup(this.name(partner.id)), dmg: strike.damage, ko: strike.knockedOut ? " (KO)" : "" })
              : t("⚠ Leaves the engagement")));
          }
          if (this.armed) lines.push(tag("good", t("Tap again to confirm")));
        } else {
          lines.push(tag("dim", t("Out of reach")));
        }
      }
    }
    if (this.armed) {
      const c = toScreen(this.armed);
      g.lineStyle(3, 0xf5d76e, 1).strokeCircle(c.x, c.y, 6);
    }
    this.info.setMarkup(lines.join("\n"));
  }

  private aimLabel(unitId: string, text: string, color: string): void {
    const at = toScreen(unitById(this.state, unitId).pos);
    const label = this.add.text(at.x, at.y - 30, text, {
      fontFamily: FONT, fontSize: px(13), color, stroke: "#000000", strokeThickness: 4,
    }).setOrigin(0.5, 1).setDepth(20);
    // Pokémon standing close together get their labels stacked instead of overlapping.
    const clash = () => this.aimLabels.some((o) => Phaser.Geom.Intersects.RectangleToRectangle(o.getBounds(), label.getBounds()));
    while (clash()) label.y -= label.height;
    this.aimLabels.push(label);
  }

  private previewLines(hits: readonly HitPreview[]): string[] {
    return hits.map((h) => {
      const parts: string[] = [];
      if (h.damage) parts.push(tag("dmg", `−${h.damage}`) + (h.effectiveness && h.effectiveness > 1 ? " !" : h.effectiveness && h.effectiveness < 1 ? " ↓" : ""));
      if (h.healed) parts.push(tag("heal", `+${h.healed}`));
      if (h.knockedOut) parts.push(tag("bad", "KO"));
      for (const s of h.statuses) parts.push(tag("status", CONTENT.statuses[s]?.name ?? s));
      return `${this.name(h.unitId)}: ${parts.join(" ")}`;
    });
  }

  // ------------------------------------------------------------ panel

  private refreshAll(): void {
    this.syncUnits();
    this.drawMarks();
    this.drawReach();
    this.refreshPanel();
    this.refreshAim();
  }

  private refreshPanel(): void {
    this.panel.forEach((o) => o.destroy());
    this.panel = [];
    const s = this.state;
    const active = activeUnit(s);
    this.header.setText(s.outcome === "ongoing"
      ? t("Round {n} · {name}'s turn", { n: s.round, name: active ? stripMarkup(this.name(active.id)) : "" })
      : s.outcome === "victory" ? t("Victory!") : t("Defeat"));
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => (this.panel.push(o), o);
    let y = 16;
    // Turn order: who is still to act this round.
    const order = s.queue.map((id) => unitById(s, id)).filter((u) => u.hp > 0);
    add(this.add.text(PANEL_X, y, order.map((u) => (u.side === "player" ? "●" : "○") + CONTENT.species[u.speciesId]!.name.slice(0, 5)).join(" "), {
      fontFamily: FONT, fontSize: px(10), color: COLORS.dim, wordWrap: { width: PANEL_W },
    }));
    y += 30;
    if (active && s.outcome === "ongoing") {
      const turn = s.turn!;
      add(new RichText(this, PANEL_X, y, PANEL_W, 13)).setMarkup([
        `${this.name(active.id)}  ${tag("num", `${active.hp}/${active.maxHp}`)} HP`,
        t("Movement: {left}", { left: tag("num", turn.movePointsLeft.toFixed(1)) })
          + (partnerOf(s, active) ? `  ${tag("bad", t("Engaged with {name}", { name: stripMarkup(this.name(partnerOf(s, active)!.id)) }))}` : ""),
        active.statuses.length ? active.statuses.map((st) => tag("status", CONTENT.statuses[st.id]?.name ?? st.id)).join(" ") : "",
      ].filter(Boolean).join("\n"));
      y += 58;
      if (this.isPlayerTurn()) {
        for (const moveId of active.moves) {
          const move = CONTENT.moves[moveId]!;
          const why = moveUnavailableReason(s, CONTENT, active.id, moveId);
          if (moveId === "struggle" && why) continue;
          const label = `${move.kind === "basic" ? "◆" : "◇"} ${move.name}  ${this.moveTag(move)}`;
          const b = add(new Button(this, PANEL_X, y, PANEL_W, 26, label, () => this.selectMove(moveId)))
            .setAccent(TYPE_COLORS[move.type] ?? 0xffffff).setEnabled(!why).setHighlighted(this.selectedMove === moveId);
          b.onHover((over) => {
            if (!this.selectedMove) this.info.setMarkup(over ? (why ? tag("bad", t(why)) : this.moveInfo(move)) : "");
          });
          y += 30;
        }
        add(new Button(this, PANEL_X, y, PANEL_W, 26, t("⏭ End turn"), () => void this.act({ type: "endTurn", unitId: active.id })));
        y += 30;
      }
    } else if (s.outcome !== "ongoing") {
      add(new Button(this, PANEL_X, y, PANEL_W, 30, t("↻ Play again"), () => this.scene.restart())).centerLabel();
      y += 38;
    }
    add(new Button(this, PANEL_X, 506, PANEL_W, 26, t("← Back to the title"), () => this.scene.start("Title"))).centerLabel();
    this.info.setY(Math.max(y + 6, 250));
    this.logText.setY(Math.max(y + 80, 380));
    this.renderLog();
  }

  private moveTag(move: MoveDef): string {
    const shape = move.shape.kind === "burst" ? "◎" : move.shape.kind === "line" ? "↗" : "";
    return `${move.power || ""} ${move.range.max === 0 ? t("self") : move.range.max <= 1 ? t("melee") : `${move.range.min}–${move.range.max}`} ${shape}`.trim();
  }

  private moveInfo(move: MoveDef): string {
    const shape = move.shape.kind === "burst" ? t("circle, radius {r}", { r: move.shape.radius })
      : move.shape.kind === "line" ? t("line, length {n}", { n: move.shape.length }) : t("one target");
    return [
      `${tag(move.type, move.name)} · ${t("power {p}", { p: move.power })} · ${shape}`,
      move.requiresLineOfSight ? t("needs line of sight") : t("ignores line of sight"),
    ].join("\n");
  }

  private renderLog(): void {
    this.logText.setMarkup(this.log.slice(-7).map((l) => {
      const plain = stripMarkup(l.text);
      return plain.length > 44 ? `${plain.slice(0, 43)}…` : l.text;
    }).join("\n"));
  }

  // ------------------------------------------------------------ input

  private isPlayerTurn(): boolean {
    const a = activeUnit(this.state);
    return this.state.outcome === "ongoing" && a?.side === "player";
  }

  private toField(p: Phaser.Input.Pointer): Point {
    return { x: (p.x - FX) / S, y: (p.y - FY) / S };
  }

  private onHover(p: Phaser.Input.Pointer): void {
    if (p.wasTouch) return;
    this.hovered = this.toField(p);
    this.aimDirty = true;
  }

  update(): void {
    if (!this.aimDirty) return;
    this.aimDirty = false;
    this.refreshAim();
  }

  private selectMove(moveId: string): void {
    this.selectedMove = this.selectedMove === moveId ? null : moveId;
    this.armed = null;
    this.refreshAll();
  }

  private cancelSelection(): void {
    if (!this.selectedMove && !this.armed) return;
    this.selectedMove = null;
    this.armed = null;
    this.refreshAll();
  }

  private onFieldClick(p: Phaser.Input.Pointer): void {
    if (p.rightButtonDown()) return this.cancelSelection();
    if (!this.isPlayerTurn() || this.busy) return;
    const at = this.toField(p);
    if (p.wasTouch && !(this.armed && Math.hypot(this.armed.x - at.x, this.armed.y - at.y) < 0.4)) {
      this.armed = at;
      this.refreshAim();
      return;
    }
    const target = this.armed ?? at;
    this.armed = null;
    const unitId = this.state.turn!.unitId;
    if (this.selectedMove) {
      if (!freeAim(this.state, CONTENT, unitId, this.selectedMove, target).ok) return;
      const moveId = this.selectedMove;
      this.selectedMove = null;
      void this.act({ type: "freeUseMove", unitId, moveId, target });
    } else if (this.reach?.costTo(target) != null) {
      void this.act({ type: "freeMove", unitId, to: target });
    }
  }

  // ------------------------------------------------------------ actions and playback

  private async act(action: FreeAction): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.refreshAll();
    const result = applyFreeAction(this.state, CONTENT, action);
    this.state = result.state;
    await this.playEvents(result.events);
    this.busy = false;
    this.refreshAll();
    if (this.state.outcome !== "ongoing") sfx(this, this.state.outcome === "victory" ? "victory" : "defeat");
    void this.runEnemyTurns();
  }

  private async runEnemyTurns(): Promise<void> {
    while (this.state.outcome === "ongoing" && activeUnit(this.state)?.side === "enemy" && !this.busy && this.alive) {
      await this.wait(350);
      if (!this.alive) return;
      this.busy = true;
      const result = applyFreeAction(this.state, CONTENT, planFreeAction(this.state, CONTENT));
      this.state = result.state;
      await this.playEvents(result.events);
      this.busy = false;
      this.refreshAll();
    }
    if (this.state.outcome !== "ongoing") this.refreshAll();
  }

  private name(id: string): string {
    const u = unitById(this.state, id);
    const n = CONTENT.species[u.speciesId]!.name;
    return tag(u.side === "player" ? "player" : "enemy", u.side === "enemy" ? t("Foe {name}", { name: n }) : n);
  }

  private async playEvents(events: readonly BattleEvent[]): Promise<void> {
    const state = this.state;
    const ctx = {
      name: (id: string) => {
        const u = unitById(state, id);
        const n = CONTENT.species[u.speciesId]!.name;
        return u.side === "enemy" ? t("Foe {name}", { name: n }) : n;
      },
      isPlayer: (id: string) => unitById(state, id).side === "player",
      typeOf: (id: string) => CONTENT.species[unitById(state, id).speciesId]!.types[0]!,
      moveName: (id: string) => CONTENT.moves[id]!.name,
      statusName: (id: string) => CONTENT.statuses[id]?.name ?? id,
      ballName: (id: string) => CONTENT.balls[id]?.name ?? id,
      abilityName: (id: string) => CONTENT.abilities[id]?.name ?? id,
      comboName: (id: string) => CONTENT.rules.combos[id]?.name ?? id,
      bondName: CONTENT.terms.bond,
    };
    for (const e of events) {
      // Walks are measured in movement spent, not tiles.
      const entry = e.type === "moved"
        ? { text: t("{unit} walks ({cost} movement)", { unit: tag(ctx.isPlayer(e.unitId) ? "player" : "enemy", ctx.name(e.unitId)), cost: e.cost.toFixed(1) }), tone: "info" as const }
        : formatEvent(e, ctx);
      if (entry) {
        this.log.push(entry);
        this.renderLog();
      }
      switch (e.type) {
        case "moved":
          await this.settle();
          await this.tweenPath(e.unitId, e.path);
          break;
        case "moveUsed": {
          const view = this.units.get(e.unitId);
          if (!view) break;
          await this.settle();
          const to = toScreen(e.target);
          const dx = to.x - view.container.x;
          const dy = to.y - view.container.y;
          if (dx || dy) this.animate(e.unitId, "idle", facingFor(dx, dy));
          const hit = e.affected.map((id) => toScreen(unitById(state, id).pos));
          await playMoveFx(this, CONTENT.moves[e.moveId]!, { x: view.container.x, y: view.container.y }, hit.length ? hit : [to]);
          break;
        }
        case "damaged":
          sfx(this, e.source === "status" ? "status" : e.effectiveness && e.effectiveness > 1 ? "superHit" : e.effectiveness && e.effectiveness < 1 ? "weakHit" : "hit");
          this.floatText(e.unitId, `-${e.amount}`, e.source === "status" ? "#c070ff" : "#ff6b6b");
          this.flash(e.unitId);
          await this.wait(200);
          break;
        case "healed":
          sfx(this, "heal");
          this.floatText(e.unitId, `+${e.amount}`, "#7ed321");
          break;
        case "displaced":
          await this.tweenPath(e.unitId, [e.to]);
          if (e.blocked) this.cameras.main.shake(120, 0.004);
          break;
        case "statusApplied":
          this.floatText(e.unitId, CONTENT.statuses[e.status]?.name ?? e.status, "#c070ff");
          break;
        case "critical":
          this.floatText(e.targetId, t("Critical!"), "#f5d76e");
          break;
        case "engagementStrike":
          this.floatText(e.unitId, t("Free attack!"), "#ff8c42");
          await this.wait(250);
          break;
        case "fainted":
          playCry(this, unitById(state, e.unitId).speciesId, 0.75);
          await this.fadeOut(e.unitId);
          break;
        default:
          break;
      }
      this.syncHp();
    }
  }

  /** HP bars follow the final state as events play out (positions are tweened separately). */
  private syncHp(): void {
    for (const u of this.state.units) {
      const view = this.units.get(u.id)!;
      view.hpBar.width = 32 * Math.max(0, u.hp / u.maxHp);
    }
  }

  private tweenPath(unitId: string, path: readonly Point[]): Promise<void> {
    const view = this.units.get(unitId);
    if (!view || path.length === 0) return Promise.resolve();
    return (async () => {
      for (const p of path) {
        const to = toScreen(p);
        const len = Math.hypot(to.x - view.container.x, to.y - view.container.y) / S;
        this.animate(unitId, "walk", facingFor(to.x - view.container.x, to.y - view.container.y));
        await new Promise<void>((resolve) => this.tweens.add({ targets: view.container, ...to, duration: Math.max(60, len * 170), onComplete: () => resolve() }));
      }
      this.animate(unitId, "idle");
    })();
  }

  private flash(unitId: string): void {
    const view = this.units.get(unitId);
    if (!view?.sprite) return;
    view.sprite.setTint(0xff4040);
    this.time.delayedCall(90, () => view.sprite?.clearTint());
  }

  private fadeOut(unitId: string): Promise<void> {
    const view = this.units.get(unitId);
    if (!view) return Promise.resolve();
    return new Promise((resolve) => this.tweens.add({ targets: view.container, alpha: 0, duration: 300, onComplete: () => resolve() }));
  }

  private floatText(unitId: string, s: string, color: string): void {
    const view = this.units.get(unitId);
    if (!view) return;
    const txt = this.add.text(view.container.x, view.container.y - 24, s, { fontFamily: FONT, fontSize: "16px", color, fontStyle: "bold" })
      .setOrigin(0.5).setStroke("#000000", 3).setDepth(40);
    this.tweens.add({ targets: txt, y: txt.y - 24, alpha: 0, duration: 900, onComplete: () => txt.destroy() });
  }

  /**
   * Waits until a frame has been drawn. Heavy work (rules, AI, panel rebuild) makes one long frame; a tween started
   * right after it would skip that time and lose half its animation on a phone.
   */
  private settle(): Promise<void> {
    return new Promise((resolve) => this.events.once("postupdate", () => this.events.once("postupdate", () => resolve())));
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => this.time.delayedCall(ms, resolve));
  }
}
