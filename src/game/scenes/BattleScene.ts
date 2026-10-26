import Phaser from "phaser";
import { playMoveFx } from "../moveFx";
import { playMusic, stopMusic } from "../music";
import { CONTENT, SCENARIOS, type ScenarioDef } from "../../content";
import { captureChance, captureTargets, captureUnavailableReason } from "../../core/capture";
import { KNOCKOUTS_TO_DEATH, resolveBattle, type BattleSummary } from "../../core/party";
import { currentWorld, session } from "../session";
import { PROGRESSION, WORLD_CONTENT, WORLDS } from "../../content";
import { fatigueLevel, fatigueModifiers, removeEncounter, returnToLastCamp, rollLoot } from "../../core/expedition";
import { teamBond } from "../../core/progression";
import { nextRandom } from "../../core/rng";
import { AI_LEVELS, planTurn } from "../../core/ai";
import { playCry, sfx } from "../audio";
import { completeNpc, failNpc } from "../../core/story";
import { grantGifts } from "../storyFlow";
import {
  activeUnit,
  affectedUnits,
  moveArea,
  previewMove,
  type HitPreview,
  applyAction,
  switchTargets,
  partnerOf,
  MAX_ACTIVE_UNITS,
  comboSetup,
  deploymentErrors,
  lockDeployment,
  moveUnavailableReason,
  reachableFor,
  threatZone,
  createBattle,
  unitAt,
  maxHpOf,
  moveRange,
  unitTraits,
  unitById,
  validTargets,
  type BattleAction,
  type BattleEvent,
  type DeployCandidate,
  NO_MODIFIERS,
  bondCostFor,
  combineModifiers,
  type BattleState,
  type BattleUnit,
  type Placement,
} from "../../core/battle";
import { Grid, gridDistance, key, samePoint, type Point } from "../../core/grid";
import { typeMultiplier } from "../../core/rules/typeChart";
import { Button } from "../ui/Button";
import { formatEvent, type LogEntry, type LogTone } from "../ui/combatLog";
import { describeMove } from "../ui/describeMove";
import { statLine } from "../ui/describeEffects";
import { stripMarkup, tag } from "../ui/markup";
import { RichText } from "../ui/RichText";
import { t } from "../i18n";
import { animKey, FACE_LEFT, FACE_RIGHT, facingFor, hasSprite, portraitKey, type Facing, type SpriteAnim } from "../sprites";
import { BOARD_X, BOARD_Y, boardSize, COLORS, FONT, HEX_R, hexCorners, PANEL_X, PANEL_W, TILE, TYPE_COLORS, tileToWorld, UNIT_SCALE, worldToTile, px, PHONE } from "../ui/theme";

type Phase = "deploy" | "battle" | "over";

interface UnitView {
  container: Phaser.GameObjects.Container;
  hpBar: Phaser.GameObjects.Rectangle;
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
  private grid!: Grid;
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
  private armedFrame: Phaser.GameObjects.Polygon | null = null;
  private revealed = new Set<string>();
  private log: LogEntry[] = [];
  private logStrip!: RichText;
  private logOverlay: Phaser.GameObjects.Container | null = null;
  private logScroll = 0;
  /** Set while a touch drag scrolls the log, so lifting the finger does not close it. */
  private logDragged = false;
  private logOpenedAt = 0;

  private overlay!: Phaser.GameObjects.Graphics;
  private boardGfx: Phaser.GameObjects.Graphics | null = null;
  private units = new Map<string, UnitView>();
  private panel!: Phaser.GameObjects.Container;
  private infoText!: RichText;
  /** Where the info text starts: right under the panel's last button. */
  private infoY = 330;
  private header!: Phaser.GameObjects.Text;
  private orderStrip: Phaser.GameObjects.Container | null = null;
  private previewLabels: Phaser.GameObjects.Container | null = null;
  private lastPreview: readonly HitPreview[] = [];

  constructor() {
    super("Battle");
  }

  init(data: { scenarioId?: string; scenario?: ScenarioDef; encounterId?: string; biome?: string; npcId?: string; mapId?: string }): void {
    this.scenario = data.scenario ?? SCENARIOS[data.scenarioId!]!;
    this.npcId = data.npcId ?? null;
    this.npcMapId = data.mapId ?? null;
    this.encounterId = data.encounterId ?? null;
    this.biome = data.biome ?? null;
    this.rewardText = "";
    this.grid = Grid.fromAscii(this.scenario.mapRows);
    this.phase = "deploy";
    this.placements = [];
    this.party = session.partyCandidates();
    this.selectedCandidate = this.party.find((m) => m.hp > 0)?.id ?? null;
    this.selectedBall = null;
    this.summary = null;
    this.state = null;
    this.selectedMove = null;
    this.hoveredMove = null;
    this.busy = false;
    this.revealed = new Set();
    this.log = [];
    this.logOverlay = null;
    this.logScroll = 0;
    this.units = new Map();
    this.boardGfx = null;
    this.orderStrip = null;
    this.previewLabels = null;
  }

