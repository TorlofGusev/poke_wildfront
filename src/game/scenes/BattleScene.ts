import Phaser from "phaser";
import { CONTENT, PROTOTYPE_PARTY, SCENARIOS } from "../../content";
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
  unitById,
  validTargets,
  type BattleAction,
  type BattleEvent,
  type BattleScenario,
  type BattleState,
  type BattleUnit,
  type Placement,
} from "../../core/battle";
import { Grid, key, samePoint, type Point } from "../../core/grid";
import { typeMultiplier } from "../../core/rules/typeChart";
import { Button } from "../ui/Button";
import { formatEvent, type LogEntry, type LogTone } from "../ui/combatLog";
import { describeMove } from "../ui/describeMove";
import { BOARD_X, BOARD_Y, COLORS, FONT, PANEL_X, TILE, TYPE_COLORS, tileToWorld } from "../ui/theme";

type Phase = "deploy" | "battle" | "over";

interface UnitView {
  container: Phaser.GameObjects.Container;
  hpBar: Phaser.GameObjects.Rectangle;
  ring: Phaser.GameObjects.Arc;
  body: Phaser.GameObjects.Arc;
  label: Phaser.GameObjects.Text;
  speciesId: string;
}

const AI_STEP_MS = 350;

const LOG_COLORS: Record<LogTone, string> = {
  info: "#8a93a6", player: "#8fb8f0", enemy: "#f08f8f", damage: "#ffb070",
  heal: "#7ed321", status: "#c070ff", ko: "#ff5050", result: "#f5d76e",
};

export class BattleScene extends Phaser.Scene {
  private scenario!: BattleScenario & { name: string };
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
  private logStrip!: Phaser.GameObjects.Text;
  private logOverlay: Phaser.GameObjects.Container | null = null;
  private logScroll = 0;

  private overlay!: Phaser.GameObjects.Graphics;
  private units = new Map<string, UnitView>();
  private panel!: Phaser.GameObjects.Container;
  private infoText!: Phaser.GameObjects.Text;
  private header!: Phaser.GameObjects.Text;

  constructor() {
    super("Battle");
  }

  init(data: { scenarioId: string }): void {
    this.scenario = SCENARIOS[data.scenarioId]!;
    this.grid = Grid.fromAscii(this.scenario.mapRows);
    this.phase = "deploy";
    this.placements = [];
    this.selectedCandidate = PROTOTYPE_PARTY[0]?.id ?? null;
    this.state = null;
    this.selectedMove = null;
    this.hoveredMove = null;
    this.busy = false;
    this.revealed = new Set();
    this.log = [];
    this.logOverlay = null;
    this.logScroll = 0;
    this.units = new Map();
  }

