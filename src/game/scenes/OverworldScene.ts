import { evolvingUids } from "./EvolutionScene";
import Phaser from "phaser";
import { playMusic } from "../music";
import { sfx } from "../audio";
import { CAMP, CONTENT, PROGRESSION, STORY_STEPS, WORLD_CONTENT, WORLDS } from "../../content";
import { pendingChoice, trainerSetup, wildForm, wildSetup } from "../../core/progression";
import { BADGES, blockedTiles, completeNpc, currentGoal, fieldMoveUsable, isBattler, meets, npcDone, teamOf, trainerScenario, visibleNpcs, type NpcDef } from "../../core/story";
import { grantGifts } from "../storyFlow";
import {
  areaName,
  biomeAt,
  spawnsAt,
  spawnSpotNear,
  deploySlotsFor,
  changeMap,
  exitAt,
  effectiveGroup,
  fatigueLevel,
  makeCamp,
  travel,
  travelPath,
  worldGrid,
  wildScenario,
  pickupKind,
  stepGroups,
  type EncounterGroup,
  type PickupKind,
  type WorldAccess,
  type WorldState,
} from "../../core/expedition";
import { samePoint, type Point } from "../../core/grid";
import { centerHeal, centerTreatment, centerTreatmentCost, KNOCKOUTS_TO_DEATH, knownSpecies, memberMaxHp, restAll } from "../../core/party";
import { MAX_ACTIVE_UNITS } from "../../core/battle";
import { battleArena, formationLabel } from "../../core/free/arena";
import { currentWorld, session } from "../session";
import { animKey, facingFor, hasSprite, portraitKey } from "../sprites";
import { showHelp, showTip } from "../tips";
import { Button } from "../ui/Button";
import { addFullscreenButton } from "../ui/fullscreen";
import { tag } from "../ui/markup";
import { t } from "../i18n";
import { RichText } from "../ui/RichText";
import { boardTheme, drawFloorDecor, drawWaterDecor, tileRand } from "../ui/boardDecor";
import { ballIcon } from "../ui/ballIcon";
import { trainerLook } from "../trainerLook";
import { trainerTexture } from "../trainerSprites";
import { COLORS, FONT, PHONE, TYPE_COLORS, px } from "../ui/theme";

const T = 28;
const MAP_X = 16;
const MAP_Y = 60;
const HUD_X = 704;
/** The party grid in the HUD column: 3 portraits a row, the money and items beside it. */
const STRIP_COLS = 3;
const STRIP_SIZE = 36;
const STRIP_GAP = 4;
const STRIP_W = STRIP_COLS * (STRIP_SIZE + STRIP_GAP) - STRIP_GAP;
const STEP_MS = 70;

const BIOME_COLORS: Record<string, number> = {
  route: 0x55704a, forest: 0x2f6b34, mountain: 0x7a6a55, cave: 0x4a4038, town: 0x6f8fae, water: 0x2d5a8c, trees: 0x1d3a20,
};
/** Regional biomes are coloured by what their id names: shores and seas, caves, buildings, grass… */
const BIOME_HINTS: [RegExp, number][] = [
  [/sea|coast|pond|lake|water|spring/, 0x3f78a8],
  [/cave|tunnel|digletts|victory|seafoam/, 0x4a4038],
  [/tower|mansion|lab|plant|dojo/, 0x5a5068],
  [/crater|route23|mountain/, 0x7a6a55],
  [/forest|safari|park|route24|route7|route21/, 0x2f6b34],
];
const biomeColor = (id: string): number => BIOME_COLORS[id] ?? BIOME_HINTS.find(([re]) => re.test(id))?.[1] ?? BIOME_COLORS.route!;

