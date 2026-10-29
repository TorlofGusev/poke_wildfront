import Phaser from "phaser";
import { playMoveFx } from "../moveFx";
import { playMusic, stopMusic } from "../music";
import { CONTENT, type ScenarioDef } from "../../content";
import type { DemoBattle } from "../../content/demoBattles";
import { captureChance, captureTargets, captureUnavailableReason } from "../../core/capture";
import { KNOCKOUTS_TO_DEATH, resolveBattle, type BattleSummary } from "../../core/party";
import { currentWorld, session } from "../session";
import { PROGRESSION, WORLD_CONTENT, WORLDS } from "../../content";
import { calmEncounter, fatigueLevel, fatigueModifiers, removeEncounter, returnToLastCamp, rollLoot } from "../../core/expedition";
import { teamBond } from "../../core/progression";
import { nextRandom } from "../../core/rng";
import { AI_LEVELS, planTurn } from "../../core/ai";
import { playCry, sfx, silence } from "../audio";
import { FEEDBACK_URL, openFeedback } from "../feedback";
import { flushTips, queueTip, showHelp, tipOpen } from "../tips";
import { completeNpc, failNpc } from "../../core/story";
import { grantGifts } from "../storyFlow";
import {
  activeUnit,
  applyAction,
  livingUnits,
  type BattleAction,
  type HitPreview,
  switchTargets,
  partnerOf,
  MAX_ACTIVE_UNITS,
  comboSetup,
  deploymentErrors,
  lockDeployment,
  moveUnavailableReason,
  movementPoints,
  createBattle,
  maxHpOf,
  moveRange,
  unitTraits,
  unitById,
  type BattleEvent,
  type DeployCandidate,
  NO_MODIFIERS,
  bondCostFor,
  combineModifiers,
  type BattleState,
  type BattleUnit,
  type Placement,
} from "../../core/battle";
import { samePoint, type Point } from "../../core/grid";
import {
  breaksEngagement, CELL, distance, freeAim, freeHasTarget, freeRange, freeReachFor, freeUnitAt, MELEE_REACH,
  previewFreeMove, previewFreeWalk, previewPushes, type PushPreview, terrainAt, timedStrikeOutcome, UNIT_RADIUS, type FreeArea, type FreeReach, type FreeTerrainId,
} from "../../core/free";
import { summarizeHits, type MoveDef } from "../../core/battle";
import { typeMultiplier } from "../../core/rules/typeChart";
import { Button } from "../ui/Button";
import { formatEvent, type LogEntry, type LogTone } from "../ui/combatLog";
import { describeMove } from "../ui/describeMove";
import { statLine } from "../ui/describeEffects";
import { stripMarkup, tag } from "../ui/markup";
import { RichText } from "../ui/RichText";
import { t } from "../i18n";
import { boardTheme, drawFloorDecor, drawWallDecor, drawWaterDecor, floorColor } from "../ui/boardDecor";
import { animKey, FACE_LEFT, FACE_RIGHT, facingFor, hasSprite, portraitKey, type Facing, type SpriteAnim } from "../sprites";
import { BOARD_X, BOARD_Y, COLORS, FIELD_S, fieldToWorld, FONT, PANEL_X, PANEL_W, TYPE_COLORS, UNIT_SCALE, worldToField, px, PHONE } from "../ui/theme";

type Phase = "deploy" | "battle" | "over";

interface UnitView {
  container: Phaser.GameObjects.Container;
  hpBar: Phaser.GameObjects.Rectangle;
  /** Gold Spirit bar under the HP bar. */
  spiritBar: Phaser.GameObjects.Rectangle;
  /** Team-coloured base under the Pokémon's feet. */
  ring: Phaser.GameObjects.Ellipse;
  /** Placeholder shown for hidden enemies (and species without a sprite). */
  body: Phaser.GameObjects.Arc;
  label: Phaser.GameObjects.Text;
  sprite: Phaser.GameObjects.Sprite | null;
  speciesId: string;
  facing: Facing;
}

const AI_STEP_MS = 350;
/** A spent turn passes on its own after this pause; under this much walk left counts as none. */
const AUTO_END_MS = 600;
const MIN_STEP = 0.5;
/** The title-screen replay is calmer than a real battle. */
const DEMO_STEP_MS = 650;
const S = FIELD_S;
/** Terrain colours on the free field. */
const ZONE_COLORS: Record<Exclude<FreeTerrainId, "floor">, number> = { mud: COLORS.mud, water: COLORS.water, bush: COLORS.grass, rock: 0x3a3d44 };
/** A tap or click this close to a deploy spot picks it. */
const SPOT_PICK = 0.45;
const LOG_LINE_H = 15;
/** How far a line or cone reaches from the user (null for other shapes). */
/** The rule between move groups of different kinds in the move lists. */
const KIND_DIVIDER = 0x6b7899;
const fanLength = (move: MoveDef): number | null => (move.shape.kind === "line" || move.shape.kind === "cone" ? move.shape.length + 0.3 : null);
/** Top-half colours of the balls (the bottom is white), for the aiming cursor. */
const BALL_TOPS: Readonly<Record<string, string>> = { "poke-ball": "#e3350d", "great-ball": "#2f6fd6", "ultra-ball": "#2a2a2a" };
const ballCursors = new Map<string, string>();
/** A small drawn ball (24×24): the aiming cursor and the icon on the ball buttons. */
function ballCanvas(ballId: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 24;
  const g = c.getContext("2d")!;
  g.beginPath(); g.arc(12, 12, 10, Math.PI, 0); g.fillStyle = BALL_TOPS[ballId] ?? "#e3350d"; g.fill();
  g.beginPath(); g.arc(12, 12, 10, 0, Math.PI); g.fillStyle = "#f4f4f4"; g.fill();
  g.lineWidth = 2; g.strokeStyle = "#111";
  g.beginPath(); g.arc(12, 12, 10, 0, Math.PI * 2); g.moveTo(2, 12); g.lineTo(22, 12); g.stroke();
  g.beginPath(); g.arc(12, 12, 3.5, 0, Math.PI * 2); g.fillStyle = "#f4f4f4"; g.fill(); g.stroke();
  return c;
}
/** The ball as a CSS cursor, centred on the click point. */
function ballCursor(ballId: string): string {
  let css = ballCursors.get(ballId);
  if (!css) {
    css = `url(${ballCanvas(ballId).toDataURL()}) 12 12, crosshair`;
    ballCursors.set(ballId, css);
  }
  return css;
}
/** Hazard colours on the field. */
const HAZARD_COLORS = { fire: 0xff6a1f, poison: 0xa04ad8, mud: 0x7a5a32 } as const;

const LOG_COLORS: Record<LogTone, string> = {
  info: "#8a93a6", player: "#8fb8f0", enemy: "#f08f8f", damage: "#ffb070",
  heal: "#7ed321", status: "#c070ff", ko: "#ff5050", result: "#f5d76e",
};

export class BattleScene extends Phaser.Scene {
  private scenario!: ScenarioDef;
  private party: DeployCandidate[] = [];
  private selectedBall: string | null = null;
  private summary: BattleSummary | null = null;
  private encounterId: string | null = null;
  /** The trainer or story NPC fought here, and the map it stands on. */
  private npcId: string | null = null;
  private npcMapId: string | null = null;
  private biome: string | null = null;
  private rewardText = "";
  /** A trainer's prize money, shown in the summary's one money total. */
  private prizeMoney = 0;
  /** EV the battle earned (wild win plus trainer or badge reward). */
  private evGained = 0;
  private phase: Phase = "deploy";
  private placements: Placement[] = [];
  private selectedCandidate: string | null = null;
  private state: BattleState | null = null;
  private selectedMove: string | null = null;
  private hoveredMove: string | null = null;
  /** Retreat needs a second tap, so a slip next to End turn does not flee the battle. */
  private confirmRetreat = false;
  private busy = false;
  private hovered: Point | null = null;
  /** Touch: the action tile tapped once; a second tap on it confirms. */
  private armed: Point | null = null;
  private activeRing: Phaser.GameObjects.Arc | null = null;
  private armedFrame: Phaser.GameObjects.Arc | null = null;
  private log: LogEntry[] = [];
  private logStrip!: RichText;
  private logOverlay: Phaser.GameObjects.Container | null = null;
  /** How far the open log is scrolled back from the newest line, in pixels. */
  private logScroll = 0;
  private logBody: { rich: RichText; first: number } | null = null;
  /** Set while a touch drag scrolls the log, so lifting the finger does not close it. */
  private logDragged = false;
  private logOpenedAt = 0;

  private overlay!: Phaser.GameObjects.Graphics;
  /** The walkable area, baked into a texture (redrawn only when the state changes). */
  private reachGfx: Phaser.GameObjects.Graphics | null = null;
  private reachImage: Phaser.GameObjects.RenderTexture | null = null;
  private reachFor: { state: BattleState; reach: FreeReach } | null = null;
  private reach: FreeReach | null = null;
  /** Hover moved since the overlay was last drawn (refreshed at most once a frame). */
  private hoverDirty = false;
  /** Combo names over the foes the active Pokémon would combo. */
  private comboLabels: Phaser.GameObjects.Container | null = null;
  private boardGfx: Phaser.GameObjects.Graphics | null = null;
  private boardImage: Phaser.GameObjects.RenderTexture | null = null;
  private units = new Map<string, UnitView>();
  private panel!: Phaser.GameObjects.Container;
  private infoText!: RichText;
  /** Where the info text starts: right under the panel's last button. */
  private infoY = 330;
  private header!: Phaser.GameObjects.Text;
  private orderStrip: Phaser.GameObjects.Container | null = null;
  private previewLabels: Phaser.GameObjects.Container | null = null;
  private lastPreview: readonly HitPreview[] = [];
  /** A recorded battle replayed behind the title screen: no UI, no sound, nothing saved. */
  private demo: DemoBattle | null = null;
  /** Bumped by each replay, so one cut short (the scene restarted) stops instead of driving the new one. */
  private demoRun = 0;

  constructor() {
    super("Battle");
  }

  init(data: { scenario?: ScenarioDef; encounterId?: string; biome?: string; npcId?: string; mapId?: string; demo?: DemoBattle }): void {
    this.demo = data.demo ?? null;
    this.scenario = data.scenario ?? { id: "demo", name: "", field: data.demo!.field, deploymentZone: [], enemies: [] };
    this.npcId = data.npcId ?? null;
    this.npcMapId = data.mapId ?? null;
    this.encounterId = data.encounterId ?? null;
    this.biome = data.biome ?? data.demo?.style ?? null;
    this.rewardText = "";
    this.prizeMoney = 0;
    this.phase = "deploy";
    this.placements = [];
    this.party = this.demo ? [] : session.partyCandidates();
    this.selectedCandidate = this.party.find((m) => m.hp > 0)?.id ?? null;
    this.selectedBall = null;
    this.summary = null;
    this.state = null;
    this.selectedMove = null;
    this.hoveredMove = null;
    this.busy = false;
    this.log = [];
    this.logOverlay = null;
    this.logScroll = 0;
    this.units = new Map();
    this.boardGfx = null;
    this.boardImage = null;
    this.reachGfx = null;
    this.reachImage = null;
    this.reachFor = null;
    this.reach = null;
    this.hoverDirty = false;
    this.hovered = null;
    this.armed = null;
    this.activeRing = null;
    this.armedFrame = null;
    this.orderStrip = null;
    this.previewLabels = null;
  }

