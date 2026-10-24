import Phaser from "phaser";
import { CONTENT, SCENARIOS, type ScenarioDef } from "../../content";
import { captureChance, captureTargets, captureUnavailableReason } from "../../core/capture";
import { KNOCKOUTS_TO_DEATH, resolveBattle, type BattleSummary } from "../../core/party";
import { session } from "../session";
import { PROGRESSION, WORLD, WORLD_CONTENT } from "../../content";
import { fatigueLevel, fatigueModifiers, removeEncounter, returnToLastCamp } from "../../core/expedition";
import { nextRandom } from "../../core/rng";
import { planTurn } from "../../core/ai";
import {
  activeUnit,
  affectedUnits,
  applyAction,
  deploymentErrors,
  lockDeployment,
  moveUnavailableReason,
  reachableFor,
  unitAt,
  maxHpOf,
  unitTraits,
  unitById,
  validTargets,
  type BattleAction,
  type BattleEvent,
  type DeployCandidate,
  NO_MODIFIERS,
  type BattleState,
  type BattleUnit,
  type Placement,
} from "../../core/battle";
import { Grid, key, samePoint, type Point } from "../../core/grid";
import { typeMultiplier } from "../../core/rules/typeChart";
import { Button } from "../ui/Button";
import { formatEvent, type LogEntry, type LogTone } from "../ui/combatLog";
import { describeMove } from "../ui/describeMove";
import { stripMarkup, tag } from "../ui/markup";
import { RichText } from "../ui/RichText";
import { animKey, FACE_LEFT, FACE_RIGHT, facingFor, hasSprite, type Facing, type SpriteAnim } from "../sprites";
import { BOARD_X, BOARD_Y, COLORS, FONT, PANEL_X, TILE, TYPE_COLORS, tileToWorld, px, PHONE } from "../ui/theme";

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
  private rewardText = "";
  private grid!: Grid;
  private phase: Phase = "deploy";
  private placements: Placement[] = [];
  private selectedCandidate: string | null = null;
  private state: BattleState | null = null;
  private selectedMove: string | null = null;
  private hoveredMove: string | null = null;
  private busy = false;
  private hovered: Point | null = null;
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
  private header!: Phaser.GameObjects.Text;

  constructor() {
    super("Battle");
  }

  init(data: { scenarioId?: string; scenario?: ScenarioDef; encounterId?: string }): void {
    this.scenario = data.scenario ?? SCENARIOS[data.scenarioId!]!;
    this.encounterId = data.encounterId ?? null;
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
  }

  create(): void {
    this.header = this.add.text(BOARD_X, 16, "", { fontFamily: FONT, fontSize: "20px", color: "#f5d76e" });
    this.add.text(BOARD_X, 44, this.scenario.name, { fontFamily: FONT, fontSize: px(13), color: COLORS.dim });
    this.drawBoard();
    this.overlay = this.add.graphics();
    this.panel = this.add.container(PANEL_X, 16);
    this.infoText = new RichText(this, PANEL_X, 330, 330, 12);

    this.logStrip = new RichText(this, BOARD_X, BOARD_Y + this.grid.height * TILE + 4, 450, 11, COLORS.dim, 15);
    const logButton = new Button(this, BOARD_X + this.grid.width * TILE - 110, BOARD_Y + this.grid.height * TILE + 6, 110, 22, PHONE ? "Full log" : "Full log [L]", () => this.toggleLogOverlay());
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
      this.hovered = this.pointerTile(p);
      this.refreshOverlay();
      this.refreshInfo();
    });
    this.input.on("pointerdown", (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      // Clicks on UI (buttons, the log overlay) never fall through to the board.
      if (over.length > 0) return;
      if (p.rightButtonDown()) return this.cancelSelection();
      const t = this.pointerTile(p);
      if (t) this.onTileClicked(t);
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
        g.fillStyle(COLORS[id] as number, 1);
        g.fillRect(BOARD_X + x * TILE, BOARD_Y + y * TILE, TILE, TILE);
        if (id === "grass") {
          g.fillStyle(0x3f8a45, 1);
          for (const [dx, dy] of [[10, 30], [24, 18], [34, 34]] as const) g.fillTriangle(
            BOARD_X + x * TILE + dx, BOARD_Y + y * TILE + dy,
            BOARD_X + x * TILE + dx + 4, BOARD_Y + y * TILE + dy - 10,
            BOARD_X + x * TILE + dx + 8, BOARD_Y + y * TILE + dy,
          );
        }
      }
    g.lineStyle(1, COLORS.gridLine, 0.35);
    for (let x = 0; x <= this.grid.width; x++)
      g.lineBetween(BOARD_X + x * TILE, BOARD_Y, BOARD_X + x * TILE, BOARD_Y + this.grid.height * TILE);
    for (let y = 0; y <= this.grid.height; y++)
      g.lineBetween(BOARD_X, BOARD_Y + y * TILE, BOARD_X + this.grid.width * TILE, BOARD_Y + y * TILE);
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
    const container = this.add.container(x, y, [ring, ...(sprite ? [sprite] : []), body, label, hpBg, hpBar]);
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
      const { x, y } = tileToWorld(u.pos);
      view.container.setPosition(x, y).setVisible(u.hp > 0);
      const frac = u.hp / u.maxHp;
      view.hpBar.width = 36 * frac;
      view.hpBar.fillColor = frac > 0.5 ? 0x7ed321 : frac > 0.25 ? 0xf5a623 : 0xd0021b;
      const active = this.state.turn?.unitId === u.id;
      view.ring.setStrokeStyle(active ? 4 : 3, active ? COLORS.active : u.side === "player" ? COLORS.player : COLORS.enemy);
    }
  }

  private fillTiles(tiles: readonly Point[], color: number, alpha: number): void {
    this.overlay.fillStyle(color, alpha);
    for (const p of tiles) this.overlay.fillRect(BOARD_X + p.x * TILE + 1, BOARD_Y + p.y * TILE + 1, TILE - 2, TILE - 2);
  }

  private refreshOverlay(): void {
    this.overlay.clear();
    if (this.phase === "deploy") {
      this.fillTiles(this.scenario.deploymentZone, COLORS.zone, 0.25);
    } else if (this.phase === "battle" && this.state && this.isPlayerTurn() && !this.busy) {
      const unit = activeUnit(this.state)!;
      if (this.selectedBall) {
        this.fillTiles(captureTargets(this.state, CONTENT, unit.id, this.selectedBall), COLORS.active, 0.35);
      } else if (this.selectedMove) {
        const targets = validTargets(this.state, CONTENT, unit.id, this.selectedMove);
        this.fillTiles(targets, COLORS.target, 0.3);
        if (this.hovered && targets.some((t) => samePoint(t, this.hovered!))) {
          const move = CONTENT.moves[this.selectedMove]!;
          this.fillTiles(affectedUnits(this.state, move, unit, this.hovered).map((u) => u.pos), COLORS.area, 0.55);
        }
      } else {
        this.fillTiles(reachableFor(this.state, unit.id).destinations, COLORS.reach, 0.25);
      }
    }
    if (this.hovered && this.grid.inBounds(this.hovered)) {
      this.overlay.lineStyle(2, 0xffffff, 0.8);
      this.overlay.strokeRect(BOARD_X + this.hovered.x * TILE + 1, BOARD_Y + this.hovered.y * TILE + 1, TILE - 2, TILE - 2);
    }
  }

  // ------------------------------------------------------------ panel

  private refreshAll(): void {
    this.syncUnits();
    this.refreshPanel();
    this.refreshOverlay();
    this.refreshInfo();
  }

  private refreshPanel(): void {
    this.panel.removeAll(true);
    this.hoveredMove = null;
    let y = 0;
    const text = (s: string, color: string = COLORS.text, size = 13) => {
      const t = this.add.text(0, y, s, { fontFamily: FONT, fontSize: px(size), color, wordWrap: { width: 330 } });
      this.panel.add(t);
      y += t.height + 4;
    };
    const button = (label: string, enabled: boolean, highlighted: boolean, onClick: () => void) => {
      const b = new Button(this, 0, y, 330, 26, label, onClick).setEnabled(enabled).setHighlighted(highlighted);
      this.panel.add(b);
      y += 30;
      return b;
    };

    if (this.phase === "deploy") {
      this.header.setText("Deployment");
      text(`Choose up to 3 Pokémon and place them in the blue zone. Inspect enemies by hovering/tapping.`, COLORS.dim, 12);
      const level = fatigueLevel(WORLD_CONTENT.fatigue, session.game.world.fatigue);
      if (level.movePenalty || level.damageMultiplier !== 1)
        text(`Fatigue: ${level.name}. Your Pokémon get −${level.movePenalty} movement${level.damageMultiplier !== 1 ? ` and deal ${Math.round((1 - level.damageMultiplier) * 100)}% less damage` : ""}.`, COLORS.bad, 12);
      for (const m of this.party) {
        const placed = this.placements.some((p) => p.unitId === m.id);
        const name = CONTENT.species[m.speciesId]!.name;
        const ko = this.knockoutsOf(m.id);
        const pips = "●".repeat(ko) + "○".repeat(KNOCKOUTS_TO_DEATH - ko);
        const hpText = m.hp > 0 ? `HP ${String(m.hp).padStart(3)}` : "fainted";
        button(`${placed ? "■" : "□"} ${name.padEnd(11)} ${hpText}  KO ${pips}${ko === 2 ? " !" : ""}`, m.hp > 0, this.selectedCandidate === m.id, () => {
          this.selectedCandidate = m.id;
          this.refreshAll();
        });
      }
      const errors = deploymentErrors(this.scenario, this.party, this.placements);
      y += 4;
      button(`▶ Lock deployment & start (${this.placements.length}/3)`, errors.length === 0, false, () => this.startBattle());
      button("← Avoid this battle", true, false, () => this.scene.start("Overworld"));
      return;
    }

    const state = this.state!;
    if (this.phase === "over") {
      this.header.setText(state.outcome === "victory" ? "Victory!" : state.outcome === "defeat" ? "Defeat" : "Retreated");
      const sum = this.summary;
      if (sum) {
        const name = (uid: string) => CONTENT.species[this.party.find((m) => m.id === uid)!.speciesId]!.name;
        if (state.outcome === "defeat") text("Your team falls back to camp and rests there.", COLORS.dim, 12);
        for (const c of sum.captured) text(`Caught ${CONTENT.species[c.member.speciesId]!.name}! Sent to ${c.to === "party" ? "your party" : "storage (party full)"}.`, COLORS.good);
        for (const uid of sum.knockedOut.filter((u) => !sum.fallen.includes(u)))
          text(`${name(uid)} was knocked out (KO ${this.knockoutsOf(uid)}/${KNOCKOUTS_TO_DEATH}).`, COLORS.bad);
        for (const uid of sum.fallen) text(`${name(uid)} has fallen for good.`, COLORS.bad);
        if (sum.xp || sum.money) text(`+${sum.xp} XP for each Pokémon that fought · +₽${sum.money}`, "#f5d76e");
        for (const [uid, evs] of Object.entries(sum.progress)) {
          for (const e of evs) {
            if (e.type === "levelUp") text(`${name(uid)} reached Lv ${e.level}!`, COLORS.good, 12);
            else if (e.type === "evolved") text(`${name(uid)} evolved into ${CONTENT.species[e.into]!.name}!`, "#f5d76e");
            else text(`${name(uid)} learned ${CONTENT.moves[e.move]!.name}${e.activated ? "" : " (set it active in Party)"}.`, COLORS.good, 12);
          }
        }
        if (!sum.captured.length && !sum.knockedOut.length && !sum.xp) text("No losses.", COLORS.dim);
      }
      if (this.rewardText) text(this.rewardText, COLORS.good);
      button("➜ Continue", true, false, () => this.scene.start("Overworld"));
      return;
    }

    const unit = activeUnit(state);
    this.header.setText(`Round ${state.round}`);
    text(`Order: ${state.queue.map((id) => this.displayName(unitById(state, id))).join(" › ")}`, COLORS.dim, 11);
    if (unit && unit.side === "player" && !this.busy) {
      const species = CONTENT.species[unit.speciesId]!;
      text(`${species.name} · move ${state.turn!.movePointsLeft} · ${state.turn!.actionUsed ? "action used" : "action ready"}`, COLORS.good);
      for (const moveId of unit.moves) {
        const move = CONTENT.moves[moveId]!;
        const reason = moveUnavailableReason(state, CONTENT, unit.id, moveId);
        const targets = reason ? [] : validTargets(state, CONTENT, unit.id, moveId);
        const cd = unit.cooldowns[moveId] ?? 0;
        const status = move.kind === "basic" ? "basic"
          : move.kind === "special" ? (cd > 0 ? `wait ${cd}` : "special")
          : unit.usedUltimates.includes(moveId) ? "ult used" : "ult 1×";
        button(`${move.name.padEnd(13)} ${move.power ? `Power ${String(move.power).padStart(2)}` : "        "}  ${status}`, targets.length > 0, this.selectedMove === moveId, () => {
          this.selectedBall = null;
          this.selectedMove = this.selectedMove === moveId ? null : moveId;
          this.refreshAll();
        }).onHover((over) => {
          this.hoveredMove = over ? moveId : this.hoveredMove === moveId ? null : this.hoveredMove;
          this.refreshInfo();
        });
      }
      if (state.captureAllowed) {
        const ballIds = Object.keys(CONTENT.balls);
        const w = Math.floor((330 - 8 * (ballIds.length - 1)) / ballIds.length);
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
      const half = 161;
      this.panel.add(new Button(this, 0, y, half, 26, PHONE ? "End turn" : "End turn [Space]", () => this.playerEndTurn()));
      this.panel.add(new Button(this, half + 8, y, half, 26, "Retreat", () => this.playerRetreat()));
      y += 30;
    } else {
      text("Enemy turn…", COLORS.bad);
    }
  }

  private refreshInfo(): void {
    if (this.hoveredMove) {
      let text = describeMove(CONTENT, CONTENT.moves[this.hoveredMove]!);
      const unit = this.state ? activeUnit(this.state) : null;
      if (unit) {
        const reason = moveUnavailableReason(this.state!, CONTENT, unit.id, this.hoveredMove)
          ?? (validTargets(this.state!, CONTENT, unit.id, this.hoveredMove).length === 0 ? "no valid target from here" : null);
        if (reason) text += `\n\n${tag("bad", `Not usable now: ${reason}`)}`;
      }
      this.infoText.setMarkup(text);
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
      this.infoText.setMarkup(`${tag("enemy", "??? Unknown Pokémon")}\n${tag("dim", "Its details are revealed once it acts or is hit.")}`);
      return;
    }
    const s = CONTENT.species[unit.speciesId]!;
    const lines = [
      `${tag(`${unit.side === "player" ? "ally" : "foe"}:${s.types[0]}`, s.name)} ${tag("dim", unit.side === "enemy" ? "(foe)" : "(yours)")}  ${s.types.map((t) => tag(t, t)).join("/")}`,
      `HP ${tag(unit.hp / unit.maxHp > 0.5 ? "heal" : "dmg", `${unit.hp}/${unit.maxHp}`)}  Atk ${unit.stats.attack}  Def ${unit.stats.defense}  Spe ${unit.stats.speed}`,
      ...s.types.map((t) => `${tag(t, t)}: ${tag("dim", CONTENT.types[t]?.summary ?? "")}`),
      unit.statuses.length ? `Status: ${unit.statuses.map((x) => `${tag("status", CONTENT.statuses[x.id]?.name ?? x.id)} (${x.turnsLeft})`).join(", ")}` : "",
      ...unit.moves.map((m) => {
        const mv = CONTENT.moves[m]!;
        const shape = mv.shape.kind === "single" ? "" : mv.shape.kind === "burst" ? `, area ${mv.shape.radius}` : `, line ${mv.shape.length}`;
        return `· ${tag(mv.kind, mv.name)} ${tag(mv.type, mv.type)}, range ${mv.range.min}-${mv.range.max}${shape}${mv.power ? `, power ${tag("dmg", mv.power)}` : ""}`;
      }),
    ];
    const active = this.state ? activeUnit(this.state) : null;
    if (active && active.side === "player" && unit.side === "enemy" && this.selectedMove) {
      const mv = CONTENT.moves[this.selectedMove]!;
      const eff = typeMultiplier(CONTENT.typeChart, mv.type, s.types);
      if (eff !== 1) lines.push(eff > 1 ? tag("good", `${mv.name} is super effective (×${eff})`) : tag("bad", `${mv.name} is not very effective (×${eff})`));
    }
    if (active && active.side === "player" && unit.side === "enemy" && this.selectedBall && this.state) {
      const ball = CONTENT.balls[this.selectedBall]!;
      const reason = captureUnavailableReason(this.state, CONTENT, active.id, this.selectedBall, unit.pos);
      lines.push(reason ? `${ball.name}: ${tag("bad", reason)}` : `${ball.name}: ${tag("good", `${Math.round(captureChance(CONTENT, unit, this.selectedBall) * 100)}% to catch`)} ${tag("dim", "(ball is used up either way)")}`);
    }
    if (unit.side === "player" && this.knockoutsOf(unit.id) > 0) lines.push(`Knockouts: ${tag("ko", `${this.knockoutsOf(unit.id)}/${KNOCKOUTS_TO_DEATH}`)}`);
    this.infoText.setMarkup(lines.filter(Boolean).join("\n"));
  }

  private knockoutsOf(uid: string): number {
    return session.game.roster.party.find((m) => m.uid === uid)?.knockouts ?? 0;
  }

  private terrainInfo(id: string): string {
    switch (id) {
      case "grass": return "Tall grass — units here can only be targeted from adjacent tiles.";
      case "mud": return "Mud — costs 2 movement.";
      case "wall": return "Rock — blocks movement and line of sight.";
      case "water": return "Water — impassable.";
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
    const t = { x: Math.floor((p.worldX - BOARD_X) / TILE), y: Math.floor((p.worldY - BOARD_Y) / TILE) };
    return this.grid.inBounds(t) ? t : null;
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
    if (without.length >= 3) return;
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
      playerModifiers: fatigueModifiers(fatigueLevel(WORLD_CONTENT.fatigue, session.game.world.fatigue)),
    });
    this.state = state;
    this.phase = "battle";
    void this.playEvents(events).then(() => this.continueFlow());
  }

  private playerEndTurn(): void {
    if (this.phase !== "battle" || this.busy || !this.isPlayerTurn()) return;
    this.selectedMove = null;
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
      for (const action of planTurn(this.state, CONTENT)) {
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
        if (roll.value < 0.3) {
          game = { ...game, inventory: { ...game.inventory, balls: { ...game.inventory.balls, "poke-ball": (game.inventory.balls["poke-ball"] ?? 0) + 1 } } };
          this.rewardText = "Found a Poké Ball after the battle!";
        }
      }
      if (this.state.outcome === "defeat") game = { ...game, world: returnToLastCamp(WORLD_CONTENT, WORLD, game.world) };
      session.update(game);
      this.summary = result.summary;
    }
    this.refreshAll();
  }

  // ------------------------------------------------------------ event playback

  private async playEvents(events: readonly BattleEvent[]): Promise<void> {
    const state = this.state!;
    const ctx = {
      name: (id: string) => {
        const u = unitById(state, id);
        return u.side === "enemy" ? `Foe ${this.displayName(u)}` : this.displayName(u);
      },
      isPlayer: (id: string) => unitById(state, id).side === "player",
      typeOf: (id: string) => {
        const u = unitById(state, id);
        return u.side === "enemy" && this.isHidden(u.id) ? null : CONTENT.species[u.speciesId]!.types[0]!;
      },
      moveName: (id: string) => CONTENT.moves[id]!.name,
      statusName: (id: string) => CONTENT.statuses[id]?.name ?? id,
      ballName: (id: string) => CONTENT.balls[id]?.name ?? id,
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
          }
          break;
        }
        case "damaged": {
          this.flinch(e.unitId);
          const eff = e.effectiveness && e.effectiveness !== 1 ? (e.effectiveness > 1 ? " !" : " ↓") : "";
          this.floatText(e.unitId, `-${e.amount}${eff}`, e.source === "status" ? "#c070ff" : "#ff6b6b");
          this.syncUnits();
          await this.wait(220);
          break;
        }
        case "healed":
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
          await this.fadeOut(e.unitId);
          break;
        case "fainted":
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
    const w = this.grid.width * TILE;
    const h = this.grid.height * TILE;
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
    const title = this.add.text(10, 8, `Combat log (${this.log.length})  ·  scroll or drag  ·  tap or L to close`, {
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
      this.tweens.add({ targets: view.container, alpha: 0, scale: 0.4, duration: 300, onComplete: () => resolve() }),
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