/** Each tile a touch lighter or darker than its biome colour, so open ground doesn't read as one flat block. */
function shade(color: number, x: number, y: number): number {
  const k = 0.92 + tileRand(x, y, 11) * 0.14;
  const ch = (s: number) => Math.min(255, Math.round(((color >> s) & 0xff) * k));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Props by what the biome is: grass tufts and flowers outside, pebbles and crystals in caves, ripples on water. */
function decorate(g: Phaser.GameObjects.Graphics, id: string, x: number, y: number, cx: number, cy: number): void {
  if (id === "town" || id === "trees" || id === "mountain") return;
  if (id === "water" || /sea|coast|pond|lake|water|spring/.test(id)) drawWaterDecor(g, x, y, cx, cy);
  else drawFloorDecor(g, boardTheme(id === "route" || id === "forest" ? "field" : id), x, y, cx, cy);
}

/** Towns: houses here and there, the rest paved, with flower beds, lamps and trees between them. */
function drawTownTile(g: Phaser.GameObjects.Graphics, x: number, y: number, left: number, top: number): void {
  const r = tileRand(x, y, 12);
  if (r < 0.4) {
    const roof = [0xc0392b, 0x2e6fb0, 0x3f8a45, 0x8e5a2e][Math.floor(tileRand(x, y, 13) * 4)]!;
    g.fillStyle(0xe8e0d0, 1).fillRect(left + 8, top + 13, 12, 9);
    g.fillStyle(0x5a4030, 1).fillRect(left + 12, top + 17, 4, 5);
    g.fillStyle(roof, 1).fillTriangle(left + 6, top + 14, left + 14, top + 6, left + 22, top + 14);
    return;
  }
  // Paving: a slab seam.
  g.lineStyle(1, 0x000000, 0.12).lineBetween(left, top + T / 2, left + T, top + T / 2).lineBetween(left + T / 2, top, left + T / 2, top + T / 2);
  if (r < 0.5) {
    g.fillStyle(0x3f8a45, 1).fillRect(left + 6, top + 16, 16, 6);
    for (const dx of [8, 13, 18]) g.fillStyle(tileRand(x, y, dx) < 0.5 ? 0xf2e36b : 0xe98bd0, 1).fillCircle(left + dx, top + 18, 1.8);
  } else if (r < 0.57) {
    g.fillStyle(0x2a5a2e, 1).fillCircle(left + 14, top + 12, 7);
    g.fillStyle(0x5a4030, 1).fillRect(left + 13, top + 18, 3, 5);
  } else if (r < 0.62) {
    g.fillStyle(0x30343c, 1).fillRect(left + 13, top + 8, 2, 14);
    g.fillStyle(0xf5d76e, 1).fillCircle(left + 14, top + 8, 2.5);
  }
}

export class OverworldScene extends Phaser.Scene {
  private token!: Phaser.GameObjects.Container;
  private markers!: Phaser.GameObjects.Container;
  /** Each wild group's marker by group id, so a step can glide it to its new tile. */
  private groupViews = new Map<string, Phaser.GameObjects.Container>();
  private preview!: Phaser.GameObjects.Graphics;
  private hud!: RichText;
  private buttons!: Phaser.GameObjects.Container;
  private moving = false;
  private leader: string | null = null;
  private leaderSprite: Phaser.GameObjects.Sprite | null = null;
  private message = "";
  /** Touch: the tile tapped once; a second tap on it confirms (there is no hover to preview with). */
  private armed: Point | null = null;
  private lastHover: Point | null = null;
  /** Touch: the tile a press started on, and whether the finger has dragged off it since. */
  private dragFrom: Point | null = null;
  private dragging = false;
  private hudPending = false;
  private stripBox!: Phaser.GameObjects.Container;
  private statsText!: RichText;
  /** The ball icons with their counts beside the party grid, rebuilt only when a count changes. */
  private ballBox!: Phaser.GameObjects.Container;
  private ballKey = "";
  private msgText!: RichText;
  private btnBox!: Phaser.GameObjects.Container;
  private stripKey = "";
  private btnKey = "";
  /** The dialogue box with an NPC, while open. */
  private dialog: Phaser.GameObjects.Container | null = null;
  /** The "wild Pokémon here" panel over the map, while open. */
  private spawnPanel: Phaser.GameObjects.Container | null = null;

  constructor() {
    super("Overworld");
  }

  private intro = false;

  init(data: { message?: string; intro?: boolean }): void {
    this.message = data?.message ?? "";
    this.intro = data?.intro ?? false;
    this.moving = false;
  }

  create(): void {
    // Back from a battle (or anywhere) with a due evolution: its scene plays first.
    const evolving = evolvingUids();
    if (evolving.length) return void this.scene.start("Evolution", { uids: evolving, next: "Overworld" });
    playMusic(this, "overworld");
    this.add.text(MAP_X, 16, currentWorld().name, { fontFamily: FONT, fontSize: "20px", color: "#f5d76e" });
    this.add.text(MAP_X, 40, PHONE ? t("Tap twice or drag to walk · red ring: wild group · ★ ◆ ✚ pickups") : t("Click to walk. Red ring: wild group. Pickups: ★ rare · ◆ held item · ✚ heal · M: sound on/off"), {
      fontFamily: FONT, fontSize: px(11), color: COLORS.dim, wordWrap: { width: 672 },
    });
    this.drawMap();
    // The map legend, once; after the intro if one opens.
    this.time.delayedCall(400, () => this.dialog || showTip(this, "map"));
    this.preview = this.add.graphics();
    this.markers = this.add.container(0, 0);
    // The party leader walks the map; a yellow marker stands in if it has no sprite.
    const leader = session.game.roster.party[0]?.speciesId;
    this.leader = leader && hasSprite(leader) ? leader : null;
    this.leaderSprite = this.leader
      ? this.add.sprite(0, 8, `${this.leader}-idle`).setOrigin(0.5, 0.85).play(animKey(this.leader, "idle", 0))
      : null;
    this.token = this.add.container(0, 0, [
      this.add.ellipse(0, 8, 22, 8, 0xf5d76e, 0.5).setStrokeStyle(1, 0xf5d76e),
      ...(this.leaderSprite ? [this.leaderSprite] : [
        this.add.circle(0, 0, 10, 0xf5d76e).setStrokeStyle(2, 0x10141c),
        this.add.text(0, 0, "★", { fontFamily: FONT, fontSize: px(12), color: "#10141c" }).setOrigin(0.5),
      ]),
    ]).setDepth(5);
    this.hud = new RichText(this, HUD_X, 16, 240, 12);
    this.buttons = this.add.container(HUD_X, 0);
    // The HUD column is rebuilt piece by piece, and only what changed: rebuilding text and buttons
    // creates GPU textures, which is what made taps feel slow on phones.
    this.stripBox = this.add.container(0, 0);
    // Beside the 3-wide party grid.
    this.statsText = new RichText(this, STRIP_W + 6, 0, 240 - STRIP_W - 6, 12);
    this.msgText = new RichText(this, 0, 0, 240, 12);
    this.btnBox = this.add.container(0, 0);
    this.ballBox = this.add.container(STRIP_W + 6, 0);
    this.ballKey = "";
    this.stripKey = this.btnKey = "";
    this.buttons.add([this.stripBox, this.statsText, this.ballBox, this.msgText, this.btnBox]);

    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      // Only redo the path preview when the pointer reaches another tile.
      const t = this.tileAt(p);
      if (t === this.lastHover || (t && this.lastHover && samePoint(t, this.lastHover))) return;
      this.lastHover = t;
      // Touch drag: once the finger leaves the tile it pressed, the path follows it and lifting the finger goes.
      if (p.wasTouch && p.isDown && this.dragFrom && t && !samePoint(t, this.dragFrom)) this.dragging = true;
      if (p.wasTouch && !this.dragging) return;
      this.showPreview(t);
    });
    this.input.on("pointerdown", (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (over.length > 0) return;
      const t = this.tileAt(p);
      if (!t || this.dialog) return;
      // Touch acts on release, so a press can turn into a drag.
      if (p.wasTouch) {
        this.dragFrom = t;
        this.dragging = false;
        this.lastHover = t;
        // Instant feedback under the finger; the path and HUD follow.
        this.preview.lineStyle(3, 0xf5d76e, 1).strokeRect(MAP_X + t.x * T + 1, MAP_Y + t.y * T + 1, T - 2, T - 2);
        return;
      }
      this.act(t);
    });
    this.input.on("pointerup", (p: Phaser.Input.Pointer) => {
      if (!p.wasTouch || !this.dragFrom) return;
      const from = this.dragFrom, dragged = this.dragging;
      this.dragFrom = null;
      this.dragging = false;
      const t = this.tileAt(p);
      if (!t || this.dialog) return;
      if (dragged) {
        this.armed = null;
        return samePoint(t, this.world.pos) ? this.showPreview(null) : this.act(t);
      }
      // A tap: the first previews (path, fatigue, wild group), a second on the same tile goes.
      if (!samePoint(from, this.world.pos) && !(this.armed && samePoint(this.armed, from))) {
        this.armed = from;
        return this.showPreview(from);
      }
      this.armed = null;
      this.act(from);
    });
    this.input.keyboard?.on("keydown-I", () => {
      if (!this.moving && (this.spawnPanel || spawnsAt(WORLD_CONTENT, currentWorld(), this.spawnSpot()).length)) this.toggleSpawnPanel();
    });
    this.render();
    this.announceArea(this.world.pos);
    if (this.intro) this.showIntro();
  }

  /** The party as a row of portraits with HP bars; tap one to open the camp screen. Returns the y below it. */
  private partyStrip(y: number): number {
    const size = STRIP_SIZE, gap = STRIP_GAP;
    // A 3-wide grid (up to 3×3); the money, items and balls sit beside it.
    const count = session.game.roster.party.length;
    const perRow = STRIP_COLS;
    const rowH = size + 10;
    const height = Math.ceil(count / Math.max(1, perRow)) * rowH - 10;
    this.stripBox.setY(y);
    const key = session.game.roster.party.map((m) => `${m.uid}:${m.hp}:${m.level}:${m.knockouts}:${pendingChoice(CONTENT, PROGRESSION, m) || m.unspentPoints > 0}`).join("|") + `|${this.moving}`;
    if (key === this.stripKey) return y + height + 12;
    this.stripKey = key;
    this.stripBox.removeAll(true);
    session.game.roster.party.forEach((m, i) => {
      const x = (i % perRow) * (size + gap);
      const y = Math.floor(i / perRow) * rowH;
      const frac = Math.max(0, m.hp / memberMaxHp(CONTENT, PROGRESSION, m));
      const pending = pendingChoice(CONTENT, PROGRESSION, m) || m.unspentPoints > 0;
      const bg = this.add.rectangle(x, y, size, size, 0x1c2230).setOrigin(0).setStrokeStyle(pending ? 2 : 1, pending ? 0xf5d76e : m.knockouts >= 2 ? 0xff6b6b : 0x3a4560)
        .setInteractive({ useHandCursor: true })
        .on("pointerup", () => { if (!this.moving) this.scene.start("Party", { rested: false, choosingMeal: false }); });
      const parts: Phaser.GameObjects.GameObject[] = [bg];
      if (this.textures.exists(portraitKey(m.speciesId)))
        parts.push(this.add.image(x + size / 2, y + size / 2, portraitKey(m.speciesId)).setDisplaySize(size - 4, size - 4).setAlpha(m.hp > 0 ? 1 : 0.35));
      parts.push(this.add.text(x + 2, y + 1, `${m.level}`, { fontFamily: FONT, fontSize: px(10), color: COLORS.text, stroke: "#000", strokeThickness: 3 }));
      if (pending) parts.push(this.add.text(x + size - 2, y + 1, "★", { fontFamily: FONT, fontSize: px(11), color: "#f5d76e" }).setOrigin(1, 0));
      if (m.knockouts) parts.push(this.add.text(x + size - 2, y + size - 6, "●".repeat(m.knockouts), { fontFamily: FONT, fontSize: px(9), color: "#ff6b6b" }).setOrigin(1, 1));
      parts.push(this.add.rectangle(x, y + size + 2, size, 4, 0x2a3242).setOrigin(0));
      parts.push(this.add.rectangle(x, y + size + 2, size * frac, 4, frac > 0.5 ? 0x6bd36b : frac > 0.2 ? 0xf5d76e : 0xff6b6b).setOrigin(0));
      this.stripBox.add(parts);
    });
    return this.stripBox.y + height + 12;
  }

  /** Party members able to fight; wild groups never outnumber them (see effectiveGroup and deploySlotsFor). */
  private slots(): number {
    return deploySlotsFor(currentWorld().deploySlots ?? MAX_ACTIVE_UNITS, (session.game.badges ?? []).length);
  }

  /** On the learning (tutorial-AI) maps wild Pokémon are never above the party's best level. */
  private levelCap(): number | undefined {
    if (currentWorld().ai !== "tutorial") return undefined;
    return Math.max(1, ...session.game.roster.party.filter((m) => m.hp > 0).map((m) => m.level));
  }

  private healthy(): number {
    return session.game.roster.party.filter((m) => m.hp > 0).length;
  }

  private get world(): WorldState {
    return session.game.world;
  }

  private setWorld(world: WorldState): void {
    session.update({ ...session.game, world });
  }

  private tileAt(p: Phaser.Input.Pointer): Point | null {
    const t = { x: Math.floor((p.worldX - MAP_X) / T), y: Math.floor((p.worldY - MAP_Y) / T) };
    return worldGrid(WORLD_CONTENT, currentWorld()).inBounds(t) ? t : null;
  }

  private center(p: Point) {
    return { x: MAP_X + p.x * T + T / 2, y: MAP_Y + p.y * T + T / 2 };
  }

  private drawMap(): void {
    const grid = worldGrid(WORLD_CONTENT, currentWorld());
    // Drawn once into a texture (see bake below): thousands of shapes per frame are heavy on phones.
    const g = this.make.graphics({}, false);
    for (let y = 0; y < grid.height; y++)
      for (let x = 0; x < grid.width; x++) {
        const id = grid.terrainAt({ x, y }).id;
        g.fillStyle(shade(biomeColor(id), x, y), 1).fillRect(MAP_X + x * T, MAP_Y + y * T, T, T);
        decorate(g, id, x, y, MAP_X + x * T + T / 2, MAP_Y + y * T + T / 2);
        if (id === "mountain") g.fillStyle(0x9a8a72, 1).fillTriangle(MAP_X + x * T + 6, MAP_Y + y * T + 22, MAP_X + x * T + 14, MAP_Y + y * T + 7, MAP_X + x * T + 22, MAP_Y + y * T + 22);
        if (id === "trees") g.fillStyle(0x2a5a2e, 1).fillCircle(MAP_X + x * T + 14, MAP_Y + y * T + 14, 10);
        if (id === "forest") g.fillStyle(0x3f8a45, 1).fillTriangle(MAP_X + x * T + 9, MAP_Y + y * T + 20, MAP_X + x * T + 14, MAP_Y + y * T + 8, MAP_X + x * T + 19, MAP_Y + y * T + 20);
        if (id === "town") drawTownTile(g, x, y, MAP_X + x * T, MAP_Y + y * T);
        if (id === "cave") g.fillStyle(0x221c18, 1).fillCircle(MAP_X + x * T + 14, MAP_Y + y * T + 16, 6);
      }
    // Edge exits to other maps; ones without a target are not open yet.
    for (const exit of currentWorld().exits ?? []) {
      const e = this.center(exit.pos);
      const open = Boolean(exit.to);
      const arrow = exit.pos.y === 0 ? "▲" : exit.pos.y === grid.height - 1 ? "▼" : exit.pos.x === 0 ? "◀" : "▶";
      g.fillStyle(open ? 0xf5d76e : 0x10141c, open ? 0.35 : 0.85).fillRect(e.x - T / 2, e.y - T / 2, T, T);
      this.add.text(e.x, e.y, arrow, { fontFamily: FONT, fontSize: px(14), color: "#f5d76e", fontStyle: "bold" }).setOrigin(0.5).setDepth(6);
      // The label points inward, so it stays on the map.
      const inward = exit.pos.y === 0 ? { x: 0, y: 1 } : exit.pos.y === grid.height - 1 ? { x: 0, y: -1 } : exit.pos.x === 0 ? { x: 1, y: 0 } : { x: -1, y: 0 };
      this.add.text(e.x + inward.x * (T / 2 + 2), e.y + inward.y * (T / 2 + 2), open ? `${arrow} ${exit.name}` : t("{arrow} {name} (coming soon)", { arrow, name: exit.name }), {
        fontFamily: FONT, fontSize: px(10), color: "#f5d76e", backgroundColor: "#10141ccc", padding: { x: 3, y: 1 },
      }).setOrigin(inward.x === 0 ? 0.5 : inward.x > 0 ? 0 : 1, inward.y === 0 ? 0.5 : inward.y > 0 ? 0 : 1).setDepth(6);
    }
    g.lineStyle(1, 0x000000, 0.15);
    for (let x = 0; x <= grid.width; x++) g.lineBetween(MAP_X + x * T, MAP_Y, MAP_X + x * T, MAP_Y + grid.height * T);
    for (let y = 0; y <= grid.height; y++) g.lineBetween(MAP_X, MAP_Y + y * T, MAP_X + grid.width * T, MAP_Y + y * T);
    this.add.renderTexture(0, 0, this.scale.width, this.scale.height).setOrigin(0).setDepth(-1).draw(g).render();
    g.destroy();
  }

  private render(): void {
    const world = this.world;
    this.markers.removeAll(true);
    this.groupViews.clear();
    // The last camp is where a defeated party wakes up.
    const camp = this.center(world.lastCamp);
    this.markers.add(this.add.triangle(camp.x, camp.y, 0, 16, 8, 0, 16, 16, 0xe8d8b0, 0.85).setStrokeStyle(1, 0x5a4a30));
    for (const p of world.pickups) {
      const { x, y } = this.center(p.pos);
      this.drawPickup(x, y, pickupKind(p, (id) => PROGRESSION.items[id]?.kind));
    }
    for (const raw of world.encounters) {
      const e = effectiveGroup(raw, this.healthy(), this.slots(), this.levelCap());
      const { x, y } = this.center(e.pos);
      // Wild groups are visible: the strongest member stands on the map, with the group size.
      const view = this.add.container(x, y);
      view.add(this.add.ellipse(0, 8, 22, 8, 0xd0021b, 0.6).setStrokeStyle(1, 0xd0021b));
      const leadIdx = e.levels.indexOf(Math.max(...e.levels));
      const lead = wildForm(CONTENT, e.species[leadIdx] ?? e.species[0]!, e.levels[leadIdx] ?? e.levels[0]!, e.id);
      if (hasSprite(lead)) view.add(this.add.sprite(0, 8, `${lead}-idle`).setOrigin(0.5, 0.85).play(animKey(lead, "idle", 0)));
      else view.add(this.add.circle(0, 0, 10, 0xd0021b).setStrokeStyle(2, 0x10141c));
      // A group that has seen the party shows it.
      if (raw.chasing) view.add(this.add.text(-9, -14, "!", { fontFamily: FONT, fontSize: px(13), color: "#10141c", fontStyle: "bold", backgroundColor: "#ff8c42", padding: { x: 3, y: 0 } }).setOrigin(0.5));
      view.add(this.add.text(9, -13, String(e.species.length), {
        fontFamily: FONT, fontSize: px(11), color: "#ffffff", fontStyle: "bold", backgroundColor: "#a0101a", padding: { x: 2, y: 0 },
      }).setOrigin(0.5));
      this.markers.add(view);
      this.groupViews.set(raw.id, view);
    }
    for (const o of currentWorld().obstacles ?? []) {
      if (meets(session.game, o.opensIf)) continue;
      const { x, y } = this.center(o.pos);
      const icon = { cut: "♣", boulder: "●", dark: "☾", guard: "✋", rock: "▲" }[o.kind];
      this.markers.add(this.add.text(x, y, icon, { fontFamily: FONT, fontSize: px(16), color: "#e8ecf4", backgroundColor: "#10141caa", padding: { x: 3, y: 0 } }).setOrigin(0.5));
    }
    for (const n of visibleNpcs(session.game, currentWorld().npcs)) {
      if (n.kind === "wild" && npcDone(session.game, n)) continue;
      const { x, y } = this.center(n.pos);
      const color = { leader: 0xf5d76e, elite: 0xc070ff, champion: 0xc070ff, rival: 0x4a90e2, rocket: 0xd0021b, trainer: 0xe8ecf4, talk: 0x7ed321, gift: 0x7ed321, wild: 0xff8c42 }[n.kind];
      this.markers.add(this.add.ellipse(x, y + 8, 22, 8, color, 0.7).setStrokeStyle(1, 0x10141c));
      const lead = teamOf(session.game, n)[0]?.species;
      if (!n.sprite && n.kind !== "wild" && lead) {
        // A trainer: the person, and their lead Pokémon small at their side.
        if (hasSprite(lead)) this.markers.add(this.add.sprite(x + 9, y + 9, `${lead}-idle`).setOrigin(0.5, 0.85).setScale(0.55).play(animKey(lead, "idle", 0)));
        this.markers.add(this.add.image(x - 3, y + 9, trainerTexture(this, trainerLook(n.name, n.kind))).setOrigin(0.5, 1).setScale(1.25));
      } else if ((n.sprite ?? lead) && hasSprite((n.sprite ?? lead)!)) {
        const sprite = (n.sprite ?? lead)!;
        this.markers.add(this.add.sprite(x, y + 8, `${sprite}-idle`).setOrigin(0.5, 0.85).play(animKey(sprite, "idle", 0)));
      } else this.markers.add(this.add.image(x, y + 9, trainerTexture(this, trainerLook(n.name, n.kind))).setOrigin(0.5, 1).setScale(1.25));
      // Bubble: "!" wants a battle, "…" has something to say, "★" has a gift; gone once done.
      const done = npcDone(session.game, n);
      const bubble = done ? null : isBattler(n) ? "!" : n.kind === "gift" || n.choices?.length || n.reward ? "★" : "…";
      if (bubble) this.markers.add(this.add.text(x, y - 20, bubble, { fontFamily: FONT, fontSize: px(12), color: "#10141c", fontStyle: "bold", backgroundColor: bubble === "!" ? "#f5d76e" : "#ffffff", padding: { x: 3, y: 0 } }).setOrigin(0.5));
    }
    const c = this.center(world.pos);
    if (!this.moving) this.token.setPosition(c.x, c.y);
    this.renderHud();
  }

  /** What the party can pass now: NPC and obstacle tiles are blocked; water opens with Surf. */
  private access(): WorldAccess {
    const def = currentWorld();
    return { blocked: blockedTiles(session.game, def.npcs, def.obstacles), surf: fieldMoveUsable(session.game, "surf") };
  }

  private npcAt(t: Point): NpcDef | undefined {
    return visibleNpcs(session.game, currentWorld().npcs).find((n) => samePoint(n.pos, t) && !(n.kind === "wild" && npcDone(session.game, n)));
  }

  /** Walks next to an NPC (if needed) and talks to it. */
  private async approach(npc: NpcDef): Promise<void> {
    if (this.moving) return;
    const near = (p: Point) => Math.abs(p.x - npc.pos.x) + Math.abs(p.y - npc.pos.y) === 1;
    if (!near(this.world.pos)) {
      const options = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]
        .map((d) => ({ x: npc.pos.x + d.x, y: npc.pos.y + d.y }))
        .map((p) => ({ p, path: worldGrid(WORLD_CONTENT, currentWorld()).inBounds(p) ? travelPath(WORLD_CONTENT, currentWorld(), this.world, p, this.access()) : null }))
        .filter((o) => o.path)
        .sort((a, b) => a.path!.length - b.path!.length);
      if (!options.length) return;
      const mapId = this.world.mapId;
      await this.travelTo(options[0]!.p);
      if (!this.scene.isActive() || this.world.mapId !== mapId || !near(this.world.pos)) return;
    }
    this.openDialog(npc);
  }

  /** A few lines for a new game: what this is and how to play. */
  private showIntro(): void {
    this.closeDialog();
    const w = 600;
    const x0 = MAP_X + 30, y0 = MAP_Y + 40;
    const text = new RichText(this, x0 + 16, y0 + 12, w - 32, 13);
    const fatigue = tag("bad", t("fatigue"));
    const h = text.setMarkup([
      tag("title", t("Welcome to Pokémon Wildfront!")),
      t("A tactics journey through Kanto: travel the map, fight wild Pokémon and trainers in turn-based battles, and earn the 8 badges."),
      "",
      `${tag("num", t("Map:"))} ${PHONE
        ? t("Tap twice (or drag) a tile to walk. Walking adds {fatigue}; rest at camp or heal at a Pokémon Center. A red ring marks a wild group: walk into it to battle.", { fatigue })
        : t("Click a tile to walk. Walking adds {fatigue}; rest at camp or heal at a Pokémon Center. A red ring marks a wild group: walk into it to battle.", { fatigue })}`,
      `${tag("num", t("Battle:"))} ${t("place up to 3 Pokémon on the blue spots. On a turn a Pokémon can walk, use one basic attack, and use its skills whenever they are off cooldown. Tap a foe to see how far it can reach.")}`,
      `${tag("num", t("Grow:"))} ${t("Pokémon level up, choose a focus at Lv 3 and masteries later (Camp → a Pokémon). Weaken wild Pokémon and throw a ball to catch them.")}`,
      tag("dim", t("Three knockouts and a Pokémon is gone for good, so retreat in time.")),
    ].join("\n")) + 60;
    const items: Phaser.GameObjects.GameObject[] = [
      this.add.rectangle(x0, y0, w, h, 0x10141c, 0.97).setOrigin(0).setStrokeStyle(2, 0xf5d76e).setInteractive(),
      text,
      new Button(this, x0 + w / 2 - 90, y0 + h - 40, 180, 28, t("Let's go!"), () => {
        this.closeDialog();
        showTip(this, "map");
      }).setHighlighted(true),
    ];
    this.dialog = this.add.container(0, 0, items).setDepth(30);
  }

  private closeDialog(): void {
    this.dialog?.destroy();
    this.dialog = null;
  }

  /** The NPC's lines and what can be done: battle, accept a gift, pick one of several rewards. */
  private openDialog(npc: NpcDef): void {
    this.closeDialog();
    const g = session.game;
    const done = npcDone(g, npc);
    const ready = meets(g, npc.requires);
    const lines = done ? (npc.afterText ?? npc.text ?? []) : ready ? (npc.text ?? []) : (npc.lockedText ?? npc.text ?? []);
    const w = 560;
    const x0 = MAP_X + 56, y0 = MAP_Y + 250;
    const items: Phaser.GameObjects.GameObject[] = [];
    const text = new RichText(this, x0 + 16, y0 + 12, w - 32, 13);
    const h = text.setMarkup([tag("title", npc.name), ...lines].join("\n")) + 64;
    items.push(this.add.rectangle(x0, y0, w, h, 0x10141c, 0.96).setOrigin(0).setStrokeStyle(2, 0xf5d76e).setInteractive(), text);
    const buttons: [string, () => void][] = [];
    if (!done && ready) {
      if (isBattler(npc)) buttons.push([t("Battle!"), () => this.startNpcBattle(npc)]);
      else if (npc.choices?.length) npc.choices.forEach((c, i) => buttons.push([c.label, () => this.finishNpc(npc, i)]));
      else buttons.push([t("OK"), () => this.finishNpc(npc)]);
    }
    buttons.push([done || !ready || !isBattler(npc) ? t("Close") : t("Not now"), () => this.closeDialog()]);
    const bw = Math.min(170, (w - 32 - (buttons.length - 1) * 8) / buttons.length);
    buttons.forEach(([label, fn], i) => items.push(new Button(this, x0 + 16 + i * (bw + 8), y0 + h - 40, bw, 28, label, fn)));
    this.dialog = this.add.container(0, 0, items).setDepth(30);
    sfx(this, "talk");
  }

  private finishNpc(npc: NpcDef, choice?: number): void {
    const reward = choice !== undefined ? npc.choices?.[choice]?.reward : npc.reward;
    const granted = grantGifts(completeNpc(session.game, npc, choice, PROGRESSION.rules.ev), reward);
    const game = granted.game;
    const evGain = (game.ev ?? 0) - (session.game.ev ?? 0);
    const notes = evGain ? [...granted.notes, `+${evGain} EV`] : granted.notes;
    session.update(game);
    this.closeDialog();
    if (notes.length) sfx(this, "pickup");
    this.message = tag("good", notes.length ? notes.join(" ") : t("{name}: done.", { name: npc.name }));
    this.render();
  }

  /** What was just picked up, framed over the map for a few seconds (the status line changes as soon as you walk on). */
  private lootToast(found: readonly string[]): void {
    const text = this.add.text(0, 0, t("Found {items}!", { items: found.join(", ") }), {
      fontFamily: FONT, fontSize: px(14), color: "#f5d76e", fontStyle: "bold", align: "center", wordWrap: { width: 360 },
    }).setOrigin(0.5);
    const w = text.width + 28, h = text.height + 16;
    const box = this.add.rectangle(0, 0, w, h, 0x10141c, 0.92).setStrokeStyle(2, 0xf5d76e);
    const toast = this.add.container(this.scale.width / 2, 92, [box, text]).setDepth(40).setAlpha(0);
    this.tweens.add({ targets: toast, alpha: 1, y: 84, duration: 180 });
    this.tweens.add({ targets: toast, alpha: 0, delay: 3200, duration: 500, onComplete: () => toast.destroy() });
  }

  private startNpcBattle(npc: NpcDef): void {
    this.closeDialog();
    const def = currentWorld();
    const biomeId = npc.arena ?? biomeAt(WORLD_CONTENT, def, npc.pos).id;
    const base = WORLD_CONTENT.biomes[biomeId]?.arena ?? WORLD_CONTENT.biomes.route!.arena!;
    // Wild bosses stand in the middle; trainers face the party across the field.
    const enemyCount = teamOf(session.game, npc).length;
    const arena = battleArena(base, biomeId, (Date.now() >>> 0) ^ npc.pos.x * 31 ^ npc.pos.y, npc.kind === "wild" ? "boss" : "trainer", this.slots(), enemyCount);
    const scenario = { ...trainerScenario(session.game, npc, arena, (mon) => trainerSetup(CONTENT, PROGRESSION, mon), this.slots()), name: `${npc.name} · ${formationLabel(arena.formation)}` };
    sfx(this, "encounter");
    this.scene.start("Battle", { scenario, npcId: npc.id, mapId: def.id, biome: biomeId });
  }

  /** Pickup markers by what they hold: ★ rare one-time find, ◆ held item, Poké Ball, ✚ healing, berry. */
  private drawPickup(x: number, y: number, kind: PickupKind): void {
    const g = this.add.graphics();
    this.markers.add(g);
    if (kind === "rare") {
      g.fillStyle(0xf5d76e, 0.35).fillCircle(x, y, 10);
      const pts = Array.from({ length: 10 }, (_, i) => {
        const r = i % 2 ? 3.5 : 8;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        return new Phaser.Math.Vector2(x + r * Math.cos(a), y + r * Math.sin(a));
      });
      g.fillStyle(0xf5d76e).fillPoints(pts, true).lineStyle(1, 0x7a5a10).strokePoints(pts, true);
    } else if (kind === "held") {
      const pts = [new Phaser.Math.Vector2(x, y - 7), new Phaser.Math.Vector2(x + 6, y), new Phaser.Math.Vector2(x, y + 7), new Phaser.Math.Vector2(x - 6, y)];
      g.fillStyle(0x4ad6e0).fillPoints(pts, true).lineStyle(2, 0x10141c).strokePoints(pts, true);
    } else if (kind === "ball") {
      this.markers.add(this.add.image(x, y, ballIcon(this, "poke-ball")).setDisplaySize(14, 14));
    } else if (kind === "heal") {
      g.fillStyle(0x7ed321).fillCircle(x, y, 6.5).lineStyle(1.5, 0x10141c).strokeCircle(x, y, 6.5);
      g.fillStyle(0xffffff).fillRect(x - 1.5, y - 4, 3, 8).fillRect(x - 4, y - 1.5, 8, 3);
    } else {
      g.fillStyle(0x3f9c35).fillEllipse(x + 2, y - 6, 6, 3);
      g.fillStyle(0xc03070).fillCircle(x, y + 1, 5.5).lineStyle(1.5, 0x10141c).strokeCircle(x, y + 1, 5.5);
    }
  }

  private renderHud(): void {
    const { world, roster, inventory } = session.game;
    const level = fatigueLevel(WORLD_CONTENT.fatigue, world.fatigue);
    const over = level.movePenalty > 0 || level.damageMultiplier !== 1;
    const levelKey = over ? "bad" : world.fatigue >= WORLD_CONTENT.fatigue.max * 0.75 ? "num" : "good";
    const effect = level.movePenalty || level.damageMultiplier !== 1
      ? [level.movePenalty ? t("−{n} movement", { n: level.movePenalty }) : "", level.damageMultiplier !== 1 ? t("−{n}% damage", { n: Math.round((1 - level.damageMultiplier) * 100) }) : ""].filter(Boolean).join(", ")
      : t("no penalty until {max}", { max: WORLD_CONTENT.fatigue.max });
    const bar = "█".repeat(Math.round(world.fatigue / 10)) + "░".repeat(10 - Math.round(world.fatigue / 10));
    const here = biomeAt(WORLD_CONTENT, currentWorld(), world.pos);
    const lines = [
      // Compact: phones show the HUD at about two thirds of its size, so every line counts.
      `${tag("title", t("Fatigue"))} ${tag(levelKey, `${world.fatigue}/${WORLD_CONTENT.fatigue.max} ${level.name}`)} ${tag(levelKey, bar)}`,
      ...(over ? [tag("bad", t("In battle: {effect}", { effect }))] : []),
      `${tag("title", t("Badges"))} ${tag("num", `${(session.game.badges ?? []).length}/${BADGES.length}`)}${(session.game.keyItems ?? []).length ? `  ${tag("title", t("Key items"))} ${tag("num", (session.game.keyItems ?? []).length)}` : ""}`,
      ...(currentGoal(session.game, STORY_STEPS) ? [tag("dim", t("Goal: {goal}", { goal: currentGoal(session.game, STORY_STEPS)! }))] : []),
    ];
    // One item a line: the column beside the party grid is narrow.
    const lower = [
      `${tag("num", `₽${session.game.money}`)}  ${tag("title", "EV")} ${tag("num", session.game.ev ?? 0)}`,
      `${tag("title", t("Rare Candy"))} ${tag("num", inventory.items.candy ?? 0)}`,
      `${tag("title", CONTENT.terms.food)} ${tag("num", Object.entries(inventory.items).filter(([id]) => PROGRESSION.items[id]?.kind === "food").reduce((n, [, c]) => n + c, 0))}`,
      `${tag("title", t("Meal"))} ${world.meal ? tag(world.meal.id === "hungry" ? "bad" : "good", world.meal.name) : tag("dim", t("none"))}`,
    ];
    const h = this.hud.setMarkup(lines.join("\n"));
    let y = 16 + h + 6;
    const stripTop = y;
    const below = this.partyStrip(y);
    this.statsText.setY(stripTop - 2);
    const statsH = this.statsText.setMarkup(lower.join("\n"));
    // The balls as their icons with the count, under the stats.
    this.ballBox.setY(stripTop + statsH + 2);
    const balls = Object.keys(CONTENT.balls).map((id) => `${id}:${inventory.balls[id] ?? 0}`).join("|");
    if (balls !== this.ballKey) {
      this.ballKey = balls;
      this.ballBox.removeAll(true);
      Object.keys(CONTENT.balls).forEach((id, i) => {
        const n = inventory.balls[id] ?? 0;
        this.ballBox.add(this.add.image(i * 38 + 8, 8, ballIcon(this, id)).setDisplaySize(16, 16).setAlpha(n > 0 ? 1 : 0.4));
        this.ballBox.add(this.add.text(i * 38 + 18, 1, `${n}`, { fontFamily: FONT, fontSize: px(12), color: n > 0 ? "#f5d76e" : COLORS.dim }));
      });
    }
    y = Math.max(below, stripTop + statsH + 24);
    // The latest message (path preview, heal, errors) sits right under the stats, so it never falls off small screens.
    this.msgText.setY(y);
    const mh = this.msgText.setMarkup(this.message);
    if (mh) y += mh + 8;
    this.btnBox.setY(y);
    const pending = roster.party.some((m) => pendingChoice(CONTENT, PROGRESSION, m) || m.unspentPoints > 0);
    const spawns = spawnsAt(WORLD_CONTENT, currentWorld(), this.spawnSpot());
    const hurt = roster.party.some((m) => m.hp < memberMaxHp(CONTENT, PROGRESSION, m));
    const cost = centerTreatmentCost(session.game, CAMP.treatmentPerMark);
    const key = [pending, this.moving, spawns.length > 0, this.spawnPanel !== null, here.id, hurt, cost, session.game.money >= cost].join("|");
    if (key === this.btnKey) return;
    this.btnKey = key;
    this.btnBox.removeAll(true);
    let by = 0;
    // Buttons two to a row to keep the column short.
    const half = (x: number, label: string, onClick: () => void) => {
      const b = new Button(this, x, by, 116, 28, label, onClick);
      this.btnBox.add(b);
      return b;
    };
    // One button: the camp screen manages the party, and resting there is a separate choice.
    half(0, pending ? t("★ Camp") : t("⛺ Camp"), () => this.scene.start("Party", { rested: false, choosingMeal: false })).setEnabled(!this.moving).setHighlighted(pending);
    half(124, t("🎒 Bag"), () => this.scene.start("Inventory", { from: "Overworld" })).setEnabled(!this.moving);
    by += 34;
    this.btnBox.add(new Button(this, 0, by, 240, 28, this.spawnPanel ? t("✕ Close wild Pokémon list") : t("🔍 Wild Pokémon here [I]"), () => this.toggleSpawnPanel())
      .setEnabled(spawns.length > 0 || this.spawnPanel !== null));
    by += 34;
    if (here.id === "town") {
      half(0, t("❤ Heal"), () => {
        session.update(centerHeal(CONTENT, PROGRESSION, session.game));
        sfx(this, "heal");
        this.message = tag("heal", t("Your team is fully healed!"));
        this.render();
      }).setEnabled(hurt && !this.moving);
      half(124, cost ? t("✚ KO ₽{cost}", { cost }) : t("✚ KO marks"), () => {
        try {
          session.update(centerTreatment(session.game, CAMP.treatmentPerMark));
          sfx(this, "heal");
          this.message = tag("heal", t("All knockout marks treated."));
        } catch (e) {
          this.message = tag("bad", e instanceof Error ? t(e.message) : t("Cannot treat."));
        }
        this.render();
      }).setEnabled(cost > 0 && session.game.money >= cost && !this.moving);
      by += 34;
      this.btnBox.add(new Button(this, 0, by, 240, 28, t("🛒 Poké Mart"), () => this.scene.start("Shop", {})));
      by += 34;
    }
    this.btnBox.add(new Button(this, 0, by, 76, 28, t("⌂ Title"), () => this.scene.start("Title")));
    this.btnBox.add(new Button(this, 84, by, 32, 28, "?", () => showHelp(this)).centerLabel());
    const full = addFullscreenButton(this, 124, by, 116);
    if (full) this.btnBox.add(full);
  }

  private announceArea(p: Point): void {
    const name = areaName(WORLD_CONTENT, currentWorld(), p);
    this.toast(biomeAt(WORLD_CONTENT, currentWorld(), p).id === "town" ? `${name}\n${CONTENT.terms.healCenter} · Poké Mart` : name);
  }

  /** Where the wild list looks (see spawnSpotNear). */
  private spawnSpot(): Point {
    return spawnSpotNear(WORLD_CONTENT, currentWorld(), session.game.world.pos);
  }

  /** Lists what can spawn in the current area with its share and levels; unmet species stay "???". */
  private toggleSpawnPanel(): void {
    if (this.spawnPanel) {
      this.spawnPanel.destroy();
      this.spawnPanel = null;
      this.render();
      return;
    }
    const { world } = session.game;
    const spawns = spawnsAt(WORLD_CONTENT, currentWorld(), this.spawnSpot());
    const known = knownSpecies(session.game);
    const rows = spawns.flatMap((s) => {
      // One row per form met here: a Zubat high enough is already a Golbat, with its own level range.
      const forms: { id: string; min: number; max: number }[] = [];
      for (let lv = s.levels.min; lv <= s.levels.max; lv++) {
        const id = wildForm(CONTENT, s.speciesId, lv);
        const last = forms[forms.length - 1];
        if (last?.id === id) last.max = lv;
        else forms.push({ id, min: lv, max: lv });
      }
      const limit = s.maxPerGroup !== undefined ? tag("dim", t(" · max {n}/group", { n: s.maxPerGroup })) : "";
      return forms.map((f, i) => {
        const sp = CONTENT.species[f.id]!;
        const name = known.has(f.id)
          ? `${sp.types.map((t) => tag(t, "●")).join("")} ${tag("title", sp.name.padEnd(11))}`
          : `  ${tag("dim", "???".padEnd(11))}`;
        const share = i === 0 ? `${Math.round(s.chance * 100)}%` : "";
        return `${name} ${tag("num", share.padStart(4))}  ${tag("dim", f.min === f.max ? `Lv ${f.min}` : `Lv ${f.min}-${f.max}`)}${i === 0 ? limit : ""}`;
      });
    });
    const lines = [
      tag("title", t("Wild Pokémon · {area}", { area: areaName(WORLD_CONTENT, currentWorld(), this.spawnSpot()) })),
      tag("dim", t("Share of wild Pokémon here. Species you have not met yet show as ???.")),
      "",
      ...rows,
      "",
      tag("dim", t("Tap anywhere on this panel to close.")),
    ];
    const w = 420;
    const text = new RichText(this, MAP_X + 16, MAP_Y + 14, w - 32, 12);
    const h = text.setMarkup(lines.join("\n")) + 28;
    const bg = this.add.rectangle(MAP_X, MAP_Y, w, h, 0x10141c, 0.94).setOrigin(0).setStrokeStyle(1, 0x3a4560);
    bg.setInteractive().on("pointerdown", () => this.toggleSpawnPanel());
    this.spawnPanel = this.add.container(0, 0, [bg, text]).setDepth(20);
    this.render();
  }

  /** Floating banner when the party enters a new area. */
  private toast(text: string): void {
    const t = this.add.text(MAP_X + 336, MAP_Y + 30, text, {
      fontFamily: FONT, fontSize: "18px", color: "#f5d76e", align: "center", backgroundColor: "#10141cdd", padding: { x: 14, y: 8 },
    }).setOrigin(0.5).setDepth(20).setAlpha(0);
    this.tweens.add({ targets: t, alpha: 1, y: t.y + 10, duration: 250, yoyo: true, hold: 1600, onComplete: () => t.destroy() });
  }

  /** Walks to a tile, talks to the NPC on it, or explains what blocks it. */
  private act(t: Point): void {
    const npc = this.npcAt(t);
    if (npc) return void this.approach(npc);
    const obstacle = (currentWorld().obstacles ?? []).find((o) => samePoint(o.pos, t) && !meets(session.game, o.opensIf));
    if (obstacle) {
      this.message = tag("dim", obstacle.text);
      return this.renderHud();
    }
    void this.travelTo(t);
  }

  private showPreview(to: Point | null): void {
    this.preview.clear();
    if (!to || this.moving) return;
    const path = travelPath(WORLD_CONTENT, currentWorld(), this.world, to, this.access());
    if (!path) return;
    const grid = worldGrid(WORLD_CONTENT, currentWorld(), this.access());
    let cost = 0;
    this.preview.fillStyle(0xf5d76e, 0.4);
    for (const p of path) {
      cost += grid.terrainAt(p).moveCost!;
      this.preview.fillRect(MAP_X + p.x * T + 4, MAP_Y + p.y * T + 4, T - 8, T - 8);
    }
    const after = Math.min(WORLD_CONTENT.fatigue.max, this.world.fatigue + cost);
    const rawEnc = this.world.encounters.find((e) => samePoint(e.pos, to));
    const enc = rawEnc ? effectiveGroup(rawEnc, this.healthy(), this.slots(), this.levelCap()) : undefined;
    const hint = `${t("{tiles}, fatigue {cost} → {after} ({level})", { tiles: tag("num", t("{n} tiles", { n: path.length })), cost: tag("dmg", `+${cost}`), after, level: fatigueLevel(WORLD_CONTENT.fatigue, after).name })}${enc ? `\n${tag("enemy", t("Wild group — battle!"))}\n${enc.species.map((base, i) => {
      // The form it will fight in: a Lv 10 Zubat is already a Golbat.
      const sp = wildForm(CONTENT, base, enc.levels[i]!, enc.id);
      return `${tag(`foe:${CONTENT.species[sp]!.types[0]}`, CONTENT.species[sp]!.name)} Lv ${enc.levels[i]}`;
    }).join("\n")}` : ""}`;
    this.message = hint;
    this.renderHudSoon();
  }

  /** Rebuilds the HUD on the next frame, so the path preview shows first (the HUD is slow on phones). */
  private renderHudSoon(): void {
    if (this.hudPending) return;
    this.hudPending = true;
    this.time.delayedCall(0, () => {
      this.hudPending = false;
      this.renderHud();
    });
  }

  /**
   * Walks the path one tile at a time; after every step the wild groups take theirs (stepGroups), so
   * a group can cut the walk short. Walking into a group is the party's attack; a chaser catching the
   * party starts the battle as the group's ambush.
   */
  private async travelTo(to: Point): Promise<void> {
    if (this.moving || samePoint(to, this.world.pos)) return;
    const path = travelPath(WORLD_CONTENT, currentWorld(), this.world, to, this.access());
    if (!path) return;
    if (this.spawnPanel) this.toggleSpawnPanel();
    const before = this.world.pos;
    this.moving = true;
    this.preview.clear();
    let inventory = session.game.inventory;
    const found: string[] = [];
    let encounter: EncounterGroup | null = null;
    let ambush = false;
    for (const step of path) {
      const there = this.world.encounters.find((e) => samePoint(e.pos, step));
      if (there) {
        encounter = there;
        break;
      }
      if (!travelPath(WORLD_CONTENT, currentWorld(), this.world, step, this.access())) break;
      const c = this.center(step);
      const result = travel(WORLD_CONTENT, currentWorld(), this.world, step, this.access());
      const groups = stepGroups(WORLD_CONTENT, currentWorld(), result.world, this.access());
      if (this.leader) this.leaderSprite?.play(animKey(this.leader, "walk", facingFor(c.x - this.token.x, c.y - this.token.y)), true);
      // The party and the groups that move glide together.
      const glides = groups.world.encounters.flatMap((g) => {
        const view = this.groupViews.get(g.id);
        const to = this.center(g.pos);
        return view && (view.x !== to.x || view.y !== to.y) ? [new Promise<void>((resolve) => this.tweens.add({ targets: view, x: to.x, y: to.y, duration: STEP_MS, onComplete: () => resolve() }))] : [];
      });
      await Promise.all([new Promise<void>((resolve) => this.tweens.add({ targets: this.token, x: c.x, y: c.y, duration: STEP_MS, onComplete: () => resolve() })), ...glides]);
      for (const p of result.pickedUp) {
        const balls = { ...inventory.balls };
        const items = { ...inventory.items };
        for (const [id, n] of Object.entries(p.balls ?? {})) {
          balls[id] = (balls[id] ?? 0) + n;
          found.push(`${n} ${CONTENT.balls[id]?.name ?? id}`);
        }
        for (const [id, n] of Object.entries(p.items ?? {})) {
          items[id] = (items[id] ?? 0) + n;
          found.push(`${n} ${PROGRESSION.items[id]?.name ?? id}`);
        }
        inventory = { ...inventory, balls, items };
      }
      session.update({ ...session.game, inventory, world: groups.world });
      // Only redraw when a group's alert changed (redrawing restarts the idle animations).
      if (groups.world.encounters.some((g, i) => g.chasing !== result.world.encounters[i]?.chasing)) this.render();
      if (groups.caught) {
        encounter = groups.caught;
        ambush = true;
        break;
      }
      if (exitAt(currentWorld(), step)?.to) break;
    }
    if (this.leader) this.leaderSprite?.play(animKey(this.leader, "idle", 0), true);
    this.moving = false;
    const stopAt = this.world.pos;
    this.message = found.length ? tag("good", t("Found {items}!", { items: found.join(", ") })) : "";
    if (found.length) {
      sfx(this, "pickup");
      this.lootToast(found);
    }
    const exit = !encounter ? exitAt(currentWorld(), stopAt) : undefined;
    if (exit?.to && WORLDS[exit.to] && !meets(session.game, exit.requires)) {
      this.message = tag("bad", exit.lockedText ?? t("The way is shut for now."));
    } else if (exit?.to && WORLDS[exit.to]) {
      // Through the exit: the next map starts fresh around the arrival point.
      const target = WORLDS[exit.to]!;
      session.update({ ...session.game, world: changeMap(WORLD_CONTENT, session.game.world, target, exit.arrive ?? target.start) });
      sfx(this, "warp");
      this.scene.start("Overworld", { message: this.message });
      return;
    }
    if (areaName(WORLD_CONTENT, currentWorld(), stopAt) !== areaName(WORLD_CONTENT, currentWorld(), before)) {
      sfx(this, "warp");
      this.announceArea(stopAt);
    }
    this.render();

    if (encounter) {
      const group = encounter;
      const scenario = wildScenario(WORLD_CONTENT, effectiveGroup(group, this.healthy(), this.slots(), this.levelCap()), (s, lv) => wildSetup(CONTENT, PROGRESSION, s, lv, group.id), this.slots(), Date.now() >>> 0, ambush);
      sfx(this, "encounter");
      this.scene.start("Battle", { scenario, encounterId: group.id, biome: group.biome });
    }
  }

}