  create(): void {
    if (this.demo) return void this.playDemo(this.demo).catch((e: unknown) => console.error("title replay stopped:", e));
    this.panelKey = "";
    playMusic(this, "battle");
    this.header = this.add.text(BOARD_X, 16, "", { fontFamily: FONT, fontSize: "20px", color: "#f5d76e" });
    this.add.text(BOARD_X, 44, this.scenario.name, { fontFamily: FONT, fontSize: px(13), color: COLORS.dim });
    this.drawBoard();
    this.overlay = this.add.graphics();
    this.panel = this.add.container(PANEL_X, 16);
    this.infoText = new RichText(this, PANEL_X, 330, PANEL_W, 12);

    const board = this.boardPx();
    this.logStrip = new RichText(this, BOARD_X, BOARD_Y + board.h + 4, 450, 11, COLORS.dim, 15);
    const logButton = new Button(this, BOARD_X + board.w - 110, BOARD_Y + board.h + 6, 110, 22, PHONE ? t("Full log") : t("Full log [L]"), () => this.toggleLogOverlay());
    logButton.setDepth(5);
    new Button(this, BOARD_X + board.w - 150, BOARD_Y + board.h + 6, 34, 22, "?", () => showHelp(this)).centerLabel().setDepth(5);
    this.input.keyboard?.on("keydown-L", () => this.toggleLogOverlay());
    this.events.once("shutdown", () => this.input.setDefaultCursor("default"));
    this.input.on("wheel", (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      if (!this.logOverlay) return;
      this.scrollLog(-dy * 0.6);
    });
    // Touch: drag up/down on the open log to scroll it.
    let dragY: number | null = null;
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => { dragY = this.logOverlay ? p.y : null; });
    this.input.on("pointerup", () => { dragY = null; });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!this.logOverlay || dragY === null || !p.isDown) return;
      if (Math.abs(p.y - dragY) < 2) return;
      this.logDragged = true;
      this.scrollLog(p.y - dragY);
      dragY = p.y;
    });

    for (const e of this.scenario.enemies) this.createUnitView(e.id, e.speciesId, "enemy", e.pos);

    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      // Touch has no hover (a drag would only flicker previews); a mouse redraws at most once a frame.
      if (p.wasTouch) return;
      this.hovered = this.pointerPoint(p);
      this.hoverDirty = true;
    });
    this.input.on("pointerdown", (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      // Clicks on UI (buttons, the log overlay) never fall through to the board.
      if (over.length > 0) return;
      if (p.rightButtonDown()) return this.cancelSelection();
      const t = this.pointerPoint(p);
      if (!t) return;
      // Touch has no hover: the first tap on an action spot previews it, a second tap (close by) confirms.
      if (p.wasTouch && this.isActionPoint(t) && !(this.armed && distance(this.armed, t) < 0.4)) {
        this.armed = t;
        this.hovered = t;
        this.refreshOverlay();
        this.refreshInfo();
        return;
      }
      this.armed = null;
      // A tap also inspects: info and, on a foe, its threat zone.
      if (p.wasTouch) this.hovered = t;
      this.onTileClicked(t);
      if (p.wasTouch && !this.busy) {
        this.refreshOverlay();
        this.refreshInfo();
      }
    });
    this.input.mouse?.disableContextMenu();
    this.input.keyboard?.on("keydown-ESC", () => this.cancelSelection());
    this.input.keyboard?.addCapture("SPACE");
    this.input.keyboard?.on("keydown-SPACE", () => !tipOpen(this) && this.playerEndTurn());

    this.refreshAll();
  }

  // ------------------------------------------------------------ drawing

  /** The field's size on screen. */
  private boardPx(): { w: number; h: number } {
    return { w: this.scenario.field.width * S, h: this.scenario.field.height * S };
  }

  private drawBoard(): void {
    // Drawn once into a texture: hundreds of shapes redrawn every frame kept phones busy (and hot).
    this.boardGfx ??= this.make.graphics({}, false);
    const g = this.boardGfx.clear();
    const field = this.state?.field ?? this.scenario.field;
    const theme = boardTheme(this.biome ?? this.npcMapId ?? this.scenario.id);
    // Floor in one-unit squares of slightly varied colour, with small props on open ground.
    for (let y = 0; y < field.height; y++)
      for (let x = 0; x < field.width; x++) {
        const c = fieldToWorld({ x, y });
        g.fillStyle(floorColor(theme, x, y), 1).fillRect(c.x, c.y, S, S);
      }
    for (let y = 0; y < field.height; y++)
      for (let x = 0; x < field.width; x++) {
        if (terrainAt(field, { x: x + 0.5, y: y + 0.5 }).id !== "floor") continue;
        const c = fieldToWorld({ x: x + 0.5, y: y + 0.5 });
        drawFloorDecor(g, theme, x, y, c.x, c.y);
      }
    for (const z of field.zones) {
      if (z.terrain === "floor") continue;
      const pts = z.poly.map((p) => new Phaser.Math.Vector2(fieldToWorld(p).x, fieldToWorld(p).y));
      g.fillStyle(ZONE_COLORS[z.terrain], 1).fillPoints(pts, true);
      g.lineStyle(2, 0x000000, z.terrain === "rock" ? 0.6 : 0.25).strokePoints(pts, true, true);
    }
    // Texture inside the patches: rock faces, ripples, grass blades.
    for (let y = 0; y < field.height; y++)
      for (let x = 0; x < field.width; x++) {
        const id = terrainAt(field, { x: x + 0.5, y: y + 0.5 }).id;
        const c = fieldToWorld({ x: x + 0.5, y: y + 0.5 });
        if (id === "rock") drawWallDecor(g, x, y, c.x, c.y);
        else if (id === "water") drawWaterDecor(g, x, y, c.x, c.y);
        else if (id === "bush") {
          g.fillStyle(0x3f8a45, 1);
          for (const [dx, dy] of [[-12, 8], [0, -4], [8, 10]] as const) g.fillTriangle(c.x + dx, c.y + dy, c.x + dx + 4, c.y + dy - 10, c.x + dx + 8, c.y + dy);
        }
      }
    const { width, height } = this.scale;
    this.boardImage ??= this.add.renderTexture(0, 0, width, height).setOrigin(0).setDepth(-1);
    this.boardImage.clear().draw(g).render();
  }

  /** The middle of the other side's starting spots. */
  private startLookAt(side: "player" | "enemy"): Point | null {
    const pts = side === "enemy" ? this.scenario.deploymentZone : this.scenario.enemies.map((e) => e.pos);
    if (!pts.length) return null;
    return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
  }

  private createUnitView(id: string, speciesId: string, side: "player" | "enemy", pos: Point): void {
    const species = CONTENT.species[speciesId]!;
    const { x, y } = fieldToWorld(pos);
    const teamColor = side === "player" ? COLORS.player : COLORS.enemy;
    // The base is the body's true size: what blocks and collides (the container is scaled by UNIT_SCALE).
    const foot = (UNIT_RADIUS * S * 2) / UNIT_SCALE;
    const ring = this.add.ellipse(0, 0, foot, foot, teamColor, 0.3).setStrokeStyle(2, teamColor);
    const body = this.add.circle(0, 0, 16, TYPE_COLORS[species.types[0]!] ?? 0x888888);
    const label = this.add
      .text(0, -1, species.name.slice(0, 2), { fontFamily: FONT, fontSize: "14px", color: "#10141c", fontStyle: "bold" })
      .setOrigin(0.5);
    // At the start the two sides face each other: enemies look at the deployment spots, the party at the enemies.
    const look = this.startLookAt(side);
    const facing = look ? facingFor(fieldToWorld(look).x - x, fieldToWorld(look).y - y) : side === "player" ? FACE_RIGHT : FACE_LEFT;
    const sprite = hasSprite(speciesId)
      ? this.add.sprite(0, 8, `${speciesId}-idle`).setOrigin(0.5, 0.82).setScale(1.25).play(animKey(speciesId, "idle", facing))
      : null;
    const hpBg = this.add.rectangle(-18, 21, 36, 4, 0x000000).setOrigin(0, 0.5);
    const hpBar = this.add.rectangle(-18, 21, 36, 4, 0x7ed321).setOrigin(0, 0.5);
    const spiritBar = this.add.rectangle(-18, 24, 0, 2, 0xf5d76e).setOrigin(0, 0.5);
    const container = this.add.container(x, y, [ring, ...(sprite ? [sprite] : []), body, label, hpBg, hpBar, spiritBar]).setScale(UNIT_SCALE);
    this.units.set(id, { container, hpBar, spiritBar, ring, body, label, sprite, speciesId, facing });
    // Species without a sprite show as a type-coloured disc with their initials.
    body.setVisible(!sprite);
    label.setVisible(!sprite);
  }

  /** Plays an animation on the unit's sprite, facing a direction. */
  private animate(unitId: string, anim: SpriteAnim, facing?: Facing): void {
    const view = this.units.get(unitId);
    if (!view?.sprite) return;
    if (facing !== undefined) view.facing = facing;
    view.sprite.play(animKey(view.speciesId, anim, view.facing), true);
  }

  /** Red flash and a small shake when a unit takes damage. */
  private flinch(unitId: string): void {
    const view = this.units.get(unitId);
    if (!view?.sprite) return;
    view.sprite.setTint(0xff4040);
    this.time.delayedCall(90, () => view.sprite?.clearTint());
    this.tweens.add({ targets: view.sprite, x: { from: -3, to: 0 }, duration: 160, ease: "Bounce.Out" });
  }

  /**
   * Puts the views in step with the state. While events play, `positions` is false: the tweens move the
   * Pokémon (the state already holds where they end up, after any knockback still to be shown).
   */
  private syncUnits(positions = true): void {
    if (!this.state) return;
    for (const u of this.state.units) {
      const view = this.units.get(u.id);
      if (!view) continue;
      if (positions) {
        const { x, y } = fieldToWorld(u.pos);
        // Lower on the field draws in front.
        view.container.setPosition(x, y).setVisible(u.hp > 0).setDepth(2 + u.pos.y / 100);
      }
      this.setHpBar(u.id, u.hp, u.maxHp);
      // Spirit: fills gold; full width (white) while Pumped.
      const pumped = u.statuses.some((s) => s.id === "pumped");
      view.spiritBar.width = pumped ? 36 : 36 * (u.spirit ?? 0) / CONTENT.rules.willpower.spiritMax;
      view.spiritBar.fillColor = pumped ? 0xffffff : 0xf5d76e;
      const active = this.state.turn?.unitId === u.id;
      view.ring.setStrokeStyle(active ? 4 : 3, active ? COLORS.active : u.side === "player" ? COLORS.player : COLORS.enemy);
    }
  }

  private setHpBar(unitId: string, hp: number, maxHp: number): void {
    const view = this.units.get(unitId);
    if (!view) return;
    const frac = Math.max(0, hp) / maxHp;
    view.hpBar.width = 36 * frac;
    view.hpBar.fillColor = frac > 0.5 ? 0x7ed321 : frac > 0.25 ? 0xf5a623 : 0xd0021b;
  }

  /** Hover (or tap) a foe: where it can walk next turn (orange) and how far its attacks reach from there (red ring). */
  private drawThreat(): void {
    if (!this.hovered || this.selectedMove || this.selectedBall || this.hoveredMove || this.busy || this.phase === "over") return;
    const state = this.state ?? (this.phase === "deploy" ? this.deployPreviewState() : null);
    const foe = state ? freeUnitAt(state, this.hovered) : undefined;
    if (!state || !foe || foe.side !== "enemy" || foe.hp <= 0) return;
    const mp = movementPoints(CONTENT, foe, state);
    this.fillCells(freeReachFor(state, foe.id, mp).cells, 0xffb347, 0.4);
    const strike = Math.max(0, ...foe.moves.map((m) => CONTENT.moves[m]).filter((m) => m && m.power > 0).map((m) => freeRange(foe, m!, CONTENT).max));
    const c = fieldToWorld(foe.pos);
    this.overlay.lineStyle(2, COLORS.target, 0.9).strokeCircle(c.x, c.y, (mp + strike) * S);
  }

  /** The battle as it would start with the current placements, for previews during deployment. */
  private deployPreviewState(): BattleState | null {
    try {
      const players = this.placements.map((p) => {
        const m = this.party.find((c) => c.id === p.unitId)!;
        return { ...m.setup, id: m.id, speciesId: m.speciesId, side: "player" as const, pos: p.pos, hp: m.hp };
      });
      return createBattle(CONTENT, this.scenario.field, [...players, ...this.scenario.enemies], { seed: 1 }).state;
    } catch {
      return null;
    }
  }

  /** Lattice cells (from a reach) as merged row strips: far fewer shapes than one square each. */
  private fillCells(cells: readonly Point[], color: number, alpha: number, g: Phaser.GameObjects.Graphics = this.overlay): void {
    g.fillStyle(color, alpha);
    const rows = new Map<number, number[]>();
    for (const c of cells) {
      const r = Math.floor(c.y / CELL);
      (rows.get(r) ?? rows.set(r, []).get(r)!).push(c.x);
    }
    for (const [r, xs] of rows) {
      xs.sort((a, b) => a - b);
      let start = xs[0]!;
      let prev = start;
      for (const x of [...xs.slice(1), Infinity]) {
        if (x - prev > CELL * 1.5) {
          const p = fieldToWorld({ x: start - CELL / 2, y: r * CELL });
          g.fillRect(p.x, p.y, (prev - start + CELL) * S, CELL * S);
          start = x;
        }
        prev = x;
      }
    }
  }

  /** The active Pokémon's walkable area, kept in a texture until the state changes. */
  private drawReach(): void {
    this.reachGfx ??= this.make.graphics({}, false);
    this.reachImage ??= this.add.renderTexture(0, 0, this.scale.width, this.scale.height).setOrigin(0).setDepth(0);
    const show = this.phase === "battle" && this.state && this.isPlayerTurn() && !this.busy && !this.selectedMove && !this.selectedBall && !this.hoveredMove;
    if (!show) {
      if (this.reach) this.reachImage.clear();
      this.reach = null;
      return;
    }
    const state = this.state!;
    if (this.reachFor?.state !== state) this.reachFor = { state, reach: freeReachFor(state, state.turn!.unitId) };
    if (this.reach === this.reachFor.reach) return;
    this.reach = this.reachFor.reach;
    const g = this.reachGfx.clear();
    this.fillCells(this.reach.cells, COLORS.reach, 0.3, g);
    this.reachImage.clear().draw(g).render();
  }

  private drawArea(area: FreeArea, color: number, alpha: number): void {
    const g = this.overlay;
    if (area.kind === "single") {
      const c = fieldToWorld(area.at);
      g.fillStyle(color, alpha).fillCircle(c.x, c.y, UNIT_RADIUS * S + 3);
    } else if (area.kind === "circle") {
      const c = fieldToWorld(area.at);
      g.fillStyle(color, alpha).fillCircle(c.x, c.y, area.radius * S);
      g.lineStyle(2, color, 0.9).strokeCircle(c.x, c.y, area.radius * S);
    } else if (area.kind === "cone") {
      const pts = this.conePoints(area);
      g.fillStyle(color, alpha).fillPoints(pts, true);
      g.lineStyle(2, color, 0.9).strokePoints(pts, true, true);
    } else {
      const a = fieldToWorld(area.from);
      const b = fieldToWorld(area.to);
      g.lineStyle(area.width * 2 * S, color, alpha).lineBetween(a.x, a.y, b.x, b.y);
    }
  }

  private conePoints(area: Extract<FreeArea, { kind: "cone" }>): Phaser.Math.Vector2[] {
    const pts = [area.from];
    for (let i = 0; i <= 12; i++) {
      const a = area.angle - area.halfAngle + (2 * area.halfAngle * i) / 12;
      pts.push({ x: area.from.x + Math.cos(a) * area.length, y: area.from.y + Math.sin(a) * area.length });
    }
    return pts.map((p) => new Phaser.Math.Vector2(fieldToWorld(p).x, fieldToWorld(p).y));
  }

  /**
   * Burning and poisoned ground, marked strikes (red, dashed) and watched areas (gold): only their outlines,
   * so the field stays readable; the info and the log tell the rest.
   */
  private drawFieldEffects(): void {
    const state = this.state;
    if (!state) return;
    const g = this.overlay;
    for (const h of state.hazards ?? []) {
      if (h.kind === "mud") continue;
      const c = fieldToWorld(h.at);
      g.fillStyle(HAZARD_COLORS[h.kind], 0.28).fillCircle(c.x, c.y, h.radius * S);
      g.lineStyle(2, HAZARD_COLORS[h.kind], 0.8).strokeCircle(c.x, c.y, h.radius * S);
    }
    for (const p of state.pending ?? []) {
      const color = p.kind === "delayed" ? COLORS.target : 0xf5d76e;
      const outline = p.area.kind === "cone" ? this.conePoints(p.area)
        : p.area.kind === "line" ? [p.area.from, p.area.to].map((q) => new Phaser.Math.Vector2(fieldToWorld(q).x, fieldToWorld(q).y))
        : Array.from({ length: 24 }, (_, i) => {
          const r = p.area.kind === "circle" ? p.area.radius : UNIT_RADIUS + 0.05;
          const at = (p.area as { at: Point }).at;
          return new Phaser.Math.Vector2(fieldToWorld({ x: at.x + Math.cos((i / 24) * Math.PI * 2) * r, y: at.y + Math.sin((i / 24) * Math.PI * 2) * r }).x,
            fieldToWorld({ x: at.x + Math.cos((i / 24) * Math.PI * 2) * r, y: at.y + Math.sin((i / 24) * Math.PI * 2) * r }).y);
        });
      g.fillStyle(color, 0.1).fillPoints(outline, true);
      // Dashed outline: every other edge.
      g.lineStyle(2, color, 0.9);
      for (let i = 0; i < outline.length; i += 2) {
        const a = outline[i]!, b = outline[(i + 1) % outline.length]!;
        g.lineBetween(a.x, a.y, b.x, b.y);
      }
    }
  }

  private ringAt(p: Point, color: number, extra = 6, width = 2): void {
    const c = fieldToWorld(p);
    this.overlay.lineStyle(width, color, 1).strokeCircle(c.x, c.y, UNIT_RADIUS * S + extra);
  }

  /** Aiming the selected move at the hover: range, valid targets, area, line of sight and the expected hits. */
  private drawAim(unit: BattleUnit, moveId: string, hover: Point | null): void {
    const state = this.state!;
    const move = CONTENT.moves[moveId]!;
    const range = freeRange(unit, move, CONTENT);
    const from = fieldToWorld(unit.pos);
    const ring = fanLength(move) ?? range.max;
    if (ring > 0) {
      this.overlay.fillStyle(COLORS.target, 0.08).fillCircle(from.x, from.y, ring * S);
      this.overlay.lineStyle(2, COLORS.target, 0.7).strokeCircle(from.x, from.y, ring * S);
      if (range.min > 0) this.overlay.lineStyle(1, COLORS.target, 0.5).strokeCircle(from.x, from.y, range.min * S);
    }
    for (const u of livingUnits(state)) {
      if (u.id === unit.id && range.max > 0) continue;
      if (freeAim(state, CONTENT, unit.id, moveId, u.pos).ok) this.ringAt(u.pos, COLORS.target);
    }
    if (!hover) return;
    const aim = freeAim(state, CONTENT, unit.id, moveId, hover);
    if (!aim.ok) {
      if (aim.area) this.drawArea(aim.area, 0x8a93a6, 0.3);
      if (aim.reason === "no line of sight") {
        const to = fieldToWorld(hover);
        this.overlay.lineStyle(2, COLORS.target, 0.9).lineBetween(from.x, from.y, to.x, to.y);
      }
      this.aimNote = tag("bad", t(aim.reason));
      return;
    }
    this.drawArea(aim.area, move.shape.kind !== "single" ? COLORS.areaAim : COLORS.target, 0.35);
    if (move.timing) {
      // Nothing is hit now: the preview shows what it would do if no one moves (or the foe likeliest to walk in).
      const outcome = timedStrikeOutcome(state, CONTENT, unit.id, moveId, hover);
      if (outcome) this.showPreview(summarizeHits(outcome.events));
      this.aimNote = tag("dim", move.timing === "delayed" ? t("Strikes this ground at the start of its next turn") : t("Guards this area until its next turn: the first foe moving in is struck"));
      return;
    }
    const to = fieldToWorld(aim.target);
    if (move.requiresLineOfSight) this.overlay.lineStyle(2, 0x7ed321, 0.9).lineBetween(from.x, from.y, to.x, to.y);
    const hits = previewFreeMove(state, CONTENT, unit.id, moveId, hover);
    // A ranged shot at one Pokémon shows its odds: the rest go to the ally who may catch it.
    const ranged = move.shape.kind === "single" && range.max > MELEE_REACH && move.affects === "enemies";
    const catchChance = aim.interceptor ? Math.round(aim.interceptChance! * 100) : 0;
    this.showPreview(hits, (h) => (ranged && h.unitId === aim.affected[0]?.id ? `${100 - catchChance}%` : ""));
    for (const push of previewPushes(state, CONTENT, unit.id, moveId, hover)) this.drawPush(unit.pos, push);
    if (aim.interceptor) {
      this.ringAt(aim.interceptor.pos, 0xf5a623);
      this.previewLabel(aim.interceptor.id, `${catchChance}%`, "#f5a623");
      this.aimNote = tag("bad", t("⚠ {chance}% chance to hit {name} instead", { chance: catchChance, name: CONTENT.species[aim.interceptor.speciesId]!.name }));
    }
  }

  /**
   * A knockback as an arrow from where the Pokémon stands to where it would land; hitting an obstacle
   * shows the impact damage at the arrow's tip. A Pokémon pinned in place gets a short arrow away from the user.
   */
  private drawPush(userPos: Point, push: PushPreview): void {
    let to = push.to;
    if (distance(push.from, push.to) < 0.2) {
      const d = distance(userPos, push.from) || 1;
      to = { x: push.from.x + ((push.from.x - userPos.x) / d) * 0.5, y: push.from.y + ((push.from.y - userPos.y) / d) * 0.5 };
    }
    const a = fieldToWorld(push.from);
    const b = fieldToWorld(to);
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const head = 9;
    const color = push.impact ? COLORS.target : 0xf5d76e;
    this.overlay.lineStyle(3, color, 0.95).lineBetween(a.x, a.y, b.x - Math.cos(ang) * 4, b.y - Math.sin(ang) * 4);
    this.overlay.fillStyle(color, 0.95).fillTriangle(
      b.x, b.y,
      b.x - Math.cos(ang - 0.5) * head, b.y - Math.sin(ang - 0.5) * head,
      b.x - Math.cos(ang + 0.5) * head, b.y - Math.sin(ang + 0.5) * head,
    );
    if (!push.impact) return;
    this.previewLabels ??= this.add.container(0, 0).setDepth(16);
    this.previewLabels.add(this.add.text(b.x + Math.cos(ang) * 10, b.y + Math.sin(ang) * 10, `-${push.impact}`, {
      fontFamily: FONT, fontSize: "13px", fontStyle: "bold", color: "#ff5050", backgroundColor: "#10141ccc", padding: { x: 3, y: 1 },
    }).setOrigin(0.5));
  }

  /** Hovering a walk: the path, its cost, and the free attack it would draw. */
  private drawWalk(unit: BattleUnit, hover: Point): void {
    const reach = this.reach;
    if (!reach) return;
    const cost = reach.costTo(hover);
    const path = reach.pathTo(hover);
    if (cost === null || !path) return;
    const from = fieldToWorld(unit.pos);
    this.overlay.lineStyle(3, 0xffffff, 0.85).beginPath().moveTo(from.x, from.y);
    for (const p of path) this.overlay.lineTo(fieldToWorld(p).x, fieldToWorld(p).y);
    this.overlay.strokePath();
    const end = fieldToWorld(hover);
    this.overlay.lineStyle(2, 0xffffff, 0.9).strokeCircle(end.x, end.y, UNIT_RADIUS * S);
    this.aimNote = t("Walk: {cost} of {left} movement", { cost: tag("num", cost.toFixed(1)), left: this.state!.turn!.movePointsLeft.toFixed(1) });
    if (breaksEngagement(this.state!, unit.id, hover)) {
      this.showPreview(previewFreeWalk(this.state!, CONTENT, unit.id, hover));
      const p = fieldToWorld(hover);
      this.previewLabels!.add(this.add.text(p.x, p.y - 22, t("⚔ {n} free attack", { n: 1 }), {
        fontFamily: FONT, fontSize: "12px", fontStyle: "bold", color: "#ff8080", backgroundColor: "#10141ccc", padding: { x: 3, y: 1 },
      }).setOrigin(0.5).setDepth(8));
    }
  }

  /** One extra line under the info: why an aim fails, the walk's cost, a catch warning. */
  private aimNote = "";

  private refreshOverlay(): void {
    this.overlay.clear();
    if (this.demo) return this.drawFieldEffects();
    this.previewLabels?.destroy();
    this.previewLabels = null;
    this.comboLabels?.setVisible(true);
    this.aimNote = "";
    this.drawReach();
    if (this.phase === "battle") this.drawFieldEffects();
    const hover = this.armed ?? this.hovered;
    if (this.phase === "deploy") {
      for (const p of this.scenario.deploymentZone) {
        const taken = this.placements.some((pl) => samePoint(pl.pos, p));
        const c = fieldToWorld(p);
        this.overlay.fillStyle(COLORS.zone, taken ? 0.15 : 0.35).fillCircle(c.x, c.y, UNIT_RADIUS * S + 2);
        this.overlay.lineStyle(2, COLORS.zone, 0.9).strokeCircle(c.x, c.y, UNIT_RADIUS * S + 2);
      }
    } else if (this.phase === "battle" && this.state && this.isPlayerTurn() && !this.busy) {
      const unit = activeUnit(this.state)!;
      if (this.selectedBall) {
        // The catch chance over every Pokémon the ball can reach (a phone has no hover to show it in the info).
        for (const p of captureTargets(this.state, CONTENT, unit.id, this.selectedBall)) {
          this.ringAt(p, COLORS.active, 6, 3);
          const foe = this.state.units.find((u) => u.hp > 0 && distance(u.pos, p) < 0.01);
          if (foe) this.previewLabel(foe.id, `${Math.round(captureChance(CONTENT, foe, this.selectedBall) * 100)}%`, "#7ed321");
        }
      } else if (this.selectedMove) {
        this.drawAim(unit, this.selectedMove, hover);
      } else if (this.hoveredMove) {
        // Range preview: how far the move reaches from here.
        const move = CONTENT.moves[this.hoveredMove]!;
        const range = freeRange(unit, move, CONTENT);
        const ring = fanLength(move) ?? range.max;
        const c = fieldToWorld(unit.pos);
        if (ring > 0) this.overlay.fillStyle(COLORS.target, 0.15).fillCircle(c.x, c.y, ring * S).lineStyle(2, COLORS.target, 0.8).strokeCircle(c.x, c.y, ring * S);
      } else if (hover) {
        this.drawWalk(unit, hover);
      }
    }
    this.drawThreat();
    if (this.phase === "battle" && this.state) this.drawCombatMarks();
    // Touch: the tapped spot pulses in gold until it is tapped again (confirm).
    if (!this.armedFrame) {
      this.armedFrame = this.add.circle(0, 0, UNIT_RADIUS * S + 4).setStrokeStyle(4, 0xf5d76e).setDepth(20).setVisible(false);
      this.tweens.add({ targets: this.armedFrame, alpha: { from: 1, to: 0.25 }, duration: 350, yoyo: true, repeat: -1 });
    }
    this.armedFrame.setVisible(this.armed !== null);
    // A mouse aiming a ball carries the ball as its cursor.
    if (!PHONE) this.input.setDefaultCursor(this.selectedBall && this.phase === "battle" ? ballCursor(this.selectedBall) : "default");
    if (this.armed) {
      const c = fieldToWorld(this.armed);
      this.armedFrame.setPosition(c.x, c.y);
    }
  }

  /**
   * Engaged pairs are joined by a line; on the player's turn, foes the active Pokémon would combo
   * (pinned by or carrying a status from an ally) get a gold corner mark.
   */
  private drawCombatMarks(): void {
    const state = this.state!;
    const centre = fieldToWorld;
    this.overlay.lineStyle(3, COLORS.engage, 0.85);
    for (const u of state.units) {
      const partner = u.hp > 0 ? partnerOf(state, u) : null;
      if (!partner || u.id > partner.id) continue;
      const a = centre(u.pos), b = centre(partner.pos);
      this.overlay.lineBetween(a.x, a.y, b.x, b.y);
    }
    this.comboLabels?.destroy(true);
    this.comboLabels = null;
    if (!this.isPlayerTurn()) return;
    const active = activeUnit(state)!;
    // Named combo the active Pokémon would land: its name over the foe.
    this.comboLabels = this.add.container(0, 0).setDepth(15);
    for (const foe of state.units) {
      const combo = foe.side === active.side || foe.hp <= 0 ? null : comboSetup(state, CONTENT, active, foe);
      if (!combo) continue;
      const c = fieldToWorld(foe.pos);
      // Just a mark on the field; the combo's name and bonus are in the info when the foe is selected.
      this.comboLabels.add(this.add.text(c.x + 13, c.y - 24, "⚡", {
        fontFamily: FONT, fontSize: px(11), color: "#10141c", fontStyle: "bold", backgroundColor: "#f5d76e", padding: { x: 2, y: 0 },
      }).setOrigin(0.5));
    }
    // A damage preview takes the spot over the foe: the combo name would hide it.
    if (this.previewLabels) this.comboLabels.setVisible(false);
  }

  // ------------------------------------------------------------ panel

  private refreshAll(): void {
    if (this.demo) return this.syncUnits();
    this.armed = null;
    this.markActive();
    this.syncUnits();
    this.refreshPanel();
    this.refreshOverlay();
    this.refreshInfo();
    this.showTips();
  }

  /** Exact predicted damage above every Pokémon the hovered aim would hit. */
  /** "Engaged with Mankey": they may only attack each other, and stepping away draws a free attack. */
  private engagementLine(unit: BattleUnit): string {
    if (!this.state || unit.hp <= 0) return "";
    const partner = partnerOf(this.state, unit);
    if (!partner) return "";
    return `${t("{engaged} with {name}", { engaged: tag("bad", t("Engaged")), name: CONTENT.species[partner.speciesId]!.name })} ${tag("dim", unit.mods.disengage ? t("(only melee on each other; slips away freely)") : t("(only melee on each other; any step draws a free attack first)"))}`;
  }

  /** "Set up for a combo": hitting this foe now gains Bond and triggers combo bonuses. */
  private comboLine(unit: BattleUnit): string {
    if (!this.state || unit.hp <= 0 || !this.isPlayerTurn()) return "";
    const active = activeUnit(this.state)!;
    const setup = unit.side !== active.side ? comboSetup(this.state, CONTENT, active, unit) : null;
    if (!setup) return "";
    const c = CONTENT.rules.combos[setup]!;
    const why = c.engaged ? t("an ally has engaged it") : c.status ? t("an ally's {status} is on it", { status: CONTENT.statuses[c.status]?.name ?? c.status }) : t("it carries an ally's status");
    return `${tag("good", t("Combo: {name}", { name: c.name }))} ${tag("dim", `${why}: ×${c.damage} ${t("damage")}${c.consumes ? t(", uses the status up") : ""}`)}`;
  }

  /** Exact predicted damage above every Pokémon a hit would touch; `extra` adds e.g. the hit chance. */
  private showPreview(hits: readonly HitPreview[], extra: (h: HitPreview) => string = () => ""): void {
    this.previewLabels ??= this.add.container(0, 0).setDepth(16);
    for (const h of hits) {
      const parts = [h.damage ? `-${h.damage}` : "", h.healed ? `+${h.healed}` : "", h.knockedOut ? "KO" : "", extra(h)].filter(Boolean);
      // A status-only hit gets a small mark; its name is in the move's description.
      if (!parts.length && !h.statuses.length) continue;
      this.previewLabel(h.unitId, parts.length ? parts.join(" ") : "●", h.knockedOut ? "#ff5050" : h.healed && !h.damage ? "#7ed321" : "#ffd27a");
    }
    this.comboLabels?.setVisible(false);
    this.lastPreview = hits;
  }

  /** A label over a Pokémon; labels of Pokémon standing close stack instead of overlapping. */
  private previewLabel(unitId: string, text: string, color: string): void {
    const view = this.units.get(unitId);
    if (!view) return;
    this.previewLabels ??= this.add.container(0, 0).setDepth(16);
    const label = this.add.text(view.container.x, view.container.y - 30, text, {
      fontFamily: FONT, fontSize: "14px", fontStyle: "bold", color, backgroundColor: "#10141ccc", padding: { x: 3, y: 1 },
    }).setOrigin(0.5);
    const others = this.previewLabels.list as Phaser.GameObjects.Text[];
    while (others.some((o) => Phaser.Geom.Intersects.RectangleToRectangle(o.getBounds(), label.getBounds()))) label.y -= label.height;
    this.previewLabels.add(label);
  }

  /** Who acts this round, in order, next to the round counter: portraits ringed in team colours. */
  private renderTurnOrder(state: BattleState): void {
    this.orderStrip?.destroy();
    const items: Phaser.GameObjects.GameObject[] = [];
    const x0 = BOARD_X + this.header.width + 16;
    state.queue.forEach((id, i) => {
      const u = unitById(state, id);
      const x = x0 + i * 30;
      const active = i === 0;
      const color = u.side === "player" ? COLORS.player : COLORS.enemy;
      items.push(this.add.rectangle(x, 10, 26, 26, 0x10141c).setOrigin(0).setStrokeStyle(active ? 3 : 2, active ? COLORS.active : color));
      if (this.textures.exists(portraitKey(u.speciesId))) items.push(this.add.image(x + 13, 23, portraitKey(u.speciesId)).setDisplaySize(26, 26));
      else items.push(this.add.text(x + 13, 23, "?", { fontFamily: FONT, fontSize: "14px", color: COLORS.text }).setOrigin(0.5));
      items.push(this.add.rectangle(x, 10, 26, 26).setOrigin(0).setStrokeStyle(active ? 3 : 2, active ? COLORS.active : color));
      items.push(this.add.text(x + 25, 37, String(u.level), { fontFamily: FONT, fontSize: "10px", color: COLORS.text, stroke: "#10141c", strokeThickness: 3 }).setOrigin(1, 1));
      if (i < state.queue.length - 1) items.push(this.add.text(x + 27, 23, "›", { fontFamily: FONT, fontSize: "12px", color: COLORS.dim }).setOrigin(0, 0.5));
    });
    this.orderStrip = this.add.container(0, 0, items);
  }

  private panelKey = "";

  /** Everything the side panel shows depends on; when it is unchanged the panel is not rebuilt (that costs GPU textures). */
  private panelSignature(): string {
    const st = this.state;
    return JSON.stringify([
      this.phase, this.busy, this.selectedMove, this.selectedBall, this.confirmRetreat, this.selectedCandidate, this.placements,
      this.rewardText, this.summary !== null && this.summary !== undefined,
      st && [st.round, st.turn, st.bond, st.outcome, st.balls, st.units.map((u) => [u.id, u.pos.x, u.pos.y, u.hp, u.statuses, u.cooldowns, u.engagedWith, u.usedUltimates.length, u.captured])],
    ]);
  }

  private refreshPanel(): void {
    const sig = this.panelSignature();
    if (sig === this.panelKey) return;
    this.panelKey = sig;
    this.orderStrip?.destroy();
    this.orderStrip = null;
    this.panel.removeAll(true);
    this.hoveredMove = null;
    let y = 0;
    const text = (s: string, color: string = COLORS.text, size = 13) => {
      const t = this.add.text(0, y, s, { fontFamily: FONT, fontSize: px(size), color, wordWrap: { width: PANEL_W } });
      this.panel.add(t);
      y += t.height + 4;
    };
    // A thin rule between groups of moves of different kinds (basic, skills, Bond).
    const divider = () => {
      y += 2;
      this.panel.add(this.add.rectangle(0, y, PANEL_W, 1, KIND_DIVIDER, 0.9).setOrigin(0));
      y += 7;
    };
    const button = (label: string, enabled: boolean, highlighted: boolean, onClick: () => void, color?: number) => {
      const b = new Button(this, 0, y, PANEL_W, 26, label, onClick);
      // A move's button takes its type's colour.
      if (color !== undefined) b.setFill(color);
      b.setEnabled(enabled).setHighlighted(highlighted);
      this.panel.add(b);
      y += 30;
      return b;
    };

    if (this.phase === "deploy") {
      this.header.setText(t("Deployment"));
      text(t("Pick up to {n}: tap a card, then a blue spot. Tap a foe: its reach (orange) and attack range (red).", { n: this.scenario.maxDeploy ?? MAX_ACTIVE_UNITS }), COLORS.dim, 12);
      const level = fatigueLevel(WORLD_CONTENT.fatigue, session.game.world.fatigue);
      if (level.movePenalty || level.damageMultiplier !== 1)
        text(level.damageMultiplier !== 1
          ? t("Fatigue: {level}. Your Pokémon get −{move} movement and deal {dmg}% less damage.", { level: level.name, move: level.movePenalty, dmg: Math.round((1 - level.damageMultiplier) * 100) })
          : t("Fatigue: {level}. Your Pokémon get −{move} movement.", { level: level.name, move: level.movePenalty }), COLORS.bad, 12);
      // The party as portrait cards (3 per row): tap one, then a blue tile to place it.
      const cardW = Math.floor((PANEL_W - 12) / 3), cardH = 66;
      this.party.forEach((m, i) => {
        const cx = (i % 3) * (cardW + 6), cy = y + Math.floor(i / 3) * (cardH + 6);
        const placed = this.placements.some((p) => p.unitId === m.id);
        const selected = this.selectedCandidate === m.id;
        const ko = this.knockoutsOf(m.id);
        const alive = m.hp > 0;
        const bg = this.add.rectangle(cx, cy, cardW, cardH, selected ? 0x3a4560 : 0x1c2230).setOrigin(0)
          .setStrokeStyle(selected ? 3 : 1, selected ? 0xf5d76e : placed ? 0x7fd4ff : 0x5a6785);
        const parts: Phaser.GameObjects.GameObject[] = [bg];
        if (this.textures.exists(portraitKey(m.speciesId))) parts.push(this.add.image(cx + 22, cy + 42, portraitKey(m.speciesId)).setDisplaySize(38, 38).setAlpha(alive ? 1 : 0.35));
        parts.push(this.add.text(cx + 4, cy + 3, CONTENT.species[m.speciesId]!.name, { fontFamily: FONT, fontSize: px(11), color: alive ? COLORS.text : COLORS.dim }));
        // HP bar and knockout pips (red when one more knockout means losing it).
        const frac = alive ? m.hp / (m.setup?.maxHp ?? maxHpOf(CONTENT, m.speciesId)) : 0;
        parts.push(this.add.rectangle(cx + 46, cy + 34, cardW - 50, 6, 0x2a3242).setOrigin(0, 0.5));
        parts.push(this.add.rectangle(cx + 46, cy + 34, (cardW - 50) * frac, 6, frac > 0.5 ? 0x6bd36b : frac > 0.2 ? 0xf5d76e : 0xff6b6b).setOrigin(0, 0.5));
        parts.push(this.add.text(cx + 46, cy + 42, "●".repeat(ko) + "○".repeat(KNOCKOUTS_TO_DEATH - ko), { fontFamily: FONT, fontSize: px(11), color: ko >= 2 ? "#ff6b6b" : COLORS.dim }));
        if (placed) parts.push(this.add.text(cx + cardW - 4, cy + cardH - 4, "✓", { fontFamily: FONT, fontSize: px(14), color: "#7fd4ff" }).setOrigin(1));
        if (alive) bg.setInteractive({ useHandCursor: true }).on("pointerup", () => {
          this.selectedCandidate = m.id;
          this.refreshAll();
        });
        this.panel.add(parts);
      });
      y += Math.ceil(this.party.length / 3) * (cardH + 6);
      const errors = deploymentErrors(this.scenario, this.party, this.placements);
      y += 4;
      button(t("▶ Lock deployment & start ({n}/{max})", { n: this.placements.length, max: this.scenario.maxDeploy ?? MAX_ACTIVE_UNITS }), errors.length === 0, false, () => this.startBattle());
      button(t("← Avoid this battle"), true, false, () => {
        // The group lets the party walk away instead of catching it again at the next step.
        if (this.encounterId) session.update({ ...session.game, world: calmEncounter(session.game.world, this.encounterId) });
        this.scene.start("Overworld", {});
      });
      return;
    }

    const state = this.state!;
    if (this.phase === "over") {
      this.header.setText(state.outcome === "victory" ? t("Victory!") : state.outcome === "defeat" ? t("Defeat") : t("Retreated"));
      const sum = this.summary;
      if (sum) {
        const name = (uid: string) => CONTENT.species[this.party.find((m) => m.id === uid)!.speciesId]!.name;
        if (state.outcome === "defeat") text(t("Your team falls back to camp and rests there."), COLORS.dim, 12);
        for (const c of sum.captured) text(c.to === "party" ? t("Caught {name}! Sent to your party.", { name: CONTENT.species[c.member.speciesId]!.name }) : t("Caught {name}! Sent to storage (party full).", { name: CONTENT.species[c.member.speciesId]!.name }), COLORS.good);
        for (const uid of sum.knockedOut.filter((u) => !sum.fallen.includes(u)))
          text(t("{name} was knocked out (KO {n}/{max}).", { name: name(uid), n: this.knockoutsOf(uid), max: KNOCKOUTS_TO_DEATH }), COLORS.bad);
        for (const uid of sum.fallen) text(t("{name} has fallen for good.", { name: name(uid) }), COLORS.bad);
        const money = sum.money + this.prizeMoney;
        if (sum.xp || money) text(`${t("+{xp} XP for each Pokémon that fought (half for the rest of the party) · +₽{money}", { xp: sum.xp, money })}${this.evGained ? ` · +${this.evGained} EV` : ""}${sum.candies ? t(" · +{n} Rare Candy", { n: sum.candies }) : ""}`, "#f5d76e");
        for (const [uid, evs] of Object.entries(sum.progress)) {
          for (const e of evs) {
            if (e.type === "levelUp") text(t("{name} reached Lv {lv}!", { name: name(uid), lv: e.level }), COLORS.good, 12);
            else if (e.type === "evolved") text(t("{name} evolved into {into}!", { name: name(uid), into: CONTENT.species[e.into]!.name }), "#f5d76e");
            else text(e.activated ? t("{name} learned {move}.", { name: name(uid), move: CONTENT.moves[e.move]!.name }) : t("{name} learned {move} (set it active in Party).", { name: name(uid), move: CONTENT.moves[e.move]!.name }), COLORS.good, 12);
          }
        }
        if (!sum.captured.length && !sum.knockedOut.length && !sum.xp) text(t("No losses."), COLORS.dim);
      }
      if (this.rewardText) text(this.rewardText, COLORS.good);
      button(t("➜ Continue"), true, false, () => this.scene.start("Overworld", {}));
      // The battle's log goes along, so the report can be replayed.
      if (FEEDBACK_URL) button(t("💬 Feedback on this battle"), true, false, () =>
        openFeedback(this.game, `battle ${this.scenario.id} (${this.biome ?? "-"})`, this.log.map((e) => stripMarkup(e.text)).join("\n")));
      this.infoY = 16 + y + 10;
      this.infoText.setY(this.infoY);
      return;
    }

    const unit = activeUnit(state);
    this.header.setText(t("Round {n}", { n: state.round }));
    this.renderTurnOrder(state);
    const bond = state.bond.player;
    text(`${CONTENT.terms.bond} ${"●".repeat(bond)}${"○".repeat(Math.max(0, state.bondMax.player - bond))} ${bond}/${state.bondMax.player}`, "#f5d76e", 13);
    if (unit && unit.side === "player" && !this.busy) {
      const species = CONTENT.species[unit.speciesId]!;
      text(`${species.name} · 👣${state.turn!.movePointsLeft.toFixed(1)}`, COLORS.good);
      if (switchTargets(state).length) text(t("Tap another of your Pokémon to act with it instead."), COLORS.dim, 11);
      // One basic attack a turn; specials as long as they are off cooldown; Bond moves while the Bond lasts.
      // Struggle only shows while it is the unit's way to fight (engaged, ranged basic attack).
      const basics = unit.moves.filter((m) => CONTENT.moves[m]!.kind === "basic" && (m !== "struggle" || !moveUnavailableReason(state, CONTENT, unit.id, m)));
      const skills = unit.moves.filter((m) => CONTENT.moves[m]!.kind !== "basic" && CONTENT.moves[m]!.kind !== "bond");
      const bonds = unit.moves.filter((m) => CONTENT.moves[m]!.kind === "bond");
      const ordered = [...basics, ...skills, ...bonds];
      for (const moveId of ordered) {
        // Thin rules part the kinds (basic attacks, skills, Bond moves); the first-turn tip and ? help explain them.
        if (moveId === skills[0] && basics.length) divider();
        if (moveId === bonds[0] && (basics.length || skills.length)) divider();
        const move = CONTENT.moves[moveId]!;
        const reason = moveUnavailableReason(state, CONTENT, unit.id, moveId);
        const hasTarget = !reason && freeHasTarget(state, CONTENT, unit.id, moveId);
        const cd = unit.cooldowns[moveId] ?? 0;
        const range = moveRange(unit, move, CONTENT);
        const used = move.kind === "basic" && state.turn!.basicUsed;
        const status = used ? t("used") : cd > 0 ? `⏳${cd}`
          // ✕ and the reach: nobody to aim at within it.
          : !used && !reason && !hasTarget ? `✕ ${range.min === range.max ? range.max : `${range.min}-${range.max}`}`
          // Basic and special need no label: the groups (parted by thin rules) say it.
          : move.kind === "basic" || move.kind === "special" ? ""
          : move.kind === "bond" ? ""
          : unit.usedUltimates.includes(moveId) ? t("ult used") : t("ult 1×");
        const ownBasic = basics.find((b) => b !== "struggle") ?? unit.moves.find((m) => m !== "struggle" && CONTENT.moves[m]!.kind === "basic");
        const power = moveId === "struggle" && ownBasic ? Math.round(CONTENT.moves[ownBasic]!.power * CONTENT.rules.engagement.fallbackPower) : move.power;
        // Fixed columns: name, power, state; a Bond move's cost last as Bond pips (the bar's ●, always shown;
        // the pip is wider than the font's other glyphs, so it goes where it shifts nothing).
        const pips = move.kind === "bond" ? "●".repeat(bondCostFor(move, unit)) : "";
        button(`${move.name.padEnd(13)} ${power ? `⚔${String(power).padStart(3)}` : "    "}  ${status.padEnd(7)}${pips}`, hasTarget, this.selectedMove === moveId, () => {
          this.selectedBall = null;
          this.selectedMove = this.selectedMove === moveId ? null : moveId;
          this.refreshAll();
        }, TYPE_COLORS[move.type]).onHover((over) => {
          this.hoveredMove = over ? moveId : this.hoveredMove === moveId ? null : this.hoveredMove;
          this.refreshInfo();
          this.refreshOverlay();
        });
      }
      if (state.captureAllowed) {
        const ballIds = Object.keys(CONTENT.balls);
        const w = Math.floor((PANEL_W - 8 * (ballIds.length - 1)) / ballIds.length);
        ballIds.forEach((ballId, i) => {
          const count = state.balls[ballId] ?? 0;
          const usable = captureTargets(state, CONTENT, unit.id, ballId).length > 0;
          // The ball itself (the aiming cursor's drawing) and how many are left.
          const key = `ball-icon-${ballId}`;
          if (!this.textures.exists(key)) this.textures.addCanvas(key, ballCanvas(ballId));
          const b = new Button(this, i * (w + 8), y, w, 26, `    ×${count}`, () => {
            this.selectedMove = null;
            this.selectedBall = this.selectedBall === ballId ? null : ballId;
            this.refreshAll();
          }).setEnabled(usable).setHighlighted(this.selectedBall === ballId);
          b.add(this.add.image(18, 13, key).setDisplaySize(18, 18).setAlpha(usable ? 1 : 0.45));
          this.panel.add(b);
        });
        y += 30;
      }
      const half = (PANEL_W - 8) / 2;
      this.panel.add(new Button(this, 0, y, half, 26, PHONE ? t("End turn") : t("End turn [Space]"), () => this.playerEndTurn()));
      this.panel.add(new Button(this, half + 8, y, half, 26, this.confirmRetreat ? t("Tap again to flee") : t("Retreat…"), () => {
        if (!this.confirmRetreat) {
          this.confirmRetreat = true;
          this.refreshAll();
          return;
        }
        this.confirmRetreat = false;
        this.playerRetreat();
      }).setHighlighted(this.confirmRetreat));
      y += 30;
    } else {
      text(t("Enemy turn…"), COLORS.bad);
    }
    this.infoY = 16 + y + 10;
    this.infoText.setY(this.infoY);
  }

  /** Shows info right under the panel; when it would run off the screen, the compact version is used. */
  private setInfo(full: string, compact?: string): void {
    const room = 536 - this.infoY;
    if (this.infoText.setMarkup(full) > room && compact !== undefined) this.infoText.setMarkup(compact);
  }

  private refreshInfo(): void {
    if (this.hoveredMove) {
      let text = describeMove(CONTENT, CONTENT.moves[this.hoveredMove]!);
      const unit = this.state ? activeUnit(this.state) : null;
      if (unit) {
        const raw = moveUnavailableReason(this.state!, CONTENT, unit.id, this.hoveredMove);
        const reason = raw ? t(raw) : !freeHasTarget(this.state!, CONTENT, unit.id, this.hoveredMove) ? t("no valid target from here") : null;
        if (reason) text += `\n\n${tag("bad", t("Not usable now: {reason}", { reason }))}`;
      }
      this.setInfo(text);
      return;
    }
    let unit: BattleUnit | undefined;
    const hover = this.armed ?? this.hovered;
    if (hover && this.inField(hover)) {
      if (this.state) unit = freeUnitAt(this.state, hover);
      else {
        const near = (p: Point) => distance(p, hover) <= UNIT_RADIUS;
        const e = this.scenario.enemies.find((x) => near(x.pos));
        const pl = this.placements.find((x) => near(x.pos));
        const id = e?.id ?? pl?.unitId;
        if (id) unit = this.previewUnit(id);
      }
    }
    // While aiming or walking, the aim's note (cost, failure reason, catch warning) leads.
    if (this.aimNote && (this.selectedMove || !unit)) {
      this.setInfo([this.aimNote, unit ? "" : this.selectedMove ? describeMove(CONTENT, CONTENT.moves[this.selectedMove]!) : ""].filter(Boolean).join("\n\n"));
      return;
    }
    if (!unit) {
      const terrainText = hover && this.inField(hover) ? this.terrainInfo(terrainAt(this.scenario.field, hover).id) : "";
      // Without a hovered unit, show the selected move's rules (also covers touch screens).
      const moveText = this.selectedMove ? describeMove(CONTENT, CONTENT.moves[this.selectedMove]!) : "";
      this.infoText.setMarkup([moveText, terrainText].filter(Boolean).join("\n\n"));
      return;
    }
    const s = CONTENT.species[unit.speciesId]!;
    if (PHONE) {
      // Phone: only what a turn needs. Name, types and HP (plus statuses); for an own Pokémon the
      // selected move's rules, for a foe how well the selected move hits it.
      const head = [
        `${tag(`${unit.side === "player" ? "ally" : "foe"}:${s.types[0]}`, s.name)}  ${s.types.map((ty) => tag(ty, ty)).join("/")}${s.role ? ` ${tag("special", s.role === "melee" ? t("Melee") : t("Ranged"))}` : ""}  HP ${tag(unit.hp / unit.maxHp > 0.5 ? "heal" : "dmg", `${unit.hp}/${unit.maxHp}`)}`,
        unit.statuses.length ? `${t("Status:")} ${unit.statuses.map((x) => `${tag("status", CONTENT.statuses[x.id]?.name ?? x.id)} (${x.turnsLeft})`).join(", ")}` : "",
        this.engagementLine(unit),
      ];
      const active = this.state ? activeUnit(this.state) : null;
      if (unit.side === "player" && this.selectedMove) head.push("", describeMove(CONTENT, CONTENT.moves[this.selectedMove]!));
      if (active && active.side === "player" && unit.side === "enemy" && this.selectedMove) {
        const mv = CONTENT.moves[this.selectedMove]!;
        // Only damaging moves: a status move's type changes nothing.
        const eff = mv.power ? typeMultiplier(CONTENT.typeChart, mv.type, s.types) : 1;
        if (eff !== 1) head.push(eff > 1 ? tag("good", t("{move} is super effective (×{eff})", { move: mv.name, eff })) : tag("bad", t("{move} is not very effective (×{eff})", { move: mv.name, eff })));
      }
      this.setInfo(head.filter(Boolean).join("\n"));
      return;
    }
    const lines = [
      `${tag(`${unit.side === "player" ? "ally" : "foe"}:${s.types[0]}`, s.name)} ${tag("dim", unit.side === "enemy" ? t("(foe)") : t("(yours)"))}  ${s.types.map((t) => tag(t, t)).join("/")}${s.role ? `  ${tag("special", s.role === "melee" ? t("Melee") : t("Ranged"))}` : ""}`,
      `HP ${tag(unit.hp / unit.maxHp > 0.5 ? "heal" : "dmg", `${unit.hp}/${unit.maxHp}`)}  ${statLine(unit.stats)}`,
      ...s.types.map((t) => `${tag(t, t)}: ${tag("dim", CONTENT.types[t]?.summary ?? "")}`),
      unit.ability ? `${tag("special", unit.ability.name)}: ${tag("dim", unit.ability.description)}${unit.attackBoost ? tag("num", ` (+${unit.attackBoost} Atk)`) : ""}` : "",
      unit.statuses.length ? `${t("Status:")} ${unit.statuses.map((x) => `${tag("status", CONTENT.statuses[x.id]?.name ?? x.id)} (${x.turnsLeft})`).join(", ")}` : "",
      this.engagementLine(unit),
      this.comboLine(unit),
      ...unit.moves.filter((m) => m !== "struggle").map((m) => {
        const mv = CONTENT.moves[m]!;
        const shape = mv.shape.kind === "single" ? "" : mv.shape.kind === "burst" ? t(", area {n}", { n: mv.shape.radius }) : t(", line {n}", { n: mv.shape.length });
        return `· ${tag(mv.kind, mv.name)} ${tag(mv.type, mv.type)}${t(", range {min}-{max}", { min: moveRange(unit, mv, CONTENT).min, max: moveRange(unit, mv, CONTENT).max })}${shape}${mv.power ? t(", power {n}", { n: tag("dmg", mv.power) }) : ""}`;
      }),
    ];
    const active = this.state ? activeUnit(this.state) : null;
    if (active && active.side === "player" && unit.side === "enemy" && this.selectedMove) {
      const mv = CONTENT.moves[this.selectedMove]!;
      const eff = mv.power ? typeMultiplier(CONTENT.typeChart, mv.type, s.types) : 1;
      if (eff !== 1) lines.push(eff > 1 ? tag("good", t("{move} is super effective (×{eff})", { move: mv.name, eff })) : tag("bad", t("{move} is not very effective (×{eff})", { move: mv.name, eff })));
    }
    if (active && active.side === "player" && unit.side === "enemy" && this.selectedBall && this.state) {
      const ball = CONTENT.balls[this.selectedBall]!;
      const reason = captureUnavailableReason(this.state, CONTENT, active.id, this.selectedBall, unit.pos);
      lines.push(reason ? `${ball.name}: ${tag("bad", t(reason))}` : `${ball.name}: ${tag("good", t("{n}% to catch", { n: Math.round(captureChance(CONTENT, unit, this.selectedBall) * 100) }))} ${tag("dim", t("(ball is used up either way)"))}`);
    }
    if (unit.side === "player" && this.knockoutsOf(unit.id) > 0) lines.push(`${t("Knockouts:")} ${tag("ko", `${this.knockoutsOf(unit.id)}/${KNOCKOUTS_TO_DEATH}`)}`);
    // Compact: no type summaries, the moves on one line.
    const typeLines = new Set(s.types.map((t) => `${tag(t, t)}: ${tag("dim", CONTENT.types[t]?.summary ?? "")}`));
    const moveNames = unit.moves.filter((m) => m !== "struggle").map((m) => tag(CONTENT.moves[m]!.kind, CONTENT.moves[m]!.name)).join(", ");
    const compact = lines.filter((l) => l && !typeLines.has(l) && !l.startsWith("· "));
    compact.splice(Math.min(compact.length, 4), 0, `${t("Moves:")} ${moveNames}`);
    this.setInfo(lines.filter(Boolean).join("\n"), compact.join("\n"));
  }

  private knockoutsOf(uid: string): number {
    return session.game.roster.party.find((m) => m.uid === uid)?.knockouts ?? 0;
  }

  private terrainInfo(id: FreeTerrainId): string {
    switch (id) {
      case "bush": return t("Bush — walking costs 1.5×; blocks line of sight.");
      case "mud": return t("Mud — walking costs 2×.");
      case "rock": return t("Rock — blocks movement and line of sight.");
      case "water": return t("Water — walking costs 2× (fliers skim over).");
      default: return "";
    }
  }

  private previewUnit(id: string): BattleUnit {
    const enemy = this.scenario.enemies.find((e) => e.id === id);
    const member = this.party.find((m) => m.id === id);
    const speciesId = enemy?.speciesId ?? member!.speciesId;
    // Its real level, stats and moves (from progression), not the species' level-1 ones.
    const setup = enemy ?? member?.setup;
    const maxHp = setup?.maxHp ?? maxHpOf(CONTENT, speciesId);
    return {
      id, speciesId, side: enemy ? "enemy" : "player", maxHp, hp: Math.min(enemy?.hp ?? member?.hp ?? maxHp, maxHp),
      pos: enemy?.pos ?? { x: 0, y: 0 }, statuses: [], cooldowns: {}, usedUltimates: [], captured: false, level: setup?.level ?? 1,
      stats: setup?.stats ?? CONTENT.species[speciesId]!.stats, moves: setup?.moves ?? CONTENT.species[speciesId]!.moves, mods: { ...NO_MODIFIERS, ...setup?.mods },
      traits: unitTraits(CONTENT, CONTENT.species[speciesId]!.types),
      ability: CONTENT.abilities[CONTENT.species[speciesId]!.ability ?? ""] ?? null, attackBoost: 0, spirit: 0, sturdyUsed: false, furyTarget: null, furyStreak: 0, engagedWith: null,
    };
  }


  // ------------------------------------------------------------ input

  private inField(p: Point): boolean {
    return p.x >= 0 && p.y >= 0 && p.x <= this.scenario.field.width && p.y <= this.scenario.field.height;
  }

  /** The field point under the pointer, or null off the field. */
  private pointerPoint(p: Phaser.Input.Pointer): Point | null {
    const f = worldToField(p.worldX, p.worldY);
    return this.inField(f) ? f : null;
  }

  update(): void {
    if (!this.hoverDirty) return;
    this.hoverDirty = false;
    this.refreshOverlay();
    this.refreshInfo();
  }

  /** The deploy spot under a point, if any. */
  private spotAt(p: Point): Point | undefined {
    return this.scenario.deploymentZone.filter((z) => distance(z, p) <= SPOT_PICK).sort((a, b) => distance(a, p) - distance(b, p))[0];
  }

  /** Whether a tap here acts (walk there, use the selected move or ball); otherwise it just inspects. */
  private isActionPoint(t: Point): boolean {
    if (this.phase !== "battle" || this.busy || !this.state || !this.isPlayerTurn()) return false;
    const unit = activeUnit(this.state)!;
    if (this.selectedBall) {
      const foe = freeUnitAt(this.state, t);
      return !!foe && captureTargets(this.state, CONTENT, unit.id, this.selectedBall).some((p) => samePoint(p, foe.pos));
    }
    if (this.selectedMove) return freeAim(this.state, CONTENT, unit.id, this.selectedMove, t).ok;
    return (this.reach ?? freeReachFor(this.state, unit.id)).costTo(t) !== null;
  }

  /** A pulsing ring under the Pokémon whose turn it is, so new players see who acts. */
  private markActive(): void {
    const unit = this.phase === "battle" && this.state && !this.busy ? activeUnit(this.state) : null;
    if (!unit || unit.side !== "player") {
      this.activeRing?.setVisible(false);
      return;
    }
    if (!this.activeRing) {
      this.activeRing = this.add.circle(0, 0, UNIT_RADIUS * S + 5).setStrokeStyle(3, 0xf5d76e).setDepth(1);
      this.tweens.add({ targets: this.activeRing, alpha: { from: 1, to: 0.35 }, duration: 600, yoyo: true, repeat: -1 });
    }
    const c = fieldToWorld(unit.pos);
    this.activeRing.setPosition(c.x, c.y).setVisible(true);
  }

  private onTileClicked(t: Point): void {
    this.hovered = t;
    if (this.phase === "deploy") return this.onDeployClick(t);
    if (this.phase !== "battle" || this.busy || !this.isPlayerTurn()) return;
    const state = this.state!;
    const unit = activeUnit(state)!;
    if (this.selectedBall) {
      const ballId = this.selectedBall;
      const foe = freeUnitAt(state, t);
      if (foe && captureTargets(state, CONTENT, unit.id, ballId).some((p) => samePoint(p, foe.pos))) {
        this.selectedBall = null;
        void this.perform({ type: "throwBall", unitId: unit.id, ballId, target: foe.pos });
      } else {
        this.cancelSelection();
      }
      return;
    }
    if (this.selectedMove) {
      if (freeAim(state, CONTENT, unit.id, this.selectedMove, t).ok) {
        const moveId = this.selectedMove;
        this.selectedMove = null;
        void this.perform({ type: "useMove", unitId: unit.id, moveId, target: t });
      } else {
        this.cancelSelection();
      }
      return;
    }
    const other = freeUnitAt(state, t);
    if (other && switchTargets(state).includes(other.id)) {
      void this.perform({ type: "switchUnit", unitId: unit.id, to: other.id });
      return;
    }
    if ((this.reach ?? freeReachFor(state, unit.id)).costTo(t) !== null) {
      void this.perform({ type: "move", unitId: unit.id, to: t });
    } else {
      this.refreshInfo();
    }
  }

  private onDeployClick(t: Point): void {
    const near = (p: Point) => distance(p, t) <= SPOT_PICK;
    const existing = this.placements.find((p) => near(p.pos));
    if (existing) {
      this.placements = this.placements.filter((p) => p !== existing);
      this.units.get(existing.unitId)?.container.destroy();
      this.units.delete(existing.unitId);
      this.selectedCandidate = existing.unitId;
      return this.refreshAll();
    }
    const id = this.selectedCandidate;
    const spot = this.spotAt(t);
    if (!id || !spot) return;
    const without = this.placements.filter((p) => p.unitId !== id);
    if (without.length >= (this.scenario.maxDeploy ?? MAX_ACTIVE_UNITS)) return;
    this.placements = [...without, { unitId: id, pos: spot }];
    this.units.get(id)?.container.destroy();
    this.createUnitView(id, this.party.find((m) => m.id === id)!.speciesId, "player", spot);
    // Auto-advance to the next unplaced, healthy party member for quick deployment.
    this.selectedCandidate = this.party.find((m) => m.hp > 0 && !this.placements.some((p) => p.unitId === m.id))?.id ?? null;
    this.refreshAll();
  }

  private cancelSelection(): void {
    this.selectedMove = null;
    this.selectedBall = null;
    this.refreshAll();
  }

  private isPlayerTurn(): boolean {
    const u = this.state ? activeUnit(this.state) : null;
    return u?.side === "player";
  }

  // ------------------------------------------------------------ flow

  /**
   * Replays a recorded battle filling the screen, slowed down, then hands over to the next recording.
   * The scene runs under the title screen, which dims it.
   */
  private async playDemo(demo: DemoBattle): Promise<void> {
    // isActive() is still false while create() runs: a stop (shutdown) ends the replay instead.
    const run = ++this.demoRun;
    this.events.once("shutdown", () => run === this.demoRun && this.demoRun++);
    const live = () => run === this.demoRun;
    silence(this);
    this.drawBoard();
    this.overlay = this.add.graphics();
    this.logStrip = new RichText(this, -2000, -2000, 10, 11).setVisible(false);
    const board = this.boardPx();
    const cam = this.cameras.main;
    cam.setZoom(Math.max(this.scale.width / board.w, this.scale.height / board.h));
    cam.centerOn(BOARD_X + board.w / 2, BOARD_Y + board.h / 2);
    this.state = createBattle(CONTENT, demo.field, demo.units, { seed: demo.seed }).state;
    this.phase = "battle";
    for (const u of this.state.units) this.createUnitView(u.id, u.speciesId, u.side, u.pos);
    this.syncUnits();
    cam.fadeIn(800);
    for (const action of demo.actions) {
      if (!live() || this.state.outcome !== "ongoing") break;
      await this.wait(DEMO_STEP_MS);
      const { state, events } = applyAction(this.state, CONTENT, action);
      this.state = state;
      await this.playEvents(events);
      if (!live()) return;
    }
    await this.wait(2000);
    if (!live()) return;
    cam.fadeOut(800);
    await this.wait(900);
    if (live()) this.events.emit("demoOver");
  }

  private startBattle(): void {
    const { state, events } = lockDeployment(CONTENT, this.scenario, this.party, this.placements, {
      captureAllowed: this.scenario.captureAllowed ?? false,
      balls: session.game.inventory.balls,
      seed: Date.now() >>> 0,
      bond: { player: teamBond(CONTENT, PROGRESSION, this.placements.map((p) => session.game.roster.party.find((m) => m.uid === p.unitId)!), session.game.world.meal?.bond ?? {}) },
      playerModifiers: combineModifiers(fatigueModifiers(fatigueLevel(WORLD_CONTENT.fatigue, session.game.world.fatigue)), session.game.world.meal?.mods ?? {}),
    });
    this.state = state;
    this.phase = "battle";
    const leader = this.scenario.enemies[0];
    if (leader) playCry(this, leader.speciesId);
    void this.playEvents(events).then(() => this.continueFlow());
  }

  private playerEndTurn(): void {
    if (this.phase !== "battle" || this.busy || !this.isPlayerTurn()) return;
    this.selectedMove = null;
    this.selectedBall = null;
    this.confirmRetreat = false;
    void this.perform({ type: "endTurn", unitId: activeUnit(this.state!)!.id });
  }

  private playerRetreat(): void {
    if (this.phase !== "battle" || this.busy || !this.isPlayerTurn()) return;
    void this.perform({ type: "retreat", unitId: activeUnit(this.state!)!.id });
  }

  private async perform(action: BattleAction): Promise<void> {
    this.busy = true;
    this.refreshAll();
    const { state, events } = applyAction(this.state!, CONTENT, action);
    this.state = state;
    await this.playEvents(events);
    this.busy = false;
    await this.continueFlow();
    // Nothing left to do this turn (no walk, no usable move or ball): the turn passes on its own after a beat.
    if (action.type !== "endTurn" && this.turnSpent()) {
      await this.wait(AUTO_END_MS);
      if (this.turnSpent() && activeUnit(this.state!)?.id === action.unitId) this.playerEndTurn();
    }
  }

  /** The player's active Pokémon has acted and has nothing left: no walk, no usable move, no ball to throw. */
  private turnSpent(): boolean {
    const state = this.state;
    if (!state || this.phase !== "battle" || this.busy || state.outcome !== "ongoing" || !this.isPlayerTurn() || tipOpen(this)) return false;
    const turn = state.turn!;
    if (turn.fresh || turn.movePointsLeft >= MIN_STEP) return false;
    const unit = activeUnit(state)!;
    // Too little movement left to walk, so a move only counts while something is already in its reach.
    if (unit.moves.some((m) => !moveUnavailableReason(state, CONTENT, unit.id, m) && freeHasTarget(state, CONTENT, unit.id, m))) return false;
    return turn.actionUsed || !state.captureAllowed || !Object.keys(state.balls).some((b) => (state.balls[b] ?? 0) > 0 && captureTargets(state, CONTENT, unit.id, b).length > 0);
  }

  /** Runs enemy turns until it is the player's turn again or the battle ends. */
  private async continueFlow(): Promise<void> {
    while (this.state && this.state.outcome === "ongoing" && !this.isPlayerTurn()) {
      this.busy = true;
      this.refreshAll();
      for (const action of planTurn(this.state, CONTENT, AI_LEVELS[currentWorld().ai ?? "normal"])) {
        if (this.state.outcome !== "ongoing") break;
        await this.wait(AI_STEP_MS);
        const { state, events } = applyAction(this.state, CONTENT, action);
        this.state = state;
        await this.playEvents(events);
      }
    }
    this.busy = false;
    if (this.state && this.state.outcome !== "ongoing" && this.phase !== "over") {
      this.phase = "over";
      // Knockouts, deaths, captures and used balls become permanent here, and are autosaved.
      const result = resolveBattle(CONTENT, PROGRESSION, session.game, this.state, { countsKnockouts: this.scenario.countsKnockouts ?? true });
      let game = result.game;
      const evBefore = session.game.ev ?? 0;
      if (this.state.outcome === "victory" && this.encounterId) {
        game = { ...game, world: removeEncounter(game.world, this.encounterId) };
        // Small chance of finding a Poké Ball after a won wild battle.
        const roll = nextRandom(game.world.rngState);
        game = { ...game, world: { ...game.world, rngState: roll.state } };
        if (roll.value < 0.15) {
          game = { ...game, inventory: { ...game.inventory, balls: { ...game.inventory.balls, "poke-ball": (game.inventory.balls["poke-ball"] ?? 0) + 1 } } };
          this.rewardText = t("Found a Poké Ball after the battle!");
        }
        // Foraging: the area's food is found after a won wild battle.
        const forage = this.biome ? WORLD_CONTENT.biomes[this.biome]?.forage : undefined;
        if (forage) {
          const items = { ...game.inventory.items };
          for (const [id, n] of Object.entries(forage)) items[id] = (items[id] ?? 0) + n;
          game = { ...game, inventory: { ...game.inventory, items } };
          const found = Object.entries(forage).map(([id, n]) => `${n} ${PROGRESSION.items[id]?.name ?? id}`).join(", ");
          this.rewardText = [this.rewardText, t("Foraged {items}.", { items: found })].filter(Boolean).join(" ");
        }
        // Loot: at most one of the area's items turns up.
        const loot = rollLoot((this.biome ? WORLD_CONTENT.biomes[this.biome]?.loot : undefined) ?? [], game.world.rngState);
        game = { ...game, world: { ...game.world, rngState: loot.rngState } };
        if (loot.item) {
          game = { ...game, inventory: { ...game.inventory, items: { ...game.inventory.items, [loot.item]: (game.inventory.items[loot.item] ?? 0) + 1 } } };
          this.rewardText = [this.rewardText, t("Found {item}!", { item: PROGRESSION.items[loot.item]?.name ?? loot.item })].filter(Boolean).join(" ");
        }
      }
      // Trainers, leaders and story battles: their reward and flag on a win; the Elite Four resets on a loss.
      const npcs = this.npcMapId ? WORLDS[this.npcMapId]?.npcs ?? [] : [];
      const npc = npcs.find((n) => n.id === this.npcId);
      if (npc && this.state.outcome === "victory") {
        const granted = grantGifts(completeNpc(game, npc, undefined, PROGRESSION.rules.ev), npc.reward);
        game = granted.game;
        // The prize joins the battle's money in the summary, instead of a second, different amount.
        this.prizeMoney = npc.reward?.money ?? 0;
        const prizeNote = this.prizeMoney ? `+₽${this.prizeMoney}.` : null;
        this.rewardText = [t("{name} is defeated!", { name: npc.name }), ...granted.notes.filter((n) => n !== prizeNote)].join(" ");
      } else if (npc) game = failNpc(game, npc, npcs);
      if (this.state.outcome === "retreated" && this.encounterId) game = { ...game, world: calmEncounter(game.world, this.encounterId) };
      if (this.state.outcome === "defeat") game = { ...game, world: returnToLastCamp(WORLD_CONTENT, currentWorld(), game.world) };
      this.evGained = (game.ev ?? 0) - evBefore;
      session.update(game);
      this.summary = result.summary;
      // The victory jingle replaces the battle theme; a loss falls silent under the defeat sting.
      if (this.state.outcome === "victory") playMusic(this, "victory");
      else {
        stopMusic();
        sfx(this, "defeat");
      }
      if (Object.values(result.summary.progress).some((evs) => evs.some((ev) => ev.type === "levelUp"))) this.time.delayedCall(700, () => sfx(this, "levelUp"));
    }
    this.refreshAll();
  }

  // ------------------------------------------------------------ event playback

  /** Queues the one-time tips this batch of events calls for (shown once the player has the turn). */
  private noteTips(events: readonly BattleEvent[]): void {
    const state = this.state!;
    const mine = (id: string) => state.units.some((u) => u.id === id && u.side === "player");
    for (const e of events) {
      if (e.type === "engaged" && (mine(e.unitId) || mine(e.targetId))) queueTip(this, "engage");
      else if (e.type === "displaced" && e.blocked) queueTip(this, "collision");
      else if (e.type === "damaged" && e.source === "move" && e.effectiveness !== undefined && e.effectiveness !== 1) queueTip(this, "types");
      else if (e.type === "hazardCreated" || e.type === "strikePrepared") queueTip(this, "zones");
      else if (e.type === "fainted" && mine(e.unitId) && (this.scenario.countsKnockouts ?? true)) queueTip(this, "knockout");
    }
  }

  /** On the player's turn: the turn basics, catching when a foe can be caught, then any queued tip. */
  private showTips(): void {
    if (this.demo || this.busy || !this.state) return;
    if (this.phase === "battle" && this.isPlayerTurn()) {
      queueTip(this, "battle");
      const unit = activeUnit(this.state)!;
      if (this.state.captureAllowed && Object.keys(this.state.balls).some((b) => captureTargets(this.state!, CONTENT, unit.id, b).length > 0)) queueTip(this, "capture");
    } else if (this.phase !== "over") return;
    flushTips(this);
  }

  private async playEvents(events: readonly BattleEvent[]): Promise<void> {
    const state = this.state!;
    const ctx = {
      name: (id: string) => {
        const u = unitById(state, id);
        const name = CONTENT.species[u.speciesId]!.name;
        return u.side === "enemy" ? t("Foe {name}", { name }) : name;
      },
      isPlayer: (id: string) => unitById(state, id).side === "player",
      typeOf: (id: string) => {
        const u = unitById(state, id);
        return CONTENT.species[u.speciesId]!.types[0]!;
      },
      moveName: (id: string) => CONTENT.moves[id]!.name,
      statusName: (id: string) => CONTENT.statuses[id]?.name ?? id,
      ballName: (id: string) => CONTENT.balls[id]?.name ?? id,
      abilityName: (id: string) => CONTENT.abilities[id]?.name ?? id,
      comboName: (id: string) => CONTENT.rules.combos[id]?.name ?? id,
      bondName: CONTENT.terms.bond,
    };
    this.noteTips(events);
    for (const e of events) {
      const entry = formatEvent(e, ctx);
      if (entry) this.pushLog(entry);
      switch (e.type) {
        case "moved":
          await this.settle();
          await this.tweenPath(e.unitId, e.path);
          break;
        case "moveUsed": {
          // Face the target and lunge towards it.
          const view = this.units.get(e.unitId);
          if (view) {
            await this.settle();
            const to = fieldToWorld(e.target);
            const dx = to.x - view.container.x;
            const dy = to.y - view.container.y;
            if (dx || dy) {
              this.animate(e.unitId, "idle", facingFor(dx, dy));
              const len = Math.hypot(dx, dy);
              await new Promise<void>((resolve) => this.tweens.add({
                targets: view.container, x: view.container.x + (dx / len) * 8, y: view.container.y + (dy / len) * 8,
                duration: 90, yoyo: true, onComplete: () => resolve(),
              }));
            }
            // The move's effect, styled by its type, on everyone it touches (or the aimed spot).
            const hit = e.affected.map((id) => this.state?.units.find((u) => u.id === id)).filter((u) => u !== undefined).map((u) => fieldToWorld(u.pos));
            const move = CONTENT.moves[e.moveId];
            if (move) await playMoveFx(this, move, { x: view.container.x, y: view.container.y }, hit.length ? hit : [fieldToWorld(e.target)]);
          }
          break;
        }
        case "damaged": {
          this.flinch(e.unitId);
          sfx(this, e.source === "status" ? "status" : e.effectiveness && e.effectiveness > 1 ? "superHit" : e.effectiveness && e.effectiveness < 1 ? "weakHit" : "hit");
          const eff = e.effectiveness && e.effectiveness !== 1 ? (e.effectiveness > 1 ? " !" : " ↓") : "";
          this.floatText(e.unitId, `-${e.amount}${eff}`, e.source === "status" ? "#c070ff" : "#ff6b6b");
          this.setHpBar(e.unitId, e.hp, unitById(this.state!, e.unitId).maxHp);
          await this.wait(220);
          break;
        }
        case "healed":
          sfx(this, "heal");
          this.floatText(e.unitId, `+${e.amount}`, "#7ed321");
          this.setHpBar(e.unitId, e.hp, unitById(this.state!, e.unitId).maxHp);
          break;
        case "displaced":
          if (e.engage) await this.tweenPath(e.unitId, [e.to]);
          else await this.shove(e.unitId, e.to);
          if (e.blocked) this.cameras.main.shake(120, 0.004);
          break;
        case "engaged":
          this.faceEachOther(e.unitId, e.targetId);
          break;
        case "statusApplied":
          this.floatText(e.unitId, e.status === "pumped" ? t("Pumped!") : CONTENT.statuses[e.status]?.name ?? e.status, e.status === "pumped" ? "#f5d76e" : "#c070ff");
          this.syncUnits(false);
          break;
        case "statusResisted":
          this.floatText(e.unitId, t("Resisted"), "#e8ecf4");
          break;
        case "critical":
          this.floatText(e.targetId, t("Critical!"), "#f5d76e");
          this.cameras.main.shake(100, 0.003);
          break;
        case "terrainChanged":
          this.drawBoard();
          break;
        case "hazardCreated":
        case "hazardExpired":
          // Mud is real terrain while it lasts; fire and poison are drawn with the overlay.
          if ((e.type === "hazardCreated" ? e.hazard.kind : e.kind) === "mud") this.drawBoard();
          this.refreshOverlay();
          break;
        case "strikePrepared":
          this.floatText(e.unitId, e.timing === "delayed" ? t("Charging…") : t("On watch"), "#f5d76e");
          this.refreshOverlay();
          break;
        case "watchTriggered":
          this.floatText(e.unitId, "!", "#f5d76e");
          break;
        case "captured":
          sfx(this, "capture");
          playCry(this, unitById(this.state!, e.unitId).speciesId);
          await this.fadeOut(e.unitId);
          break;
        case "fainted":
          playCry(this, unitById(this.state!, e.unitId).speciesId, 0.75);
          await this.fadeOut(e.unitId);
          break;
        default:
          break;
      }
    }
    this.syncUnits();
  }

  private pushLog(entry: LogEntry): void {
    this.log.push(entry);
    if (this.log.length > 500) this.log.shift();
    this.logStrip.setMarkup(this.log.slice(-4).map((l) => this.fitLine(l.text, 64)).join("\n"));
    if (this.logOverlay) this.renderLogOverlay();
  }

  private toggleLogOverlay(): void {
    if (this.logOverlay) {
      this.logOverlay.destroy();
      this.logOverlay = null;
      this.logBody = null;
      return;
    }
    this.logScroll = 0;
    this.logOpenedAt = this.time.now;
    this.renderLogOverlay();
  }

  /** Scrolls the open log by pixels (positive: back in time). */
  private scrollLog(dy: number): void {
    if (!this.logOverlay) return;
    this.logScroll += dy;
    this.layoutLogBody();
  }

  /**
   * Places the open log's lines for the current scroll: only the lines in view (plus one) are built, and only
   * when the scroll crosses a line; in between they just slide, so dragging is smooth on a phone.
   */
  private layoutLogBody(): void {
    if (!this.logOverlay) return;
    const { w, h } = this.boardPx();
    const visible = Math.floor((h - 40) / LOG_LINE_H);
    const maxScroll = Math.max(0, this.log.length - visible) * LOG_LINE_H;
    this.logScroll = Phaser.Math.Clamp(this.logScroll, 0, maxScroll);
    const first = Math.floor(this.logScroll / LOG_LINE_H);
    if (this.logBody?.first !== first) {
      this.logBody?.rich.destroy();
      const end = this.log.length - first;
      const lines = this.log.slice(Math.max(0, end - visible - 1), end);
      const rich = new RichText(this, 10, 0, w - 20, 12, LOG_COLORS.info, LOG_LINE_H);
      rich.setMarkup(lines.map((l) => this.fitLine(l.text, 76)).join("\n"));
      // Behind the title and bottom bands, which hide the half lines at the edges.
      this.logOverlay.addAt(rich, 1);
      this.logBody = { rich, first };
    }
    const shown = Math.min(this.log.length - first, visible + 1);
    this.logBody.rich.y = 32 + (visible - shown) * LOG_LINE_H + (this.logScroll - first * LOG_LINE_H);
  }

  /** Full scrollable history drawn over the board; newest at the bottom, wheel or drag scrolls back. */
  private renderLogOverlay(): void {
    this.logOverlay?.destroy();
    this.logBody = null;
    const { w, h } = this.boardPx();
    const visible = Math.floor((h - 40) / LOG_LINE_H);
    const bg = this.add.rectangle(0, 0, w, h, 0x0b0e14, 0.94).setOrigin(0).setStrokeStyle(1, 0x5a6785).setInteractive();
    bg.on("pointerup", () => {
      // Ignore the finger lifting from the tap that opened the log.
      if (!this.logDragged && this.time.now - this.logOpenedAt > 300) this.toggleLogOverlay();
      this.logDragged = false;
    });
    const title = this.add.text(10, 8, t("Combat log ({n})  ·  scroll or drag  ·  tap or L to close", { n: this.log.length }), {
      fontFamily: FONT, fontSize: px(12), color: "#f5d76e",
    });
    const top = this.add.rectangle(1, 1, w - 2, 30, 0x0b0e14).setOrigin(0);
    const bottomY = 32 + visible * LOG_LINE_H;
    const bottom = this.add.rectangle(1, bottomY, w - 2, h - bottomY - 1, 0x0b0e14).setOrigin(0);
    this.logOverlay = this.add.container(BOARD_X, BOARD_Y, [bg, top, title, bottom]).setDepth(10);
    this.layoutLogBody();
  }

  /** Keeps a log line on one row: long lines lose their colours and get an ellipsis. */
  private fitLine(markup: string, maxChars: number): string {
    const plain = stripMarkup(markup);
    return plain.length <= maxChars ? markup : `${plain.slice(0, maxChars - 1)}…`;
  }

  private tweenPath(unitId: string, path: readonly Point[]): Promise<void> {
    const view = this.units.get(unitId);
    if (!view || path.length === 0) return Promise.resolve();
    return (async () => {
      for (const p of path) {
        const to = fieldToWorld(p);
        const dx = to.x - view.container.x;
        const dy = to.y - view.container.y;
        this.animate(unitId, "walk", facingFor(dx, dy));
        // About 320 ms per hex width: a walk, not a dash.
        const duration = Math.max(120, (Math.hypot(dx, dy) / S) * 320);
        await new Promise<void>((resolve) => this.tweens.add({ targets: view.container, ...to, duration, onComplete: () => resolve() }));
      }
      this.animate(unitId, "idle");
    })();
  }

  /** A knockback: slid there quickly, without walking. */
  private shove(unitId: string, to: Point): Promise<void> {
    const view = this.units.get(unitId);
    if (!view) return Promise.resolve();
    const p = fieldToWorld(to);
    return new Promise((resolve) => this.tweens.add({ targets: view.container, ...p, duration: 220, ease: "Cubic.easeOut", onComplete: () => resolve() }));
  }

  /** An engaged pair turns to face each other. */
  private faceEachOther(a: string, b: string): void {
    const va = this.units.get(a), vb = this.units.get(b);
    if (!va || !vb) return;
    const dx = vb.container.x - va.container.x, dy = vb.container.y - va.container.y;
    this.animate(a, "idle", facingFor(dx, dy));
    this.animate(b, "idle", facingFor(-dx, -dy));
  }

  private fadeOut(unitId: string): Promise<void> {
    const view = this.units.get(unitId);
    if (!view) return Promise.resolve();
    return new Promise((resolve) =>
      this.tweens.add({ targets: view.container, alpha: 0, scale: 0.4 * UNIT_SCALE, duration: 300, onComplete: () => resolve() }),
    );
  }

  private floatText(unitId: string, s: string, color: string): void {
    const view = this.units.get(unitId);
    if (!view) return;
    const t = this.add
      .text(view.container.x, view.container.y - 24, s, { fontFamily: FONT, fontSize: "16px", color, fontStyle: "bold" })
      .setOrigin(0.5)
      .setStroke("#000000", 3);
    this.tweens.add({ targets: t, y: t.y - 24, alpha: 0, duration: 900, onComplete: () => t.destroy() });
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