  create(): void {
    this.panelKey = "";
    playMusic(this, "battle");
    this.header = this.add.text(BOARD_X, 16, "", { fontFamily: FONT, fontSize: "20px", color: "#f5d76e" });
    this.add.text(BOARD_X, 44, this.scenario.name, { fontFamily: FONT, fontSize: px(13), color: COLORS.dim });
    this.drawBoard();
    this.overlay = this.add.graphics();
    this.panel = this.add.container(PANEL_X, 16);
    this.infoText = new RichText(this, PANEL_X, 330, PANEL_W, 12);

    const board = boardSize(this.grid.width, this.grid.height);
    this.logStrip = new RichText(this, BOARD_X, BOARD_Y + board.h + 4, 450, 11, COLORS.dim, 15);
    const logButton = new Button(this, BOARD_X + board.w - 110, BOARD_Y + board.h + 6, 110, 22, PHONE ? t("Full log") : t("Full log [L]"), () => this.toggleLogOverlay());
    logButton.setDepth(5);
    this.input.keyboard?.on("keydown-L", () => this.toggleLogOverlay());
    this.input.on("wheel", (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      if (!this.logOverlay) return;
      this.logScroll = Math.max(0, this.logScroll + Math.sign(dy) * 3);
      this.renderLogOverlay();
    });
    // Touch: drag up/down on the open log to scroll it.
    let dragY: number | null = null;
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => { dragY = this.logOverlay ? p.y : null; });
    this.input.on("pointerup", () => { dragY = null; });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!this.logOverlay || dragY === null || !p.isDown) return;
      const lines = Math.trunc((p.y - dragY) / 15);
      if (lines === 0) return;
      this.logDragged = true;
      dragY = p.y;
      this.logScroll = Math.max(0, this.logScroll + lines);
      this.renderLogOverlay();
    });

    for (const e of this.scenario.enemies) this.createUnitView(e.id, e.speciesId, "enemy", e.pos);

    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      // Redraw only when the pointer reaches another tile (touch drags fire many moves).
      const t = this.pointerTile(p);
      if (t === this.hovered || (t && this.hovered && samePoint(t, this.hovered))) return;
      this.hovered = t;
      this.refreshOverlay();
      this.refreshInfo();
    });
    this.input.on("pointerdown", (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      // Clicks on UI (buttons, the log overlay) never fall through to the board.
      if (over.length > 0) return;
      if (p.rightButtonDown()) return this.cancelSelection();
      const t = this.pointerTile(p);
      if (!t) return;
      // Touch has no hover: the first tap on an action tile previews it, a second tap confirms.
      if (p.wasTouch && this.isActionTile(t) && !(this.armed && samePoint(this.armed, t))) {
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
    this.input.keyboard?.on("keydown-SPACE", () => this.playerEndTurn());

    this.refreshAll();
  }

  // ------------------------------------------------------------ drawing

  private drawBoard(): void {
    this.boardGfx ??= this.add.graphics().setDepth(-1);
    const g = this.boardGfx.clear();
    for (let y = 0; y < this.grid.height; y++)
      for (let x = 0; x < this.grid.width; x++) {
        const id = this.grid.terrainAt({ x, y }).id as keyof typeof COLORS;
        const c = tileToWorld({ x, y });
        g.fillStyle(COLORS[id] as number, 1).fillPoints(hexCorners(c.x, c.y), true);
        g.lineStyle(1, COLORS.gridLine, 0.35).strokePoints(hexCorners(c.x, c.y), true);
        if (id === "grass") {
          g.fillStyle(0x3f8a45, 1);
          for (const [dx, dy] of [[-12, 8], [0, -4], [8, 10]] as const) g.fillTriangle(
            c.x + dx, c.y + dy, c.x + dx + 4, c.y + dy - 10, c.x + dx + 8, c.y + dy,
          );
        }
      }
  }

  private createUnitView(id: string, speciesId: string, side: "player" | "enemy", pos: Point): void {
    const species = CONTENT.species[speciesId]!;
    const { x, y } = tileToWorld(pos);
    const teamColor = side === "player" ? COLORS.player : COLORS.enemy;
    const ring = this.add.ellipse(0, 12, 38, 14, teamColor, 0.3).setStrokeStyle(2, teamColor);
    const body = this.add.circle(0, 0, 16, TYPE_COLORS[species.types[0]!] ?? 0x888888);
    const label = this.add
      .text(0, -1, species.name.slice(0, 2), { fontFamily: FONT, fontSize: "14px", color: "#10141c", fontStyle: "bold" })
      .setOrigin(0.5);
    const facing = side === "player" ? FACE_RIGHT : FACE_LEFT;
    const sprite = hasSprite(speciesId)
      ? this.add.sprite(0, 14, `${speciesId}-idle`).setOrigin(0.5, 0.82).setScale(1.25).play(animKey(speciesId, "idle", facing))
      : null;
    const hpBg = this.add.rectangle(-18, 21, 36, 4, 0x000000).setOrigin(0, 0.5);
    const hpBar = this.add.rectangle(-18, 21, 36, 4, 0x7ed321).setOrigin(0, 0.5);
    const container = this.add.container(x, y, [ring, ...(sprite ? [sprite] : []), body, label, hpBg, hpBar]).setScale(UNIT_SCALE);
    this.units.set(id, { container, hpBar, ring, body, label, sprite, speciesId, facing });
    this.applyDisguise(id);
  }

  /** Hidden enemies show as a grey "?" until revealed. */
  private applyDisguise(id: string): void {
    const view = this.units.get(id)!;
    const species = CONTENT.species[view.speciesId]!;
    const hidden = this.isHidden(id);
    view.body.setFillStyle(hidden ? 0x777777 : TYPE_COLORS[species.types[0]!] ?? 0x888888);
    view.label.setText(hidden ? "?" : species.name.slice(0, 2));
    const showSprite = Boolean(view.sprite) && !hidden;
    view.sprite?.setVisible(showSprite);
    view.body.setVisible(!showSprite);
    view.label.setVisible(!showSprite);
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

  private syncUnits(): void {
    for (const id of this.units.keys()) this.applyDisguise(id);
    if (!this.state) return;
    for (const u of this.state.units) {
      const view = this.units.get(u.id);
      if (!view) continue;
      let { x, y } = tileToWorld(u.pos);
      // Engaged Pokémon lean towards each other, so a duel is visible at a glance.
      const partner = u.engagedWith ? this.state.units.find((o) => o.id === u.engagedWith && o.hp > 0) : undefined;
      if (partner) {
        const to = tileToWorld(partner.pos);
        x += (to.x - x) * 0.22;
        y += (to.y - y) * 0.22;
      }
      view.container.setPosition(x, y).setVisible(u.hp > 0);
      const frac = u.hp / u.maxHp;
      view.hpBar.width = 36 * frac;
      view.hpBar.fillColor = frac > 0.5 ? 0x7ed321 : frac > 0.25 ? 0xf5a623 : 0xd0021b;
      const active = this.state.turn?.unitId === u.id;
      view.ring.setStrokeStyle(active ? 4 : 3, active ? COLORS.active : u.side === "player" ? COLORS.player : COLORS.enemy);
    }
  }

  /** Hover (or tap) a foe: where it can move next turn (orange) and what it can hit from there (red). */
  private drawThreat(): void {
    if (!this.hovered || this.selectedMove || this.selectedBall || this.hoveredMove || this.busy) return;
    const state = this.state ?? (this.phase === "deploy" ? this.deployPreviewState() : null);
    const foe = state ? unitAt(state, this.hovered) : undefined;
    if (!state || !foe || foe.side !== "enemy" || foe.hp <= 0 || this.isHidden(foe.id)) return;
    const { reach, strike } = threatZone(state, CONTENT, foe.id);
    // Near-solid colours, so the zone reads the same over any terrain.
    this.fillTiles(strike, COLORS.target, 0.55);
    this.fillTiles(reach, COLORS.engage, 0.85);
    // Outlines keep the zones readable over any terrain colour.
    this.outlineTiles([...reach, ...strike], COLORS.target);
    this.outlineTiles([...reach, foe.pos], COLORS.engage);
  }

  /** Draws the outer border of a group of hexes. */
  private outlineTiles(tiles: readonly Point[], color: number): void {
    const inside = new Set(tiles.map((p) => `${p.x},${p.y}`));
    this.overlay.lineStyle(2, color, 0.95);
    for (const p of tiles) {
      const c = tileToWorld(p);
      const cs = hexCorners(c.x, c.y);
      // Edge i joins corners i and i+1 and faces the neighbour whose centre is beyond its midpoint.
      for (let i = 0; i < 6; i++) {
        const a = cs[i]!, b = cs[(i + 1) % 6]!;
        const n = worldToTile(c.x + ((a.x + b.x) / 2 - c.x) * 2, c.y + ((a.y + b.y) / 2 - c.y) * 2, this.grid.width, this.grid.height);
        if (!n || !inside.has(`${n.x},${n.y}`)) this.overlay.lineBetween(a.x, a.y, b.x, b.y);
      }
    }
  }

  /** The battle as it would start with the current placements, for previews during deployment. */
  private deployPreviewState(): BattleState | null {
    try {
      const players = this.placements.map((p) => {
        const m = this.party.find((c) => c.id === p.unitId)!;
        return { ...m.setup, id: m.id, speciesId: m.speciesId, side: "player" as const, pos: p.pos, hp: m.hp };
      });
      return createBattle(CONTENT, this.scenario.mapRows, [...players, ...this.scenario.enemies], { seed: 1 }).state;
    } catch {
      return null;
    }
  }

  private fillTiles(tiles: readonly Point[], color: number, alpha: number): void {
    this.overlay.fillStyle(color, alpha);
    for (const p of tiles) {
      const c = tileToWorld(p);
      this.overlay.fillPoints(hexCorners(c.x, c.y, HEX_R - 1.5), true);
    }
  }

  private refreshOverlay(): void {
    this.overlay.clear();
    this.previewLabels?.destroy();
    this.previewLabels = null;
    if (this.phase === "deploy") {
      this.fillTiles(this.scenario.deploymentZone, COLORS.zone, 0.4);
    } else if (this.phase === "battle" && this.state && this.isPlayerTurn() && !this.busy) {
      const unit = activeUnit(this.state)!;
      if (this.selectedBall) {
        this.fillTiles(captureTargets(this.state, CONTENT, unit.id, this.selectedBall), COLORS.active, 0.35);
      } else if (this.selectedMove) {
        const move = CONTENT.moves[this.selectedMove]!;
        const targets = validTargets(this.state, CONTENT, unit.id, this.selectedMove);
        // Aim tiles: red for single-target moves, violet for area moves (they hit everything in the shape).
        const isArea = move.shape.kind !== "single";
        this.fillTiles(targets, isArea ? COLORS.areaAim : COLORS.target, 0.3);
        if (this.hovered && targets.some((t) => samePoint(t, this.hovered!))) {
          this.fillTiles(moveArea(this.state, move, unit, this.hovered), COLORS.area, 0.3);
          this.fillTiles(affectedUnits(this.state, move, unit, this.hovered).map((u) => u.pos), COLORS.area, 0.5);
          this.showPreview(previewMove(this.state, CONTENT, unit.id, this.selectedMove, this.hovered));
        }
      } else if (this.hoveredMove) {
        // Range preview: every tile the move could reach from here, whether or not a target stands there.
        const range = moveRange(unit, CONTENT.moves[this.hoveredMove]!);
        const inRange: Point[] = [];
        for (let y = 0; y < this.grid.height; y++)
          for (let x = 0; x < this.grid.width; x++) {
            const d = gridDistance({ x, y }, unit.pos);
            if (d >= range.min && d <= range.max) inRange.push({ x, y });
          }
        this.fillTiles(inRange, COLORS.target, 0.18);
      } else {
        const reach = reachableFor(this.state, unit.id);
        this.fillTiles(reach.destinations, COLORS.reach, 0.25);
        if (this.hovered && reach.destinations.some((p) => samePoint(p, this.hovered!))) this.previewEngagement(unit.id, this.hovered);
      }
    }
    this.drawThreat();
    if (this.phase === "battle" && this.state) this.drawCombatMarks();
    // Touch: the tapped action tile pulses in gold until it is tapped again (confirm).
    if (!this.armedFrame) {
      this.armedFrame = this.add.polygon(0, 0, hexCorners(0, 0, HEX_R - 3)).setOrigin(0).setStrokeStyle(4, 0xf5d76e).setDepth(20).setVisible(false);
      this.tweens.add({ targets: this.armedFrame, alpha: { from: 1, to: 0.25 }, duration: 350, yoyo: true, repeat: -1 });
    }
    this.armedFrame.setVisible(this.armed !== null);
    if (this.armed) {
      const c = tileToWorld(this.armed);
      this.armedFrame.setPosition(c.x, c.y);
    }
    if (this.hovered && this.grid.inBounds(this.hovered)) {
      const c = tileToWorld(this.hovered);
      this.overlay.lineStyle(2, 0xffffff, 0.8).strokePoints(hexCorners(c.x, c.y, HEX_R - 1.5), true);
    }
  }

  /**
   * Engaged pairs are joined by a line; on the player's turn, foes the active Pokémon would combo
   * (pinned by or carrying a status from an ally) get a gold corner mark.
   */
  private drawCombatMarks(): void {
    const state = this.state!;
    const centre = tileToWorld;
    this.overlay.lineStyle(3, COLORS.engage, 0.85);
    for (const u of state.units) {
      const partner = u.hp > 0 ? partnerOf(state, u) : null;
      if (!partner || u.id > partner.id || this.isHidden(u.id) || this.isHidden(partner.id)) continue;
      const a = centre(u.pos), b = centre(partner.pos);
      this.overlay.lineBetween(a.x, a.y, b.x, b.y);
    }
    if (!this.isPlayerTurn()) return;
    const active = activeUnit(state)!;
    this.overlay.fillStyle(COLORS.combo, 0.95);
    for (const foe of state.units) {
      if (foe.side === active.side || foe.hp <= 0 || this.isHidden(foe.id) || !comboSetup(state, active, foe)) continue;
      const c = tileToWorld(foe.pos);
      const x = c.x + TILE / 2 - 3, y = c.y - HEX_R / 2 - 4;
      this.overlay.fillTriangle(x, y, x - 12, y, x, y + 12);
    }
  }

  // ------------------------------------------------------------ panel

  private refreshAll(): void {
    this.armed = null;
    this.markActive();
    this.syncUnits();
    this.refreshPanel();
    this.refreshOverlay();
    this.refreshInfo();
  }

  /** Exact predicted damage above every Pokémon the hovered aim would hit. */
  /** "Engaged with Mankey": they may only attack each other, and stepping away draws a free attack. */
  private engagementLine(unit: BattleUnit): string {
    if (!this.state || unit.hp <= 0) return "";
    const partner = partnerOf(this.state, unit);
    if (!partner) return "";
    return `${t("{engaged} with {name}", { engaged: tag("bad", t("Engaged")), name: CONTENT.species[partner.speciesId]!.name })} ${tag("dim", unit.mods.disengage ? t("(only melee on each other; slips away freely)") : t("(only melee on each other; stepping away draws a free attack)"))}`;
  }

  /** "Set up for a combo": hitting this foe now gains Bond and triggers combo bonuses. */
  private comboLine(unit: BattleUnit): string {
    if (!this.state || unit.hp <= 0 || !this.isPlayerTurn()) return "";
    const active = activeUnit(this.state)!;
    const setup = unit.side !== active.side ? comboSetup(this.state, active, unit) : null;
    if (!setup) return "";
    return `${tag("good", t("Combo target"))} ${tag("dim", setup === "engaged" ? t("an ally has engaged it: hit it for +1 Bond and combo bonuses") : t("it carries an ally's status: hit it for +1 Bond and combo bonuses"))}`;
  }

  /** Hovering a destination: the free attacks the move would draw, shown like a damage preview. */
  private previewEngagement(unitId: string, to: Point): void {
    const { events } = applyAction(this.state!, CONTENT, { type: "move", unitId, to });
    if (!events.some((e) => e.type === "engagementStrike")) return;
    const damage = events.filter((e) => e.type === "damaged" && e.unitId === unitId).reduce((s, e) => s + (e as { amount: number }).amount, 0);
    const knockedOut = events.some((e) => e.type === "fainted" && e.unitId === unitId);
    this.showPreview([{ unitId, damage, healed: 0, knockedOut, statuses: [] }]);
    const strikes = events.filter((e) => e.type === "engagementStrike").length;
    const p = tileToWorld(to);
    this.previewLabels!.add(this.add.text(p.x, p.y - 22, strikes > 1 ? t("⚔ {n} free attacks", { n: strikes }) : t("⚔ {n} free attack", { n: strikes }), {
      fontFamily: FONT, fontSize: "12px", fontStyle: "bold", color: "#ff8080", backgroundColor: "#10141ccc", padding: { x: 3, y: 1 },
    }).setOrigin(0.5).setDepth(8));
  }

  private showPreview(hits: readonly HitPreview[]): void {
    const items = hits.flatMap((h) => {
      const view = this.units.get(h.unitId);
      if (!view) return [];
      const parts = [h.damage ? `-${h.damage}` : "", h.healed ? `+${h.healed}` : "", h.knockedOut ? "KO" : ""].filter(Boolean);
      if (!parts.length && !h.statuses.length) return [];
      const label = parts.length ? parts.join(" ") : h.statuses.join(", ");
      return [this.add.text(view.container.x, view.container.y - 30, label, {
        fontFamily: FONT, fontSize: "14px", fontStyle: "bold", color: h.knockedOut ? "#ff5050" : h.healed && !h.damage ? "#7ed321" : "#ffd27a",
        backgroundColor: "#10141ccc", padding: { x: 3, y: 1 },
      }).setOrigin(0.5).setDepth(8)];
    });
    this.previewLabels = this.add.container(0, 0, items);
    this.lastPreview = hits;
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
      if (this.textures.exists(portraitKey(u.speciesId)) && !this.isHidden(u.id)) items.push(this.add.image(x + 13, 23, portraitKey(u.speciesId)).setDisplaySize(22, 22));
      else items.push(this.add.text(x + 13, 23, "?", { fontFamily: FONT, fontSize: "14px", color: COLORS.text }).setOrigin(0.5));
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
    const button = (label: string, enabled: boolean, highlighted: boolean, onClick: () => void) => {
      const b = new Button(this, 0, y, PANEL_W, 26, label, onClick).setEnabled(enabled).setHighlighted(highlighted);
      this.panel.add(b);
      y += 30;
      return b;
    };

    if (this.phase === "deploy") {
      this.header.setText(t("Deployment"));
      text(t("Pick up to {n}: tap a card, then a blue tile. Tap a foe: its reach (orange) and attack range (red).", { n: this.scenario.maxDeploy ?? MAX_ACTIVE_UNITS }), COLORS.dim, 12);
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
      button(t("← Avoid this battle"), true, false, () => this.scene.start("Overworld", {}));
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
        if (sum.xp || sum.money) text(`${t("+{xp} XP for each Pokémon that fought (half for the rest of the party) · +₽{money}", { xp: sum.xp, money: sum.money })}${sum.candies ? t(" · +{n} Candy", { n: sum.candies }) : ""}`, "#f5d76e");
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
      return;
    }

    const unit = activeUnit(state);
    this.header.setText(t("Round {n}", { n: state.round }));
    this.renderTurnOrder(state);
    const bond = state.bond.player;
    text(`${CONTENT.terms.bond} ${"●".repeat(bond)}${"○".repeat(Math.max(0, state.bondMax.player - bond))} ${bond}/${state.bondMax.player}`, "#f5d76e", 13);
    if (unit && unit.side === "player" && !this.busy) {
      const species = CONTENT.species[unit.speciesId]!;
      text(t("{name} · move {n}", { name: species.name, n: state.turn!.movePointsLeft }), COLORS.good);
      // A short guide to what can be done now, for new players.
      if (!this.selectedMove && !this.selectedBall) text(t("Blue: move · pick a move to attack"), COLORS.dim, 11);
      if (switchTargets(state).length) text(t("Tap another of your Pokémon to act with it instead."), COLORS.dim, 11);
      // Basic attack and action are separate budgets: one of each per turn, in any order.
      // Struggle only shows while it is the unit's way to fight (engaged, ranged basic attack).
      const basics = unit.moves.filter((m) => CONTENT.moves[m]!.kind === "basic" && (m !== "struggle" || !moveUnavailableReason(state, CONTENT, unit.id, m)));
      const others = unit.moves.filter((m) => CONTENT.moves[m]!.kind !== "basic");
      const ordered = [...basics, ...others];
      for (const moveId of ordered) {
        if (moveId === basics[0]) text(state.turn!.basicUsed ? t("Basic attack · used (1 per turn)") : t("Basic attack · ready (1 per turn)"), state.turn!.basicUsed ? COLORS.dim : "#9fd3ff", 12);
        if (moveId === others[0]) text(state.turn!.actionUsed ? t("Action · used (1 per turn)") : t("Action · ready (1 per turn)"), state.turn!.actionUsed ? COLORS.dim : "#9fd3ff", 12);
        const move = CONTENT.moves[moveId]!;
        const reason = moveUnavailableReason(state, CONTENT, unit.id, moveId);
        const targets = reason ? [] : validTargets(state, CONTENT, unit.id, moveId);
        const cd = unit.cooldowns[moveId] ?? 0;
        const range = moveRange(unit, move);
        const used = move.kind === "basic" ? state.turn!.basicUsed : state.turn!.actionUsed;
        const status = cd > 0 ? t("wait {n}", { n: cd })
          : !used && !reason && targets.length === 0 ? t("no target {r}", { r: range.min === range.max ? range.max : `${range.min}-${range.max}` })
          : move.kind === "basic" ? t("basic")
          : move.kind === "special" ? t("special")
          : move.kind === "bond" ? `${CONTENT.terms.bond} ${bondCostFor(move, unit)}`
          : unit.usedUltimates.includes(moveId) ? t("ult used") : t("ult 1×");
        const ownBasic = basics.find((b) => b !== "struggle") ?? unit.moves.find((m) => m !== "struggle" && CONTENT.moves[m]!.kind === "basic");
        const power = moveId === "struggle" && ownBasic ? Math.round(CONTENT.moves[ownBasic]!.power * CONTENT.rules.engagement.fallbackPower) : move.power;
        button(`${move.name.padEnd(13)} ${power ? t("Power {n}", { n: String(power).padStart(2) }) : "        "}  ${status}`, targets.length > 0, this.selectedMove === moveId, () => {
          this.selectedBall = null;
          this.selectedMove = this.selectedMove === moveId ? null : moveId;
          this.refreshAll();
        }).onHover((over) => {
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
          const b = new Button(this, i * (w + 8), y, w, 26, `${CONTENT.balls[ballId]!.name.replace(" Ball", "")} ×${count}`, () => {
            this.selectedMove = null;
            this.selectedBall = this.selectedBall === ballId ? null : ballId;
            this.refreshAll();
          }).setEnabled(usable).setHighlighted(this.selectedBall === ballId);
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
        const reason = raw ? t(raw) : validTargets(this.state!, CONTENT, unit.id, this.hoveredMove).length === 0 ? t("no valid target from here") : null;
        if (reason) text += `\n\n${tag("bad", t("Not usable now: {reason}", { reason }))}`;
      }
      this.setInfo(text);
      return;
    }
    let unit: BattleUnit | undefined;
    if (this.hovered && this.grid.inBounds(this.hovered)) {
      if (this.state) unit = unitAt(this.state, this.hovered);
      else {
        const e = this.scenario.enemies.find((x) => samePoint(x.pos, this.hovered!));
        const pl = this.placements.find((x) => samePoint(x.pos, this.hovered!));
        const id = e?.id ?? pl?.unitId;
        if (id) unit = this.previewUnit(id);
      }
    }
    if (!unit) {
      const terrain = this.hovered && this.grid.inBounds(this.hovered) ? this.grid.terrainAt(this.hovered) : null;
      const terrainText = terrain ? this.terrainInfo(terrain.id) : "";
      // Without a hovered unit, show the selected move's rules (also covers touch screens).
      const moveText = this.selectedMove ? describeMove(CONTENT, CONTENT.moves[this.selectedMove]!) : "";
      this.infoText.setMarkup([moveText, terrainText].filter(Boolean).join("\n\n"));
      return;
    }
    if (unit.side === "enemy" && this.isHidden(unit.id)) {
      this.infoText.setMarkup(`${tag("enemy", t("??? Unknown Pokémon"))}\n${tag("dim", t("Its details are revealed once it acts or is hit."))}`);
      return;
    }
    const s = CONTENT.species[unit.speciesId]!;
    const lines = [
      `${tag(`${unit.side === "player" ? "ally" : "foe"}:${s.types[0]}`, s.name)} ${tag("dim", unit.side === "enemy" ? t("(foe)") : t("(yours)"))}  ${s.types.map((t) => tag(t, t)).join("/")}`,
      `HP ${tag(unit.hp / unit.maxHp > 0.5 ? "heal" : "dmg", `${unit.hp}/${unit.maxHp}`)}  ${statLine(unit.stats)}`,
      ...s.types.map((t) => `${tag(t, t)}: ${tag("dim", CONTENT.types[t]?.summary ?? "")}`),
      unit.ability ? `${tag("special", unit.ability.name)}: ${tag("dim", unit.ability.description)}${unit.attackBoost ? tag("num", ` (+${unit.attackBoost} Atk)`) : ""}` : "",
      unit.statuses.length ? `${t("Status:")} ${unit.statuses.map((x) => `${tag("status", CONTENT.statuses[x.id]?.name ?? x.id)} (${x.turnsLeft})`).join(", ")}` : "",
      this.engagementLine(unit),
      this.comboLine(unit),
      ...unit.moves.filter((m) => m !== "struggle").map((m) => {
        const mv = CONTENT.moves[m]!;
        const shape = mv.shape.kind === "single" ? "" : mv.shape.kind === "burst" ? t(", area {n}", { n: mv.shape.radius }) : t(", line {n}", { n: mv.shape.length });
        return `· ${tag(mv.kind, mv.name)} ${tag(mv.type, mv.type)}${t(", range {min}-{max}", { min: moveRange(unit, mv).min, max: moveRange(unit, mv).max })}${shape}${mv.power ? t(", power {n}", { n: tag("dmg", mv.power) }) : ""}`;
      }),
    ];
    const active = this.state ? activeUnit(this.state) : null;
    if (active && active.side === "player" && unit.side === "enemy" && this.selectedMove) {
      const mv = CONTENT.moves[this.selectedMove]!;
      const eff = typeMultiplier(CONTENT.typeChart, mv.type, s.types);
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

  private terrainInfo(id: string): string {
    switch (id) {
      case "grass": return t("Tall grass — units here can only be targeted from adjacent tiles.");
      case "mud": return t("Mud — costs 2 movement.");
      case "wall": return t("Rock — blocks movement and line of sight.");
      case "water": return t("Water — impassable.");
      default: return "";
    }
  }

  private previewUnit(id: string): BattleUnit {
    const enemy = this.scenario.enemies.find((e) => e.id === id);
    const member = this.party.find((m) => m.id === id);
    const speciesId = enemy?.speciesId ?? member!.speciesId;
    const maxHp = maxHpOf(CONTENT, speciesId);
    return {
      id, speciesId, side: enemy ? "enemy" : "player", maxHp, hp: member?.hp ?? maxHp,
      pos: enemy?.pos ?? { x: 0, y: 0 }, statuses: [], cooldowns: {}, usedUltimates: [], captured: false, level: 1, stats: CONTENT.species[speciesId]!.stats, moves: CONTENT.species[speciesId]!.moves, mods: NO_MODIFIERS,
      traits: unitTraits(CONTENT, CONTENT.species[speciesId]!.types),
      ability: CONTENT.abilities[CONTENT.species[speciesId]!.ability ?? ""] ?? null, attackBoost: 0, sturdyUsed: false, furyTarget: null, furyStreak: 0, engagedWith: null,
    };
  }

  private isHidden(id: string): boolean {
    return (this.scenario.hiddenEnemies ?? []).includes(id) && !this.revealed.has(id);
  }

  private displayName(u: BattleUnit): string {
    return u.side === "enemy" && this.isHidden(u.id) ? "???" : CONTENT.species[u.speciesId]!.name;
  }

  // ------------------------------------------------------------ input

  private pointerTile(p: Phaser.Input.Pointer): Point | null {
    return worldToTile(p.worldX, p.worldY, this.grid.width, this.grid.height);
  }

  /** Tiles where a tap acts (move there, use the selected move or ball); others just inspect. */
  private isActionTile(t: Point): boolean {
    if (this.phase !== "battle" || this.busy || !this.state || !this.isPlayerTurn()) return false;
    const unit = activeUnit(this.state)!;
    if (this.selectedBall) return captureTargets(this.state, CONTENT, unit.id, this.selectedBall).some((p) => samePoint(p, t));
    if (this.selectedMove) return validTargets(this.state, CONTENT, unit.id, this.selectedMove).some((p) => samePoint(p, t));
    return reachableFor(this.state, unit.id).destinations.some((p) => samePoint(p, t));
  }

  /** A pulsing ring under the Pokémon whose turn it is, so new players see who acts. */
  private markActive(): void {
    const unit = this.phase === "battle" && this.state && !this.busy ? activeUnit(this.state) : null;
    if (!unit || unit.side !== "player") {
      this.activeRing?.setVisible(false);
      return;
    }
    if (!this.activeRing) {
      this.activeRing = this.add.circle(0, 0, TILE / 2 - 2).setStrokeStyle(3, 0xf5d76e).setDepth(1);
      this.tweens.add({ targets: this.activeRing, alpha: { from: 1, to: 0.35 }, duration: 600, yoyo: true, repeat: -1 });
    }
    const c = tileToWorld(unit.pos);
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
      if (captureTargets(state, CONTENT, unit.id, ballId).some((p) => samePoint(p, t))) {
        this.selectedBall = null;
        void this.perform({ type: "throwBall", unitId: unit.id, ballId, target: t });
      } else {
        this.cancelSelection();
      }
      return;
    }
    if (this.selectedMove) {
      if (validTargets(state, CONTENT, unit.id, this.selectedMove).some((p) => samePoint(p, t))) {
        const moveId = this.selectedMove;
        this.selectedMove = null;
        void this.perform({ type: "useMove", unitId: unit.id, moveId, target: t });
      } else {
        this.cancelSelection();
      }
      return;
    }
    const other = unitAt(state, t);
    if (other && switchTargets(state).includes(other.id)) {
      void this.perform({ type: "switchUnit", unitId: unit.id, to: other.id });
      return;
    }
    if (reachableFor(state, unit.id).destinations.some((p) => samePoint(p, t))) {
      void this.perform({ type: "move", unitId: unit.id, to: t });
    } else {
      this.refreshInfo();
    }
  }

  private onDeployClick(t: Point): void {
    const existing = this.placements.find((p) => samePoint(p.pos, t));
    if (existing) {
      this.placements = this.placements.filter((p) => p !== existing);
      this.units.get(existing.unitId)?.container.destroy();
      this.units.delete(existing.unitId);
      this.selectedCandidate = existing.unitId;
      return this.refreshAll();
    }
    const id = this.selectedCandidate;
    if (!id || !this.scenario.deploymentZone.some((z) => samePoint(z, t))) return;
    const without = this.placements.filter((p) => p.unitId !== id);
    if (without.length >= (this.scenario.maxDeploy ?? MAX_ACTIVE_UNITS)) return;
    this.placements = [...without, { unitId: id, pos: t }];
    this.units.get(id)?.container.destroy();
    this.createUnitView(id, this.party.find((m) => m.id === id)!.speciesId, "player", t);
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
        const granted = grantGifts(completeNpc(game, npc), npc.reward);
        game = granted.game;
        this.rewardText = [t("{name} is defeated!", { name: npc.name }), ...granted.notes].join(" ");
      } else if (npc) game = failNpc(game, npc, npcs);
      if (this.state.outcome === "defeat") game = { ...game, world: returnToLastCamp(WORLD_CONTENT, currentWorld(), game.world) };
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

  private async playEvents(events: readonly BattleEvent[]): Promise<void> {
    const state = this.state!;
    const ctx = {
      name: (id: string) => {
        const u = unitById(state, id);
        return u.side === "enemy" ? t("Foe {name}", { name: this.displayName(u) }) : this.displayName(u);
      },
      isPlayer: (id: string) => unitById(state, id).side === "player",
      typeOf: (id: string) => {
        const u = unitById(state, id);
        return u.side === "enemy" && this.isHidden(u.id) ? null : CONTENT.species[u.speciesId]!.types[0]!;
      },
      moveName: (id: string) => CONTENT.moves[id]!.name,
      statusName: (id: string) => CONTENT.statuses[id]?.name ?? id,
      ballName: (id: string) => CONTENT.balls[id]?.name ?? id,
      abilityName: (id: string) => CONTENT.abilities[id]?.name ?? id,
      bondName: CONTENT.terms.bond,
    };
    for (const e of events) {
      if (e.type === "moveUsed") {
        this.revealed.add(e.unitId);
        e.affected.forEach((id) => this.revealed.add(id));
      }
      const entry = formatEvent(e, ctx);
      if (entry) this.pushLog(entry);
      switch (e.type) {
        case "moved":
          await this.tweenPath(e.unitId, e.path);
          break;
        case "moveUsed": {
          // Face the target and lunge towards it.
          const view = this.units.get(e.unitId);
          if (view) {
            const to = tileToWorld(e.target);
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
            // The move's effect, styled by its type, on everyone it touches (or the aimed hex).
            const hit = e.affected.map((id) => this.state?.units.find((u) => u.id === id)).filter((u) => u !== undefined).map((u) => tileToWorld(u.pos));
            const move = CONTENT.moves[e.moveId];
            if (move) await playMoveFx(this, move, { x: view.container.x, y: view.container.y }, hit.length ? hit : [tileToWorld(e.target)]);
          }
          break;
        }
        case "damaged": {
          this.flinch(e.unitId);
          sfx(this, e.source === "status" ? "status" : e.effectiveness && e.effectiveness > 1 ? "superHit" : e.effectiveness && e.effectiveness < 1 ? "weakHit" : "hit");
          const eff = e.effectiveness && e.effectiveness !== 1 ? (e.effectiveness > 1 ? " !" : " ↓") : "";
          this.floatText(e.unitId, `-${e.amount}${eff}`, e.source === "status" ? "#c070ff" : "#ff6b6b");
          this.syncUnits();
          await this.wait(220);
          break;
        }
        case "healed":
          sfx(this, "heal");
          this.floatText(e.unitId, `+${e.amount}`, "#7ed321");
          this.syncUnits();
          break;
        case "displaced":
          await this.tweenPath(e.unitId, [e.to]);
          if (e.blocked) this.cameras.main.shake(120, 0.004);
          break;
        case "statusApplied":
          this.floatText(e.unitId, e.status, "#c070ff");
          break;
        case "terrainChanged":
          this.grid = Grid.fromAscii(this.state!.mapRows);
          this.drawBoard();
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
      return;
    }
    this.logScroll = 0;
    this.logOpenedAt = this.time.now;
    this.renderLogOverlay();
  }

  /** Full scrollable history drawn over the board; newest at the bottom, wheel scrolls back. */
  private renderLogOverlay(): void {
    this.logOverlay?.destroy();
    const { w, h } = boardSize(this.grid.width, this.grid.height);
    const lineH = 15;
    const visible = Math.floor((h - 40) / lineH);
    const maxScroll = Math.max(0, this.log.length - visible);
    this.logScroll = Math.min(this.logScroll, maxScroll);
    const end = this.log.length - this.logScroll;
    const lines = this.log.slice(Math.max(0, end - visible), end);
    const bg = this.add.rectangle(0, 0, w, h, 0x0b0e14, 0.94).setOrigin(0).setStrokeStyle(1, 0x5a6785).setInteractive();
    bg.on("pointerup", () => {
      // Ignore the finger lifting from the tap that opened the log.
      if (!this.logDragged && this.time.now - this.logOpenedAt > 300) this.toggleLogOverlay();
      this.logDragged = false;
    });
    const title = this.add.text(10, 8, t("Combat log ({n})  ·  scroll or drag  ·  tap or L to close", { n: this.log.length }), {
      fontFamily: FONT, fontSize: px(12), color: "#f5d76e",
    });
    const body = new RichText(this, 10, 32, w - 20, 12, LOG_COLORS.info, lineH);
    body.setMarkup(lines.map((l) => this.fitLine(l.text, 76)).join("\n"));
    this.logOverlay = this.add.container(BOARD_X, BOARD_Y, [bg, title, body]).setDepth(10);
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
        const to = tileToWorld(p);
        this.animate(unitId, "walk", facingFor(to.x - view.container.x, to.y - view.container.y));
        await new Promise<void>((resolve) => this.tweens.add({ targets: view.container, ...to, duration: 110, onComplete: () => resolve() }));
      }
      this.animate(unitId, "idle");
    })();
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

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => this.time.delayedCall(ms, resolve));
  }
}