  create(): void {
    this.header = this.add.text(BOARD_X, 16, "", { fontFamily: FONT, fontSize: "20px", color: "#f5d76e" });
    this.add.text(BOARD_X, 44, this.scenario.name, { fontFamily: FONT, fontSize: "13px", color: COLORS.dim });
    this.drawBoard();
    this.overlay = this.add.graphics();
    this.panel = this.add.container(PANEL_X, 16);
    this.infoText = this.add.text(PANEL_X, 330, "", {
      fontFamily: FONT, fontSize: "12px", color: COLORS.text, wordWrap: { width: 330 }, lineSpacing: 2,
    });

    this.logStrip = this.add.text(BOARD_X, BOARD_Y + this.grid.height * TILE + 6, "", {
      fontFamily: FONT, fontSize: "11px", color: COLORS.dim, lineSpacing: 1,
    });
    const logButton = new Button(this, BOARD_X + this.grid.width * TILE - 110, BOARD_Y + this.grid.height * TILE + 6, 110, 22, "Full log [L]", () => this.toggleLogOverlay());
    logButton.setDepth(5);
    this.input.keyboard?.on("keydown-L", () => this.toggleLogOverlay());
    this.input.on("wheel", (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      if (!this.logOverlay) return;
      this.logScroll = Math.max(0, this.logScroll + Math.sign(dy) * 3);
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
    const g = this.add.graphics();
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
    const ring = this.add.circle(0, 0, 19).setStrokeStyle(3, side === "player" ? COLORS.player : COLORS.enemy);
    const body = this.add.circle(0, 0, 16, TYPE_COLORS[species.types[0]!] ?? 0x888888);
    const label = this.add
      .text(0, -1, species.name.slice(0, 2), { fontFamily: FONT, fontSize: "14px", color: "#10141c", fontStyle: "bold" })
      .setOrigin(0.5);
    const hpBg = this.add.rectangle(-18, 20, 36, 4, 0x000000).setOrigin(0, 0.5);
    const hpBar = this.add.rectangle(-18, 20, 36, 4, 0x7ed321).setOrigin(0, 0.5);
    const container = this.add.container(x, y, [ring, body, label, hpBg, hpBar]);
    this.units.set(id, { container, hpBar, ring, body, label, speciesId });
    this.applyDisguise(id);
  }

  /** Hidden enemies show as a grey "?" until revealed. */
  private applyDisguise(id: string): void {
    const view = this.units.get(id)!;
    const species = CONTENT.species[view.speciesId]!;
    const hidden = this.isHidden(id);
    view.body.setFillStyle(hidden ? 0x777777 : TYPE_COLORS[species.types[0]!] ?? 0x888888);
    view.label.setText(hidden ? "?" : species.name.slice(0, 2));
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
      if (this.selectedMove) {
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
      const t = this.add.text(0, y, s, { fontFamily: FONT, fontSize: `${size}px`, color, wordWrap: { width: 330 } });
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
      for (const m of PROTOTYPE_PARTY) {
        const placed = this.placements.some((p) => p.unitId === m.id);
        const name = CONTENT.species[m.speciesId]!.name;
        button(`${placed ? "■" : "□"} ${name.padEnd(11)} HP ${m.hp}`, true, this.selectedCandidate === m.id, () => {
          this.selectedCandidate = m.id;
          this.refreshAll();
        });
      }
      const errors = deploymentErrors(this.scenario, PROTOTYPE_PARTY, this.placements);
      y += 4;
      button(`▶ Lock deployment & start (${this.placements.length}/3)`, errors.length === 0, false, () => this.startBattle());
      return;
    }

    const state = this.state!;
    if (this.phase === "over") {
      this.header.setText(state.outcome === "victory" ? "Victory!" : "Defeat");
      button("↻ Play again", true, false, () => this.scene.restart({ scenarioId: this.scenario.id }));
      button("⌂ Title", true, false, () => this.scene.start("Title"));
      return;
    }

    const unit = activeUnit(state);
    this.header.setText(`Round ${state.round}`);
    text(`Order: ${state.queue.map((id) => this.displayName(unitById(state, id))).join(" › ")}`, COLORS.dim, 11);
    if (unit && unit.side === "player" && !this.busy) {
      const species = CONTENT.species[unit.speciesId]!;
      text(`${species.name} · move ${state.turn!.movePointsLeft} · ${state.turn!.actionUsed ? "action used" : "action ready"}`, COLORS.good);
      for (const moveId of species.moves) {
        const move = CONTENT.moves[moveId]!;
        const reason = moveUnavailableReason(state, CONTENT, unit.id, moveId);
        const targets = reason ? [] : validTargets(state, CONTENT, unit.id, moveId);
        const tag = move.kind === "basic" ? "" : move.kind === "special"
          ? (unit.cooldowns[moveId] ? ` cd ${unit.cooldowns[moveId]}` : ` cd ${move.cooldown}`)
          : unit.usedUltimates.includes(moveId) ? " used" : " 1×";
        button(`${move.name} [${move.kind}${tag}] ${move.power ? `pw ${move.power}` : ""}`, targets.length > 0, this.selectedMove === moveId, () => {
          this.selectedMove = this.selectedMove === moveId ? null : moveId;
          this.refreshAll();
        }).onHover((over) => {
          this.hoveredMove = over ? moveId : this.hoveredMove === moveId ? null : this.hoveredMove;
          this.refreshInfo();
        });
      }
      button("End turn [Space]", true, false, () => this.playerEndTurn());
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
        if (reason) text += `\n\nNot usable now: ${reason}`;
      }
      this.infoText.setText(text);
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
      this.infoText.setText([moveText, terrainText].filter(Boolean).join("\n\n"));
      return;
    }
    if (unit.side === "enemy" && this.isHidden(unit.id)) {
      this.infoText.setText("??? Unknown Pokémon\nIts details are revealed once it acts or is hit.");
      return;
    }
    const s = CONTENT.species[unit.speciesId]!;
    const lines = [
      `${s.name} (${unit.side})  ${s.types.join("/")}`,
      `HP ${unit.hp}/${unit.maxHp}  Atk ${s.stats.attack}  Def ${s.stats.defense}  Spe ${s.stats.speed}`,
      unit.statuses.length ? `Status: ${unit.statuses.map((x) => `${x.id} (${x.turnsLeft})`).join(", ")}` : "",
      ...s.moves.map((m) => {
        const mv = CONTENT.moves[m]!;
        const shape = mv.shape.kind === "single" ? "" : mv.shape.kind === "burst" ? ` burst ${mv.shape.radius}` : ` line ${mv.shape.length}`;
        return `· ${mv.name} — ${mv.type} ${mv.kind}, range ${mv.range.min}-${mv.range.max}${shape}${mv.power ? `, pw ${mv.power}` : ""}`;
      }),
    ];
    const active = this.state ? activeUnit(this.state) : null;
    if (active && active.side === "player" && unit.side === "enemy" && this.selectedMove) {
      const mv = CONTENT.moves[this.selectedMove]!;
      const eff = typeMultiplier(CONTENT.typeChart, mv.type, s.types);
      if (eff !== 1) lines.push(eff > 1 ? `${mv.name} is super effective (×${eff})` : `${mv.name} is not very effective (×${eff})`);
    }
    this.infoText.setText(lines.filter(Boolean).join("\n"));
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
    const member = PROTOTYPE_PARTY.find((m) => m.id === id);
    const speciesId = enemy?.speciesId ?? member!.speciesId;
    const maxHp = Math.round(CONTENT.species[speciesId]!.stats.hp * CONTENT.rules.hpMultiplier);
    return {
      id, speciesId, side: enemy ? "enemy" : "player", maxHp, hp: member?.hp ?? maxHp,
      pos: enemy?.pos ?? { x: 0, y: 0 }, statuses: [], cooldowns: {}, usedUltimates: [],
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
    this.createUnitView(id, PROTOTYPE_PARTY.find((m) => m.id === id)!.speciesId, "player", t);
    // Auto-advance to the next unplaced party member for quick deployment.
    this.selectedCandidate = PROTOTYPE_PARTY.find((m) => !this.placements.some((p) => p.unitId === m.id))?.id ?? null;
    this.refreshAll();
  }

  private cancelSelection(): void {
    this.selectedMove = null;
    this.refreshAll();
  }

  private isPlayerTurn(): boolean {
    const u = this.state ? activeUnit(this.state) : null;
    return u?.side === "player";
  }

  // ------------------------------------------------------------ flow

  private startBattle(): void {
    const { state, events } = lockDeployment(CONTENT, this.scenario, PROTOTYPE_PARTY, this.placements);
    this.state = state;
    this.phase = "battle";
    void this.playEvents(events).then(() => this.continueFlow());
  }

  private playerEndTurn(): void {
    if (this.phase !== "battle" || this.busy || !this.isPlayerTurn()) return;
    this.selectedMove = null;
    void this.perform({ type: "endTurn", unitId: activeUnit(this.state!)!.id });
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
    if (this.state?.outcome !== "ongoing") this.phase = "over";
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
      moveName: (id: string) => CONTENT.moves[id]!.name,
      statusName: (id: string) => CONTENT.statuses[id]?.name ?? id,
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
        case "moveUsed":
          break;
        case "damaged": {
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
    this.logStrip.setText(this.log.slice(-4).map((l) => l.text).join("\n"));
    if (this.logOverlay) this.renderLogOverlay();
  }

  private toggleLogOverlay(): void {
    if (this.logOverlay) {
      this.logOverlay.destroy();
      this.logOverlay = null;
      return;
    }
    this.logScroll = 0;
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
    bg.on("pointerdown", () => this.toggleLogOverlay());
    const title = this.add.text(10, 8, `Combat log (${this.log.length})  ·  wheel to scroll  ·  click or L to close`, {
      fontFamily: FONT, fontSize: "12px", color: "#f5d76e",
    });
    const texts = lines.map((l, i) =>
      this.add.text(10, 32 + i * lineH, l.text, { fontFamily: FONT, fontSize: "12px", color: LOG_COLORS[l.tone] }),
    );
    this.logOverlay = this.add.container(BOARD_X, BOARD_Y, [bg, title, ...texts]).setDepth(10);
  }

  private tweenPath(unitId: string, path: readonly Point[]): Promise<void> {
    const view = this.units.get(unitId);
    if (!view || path.length === 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.tweens.chain({
        targets: view.container,
        tweens: path.map((p) => ({ ...tileToWorld(p), duration: 90 })),
        onComplete: () => resolve(),
      });
    });
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
