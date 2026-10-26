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
  type PickupKind,
  type WorldAccess,
  type WorldState,
} from "../../core/expedition";
import { samePoint, type Point } from "../../core/grid";
import { centerHeal, centerTreatment, centerTreatmentCost, KNOCKOUTS_TO_DEATH, knownSpecies, memberMaxHp, restAll } from "../../core/party";
import { MAX_ACTIVE_UNITS } from "../../core/battle";
import { battleArena, formationLabel } from "../../core/battle/arenaGen";
import { currentWorld, session } from "../session";
import { animKey, facingFor, hasSprite, portraitKey } from "../sprites";
import { Button } from "../ui/Button";
import { addFullscreenButton } from "../ui/fullscreen";
import { tag } from "../ui/markup";
import { RichText } from "../ui/RichText";
import { COLORS, FONT, PHONE, TYPE_COLORS, px } from "../ui/theme";

const T = 28;
const MAP_X = 16;
const MAP_Y = 60;
const HUD_X = 704;
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

export class OverworldScene extends Phaser.Scene {
  private token!: Phaser.GameObjects.Container;
  private markers!: Phaser.GameObjects.Container;
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
  /** The dialogue box with an NPC, while open. */
  private dialog: Phaser.GameObjects.Container | null = null;
  /** The "wild Pokémon here" panel over the map, while open. */
  private spawnPanel: Phaser.GameObjects.Container | null = null;

  constructor() {
    super("Overworld");
  }

  init(data: { message?: string }): void {
    this.message = data?.message ?? "";
    this.moving = false;
  }

  create(): void {
    playMusic(this, "overworld");
    this.add.text(MAP_X, 16, currentWorld().name, { fontFamily: FONT, fontSize: "20px", color: "#f5d76e" });
    this.add.text(MAP_X, 40, PHONE ? "Tap twice or drag to walk · red ring: wild group · ★ ◆ ✚ pickups" : "Click to walk. Red ring: wild group. Pickups: ★ rare · ◆ held item · ✚ heal · M: sound on/off", {
      fontFamily: FONT, fontSize: px(11), color: COLORS.dim, wordWrap: { width: 672 },
    });
    this.drawMap();
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
      if (!this.moving && (this.spawnPanel || spawnsAt(WORLD_CONTENT, currentWorld(), this.world.pos).length)) this.toggleSpawnPanel();
    });
    this.render();
    this.announceArea(this.world.pos);
  }

  /** The party as a row of portraits with HP bars; tap one to open the camp screen. Returns the y below it. */
  private partyStrip(y: number): number {
    const size = 36, gap = 4;
    session.game.roster.party.forEach((m, i) => {
      const x = i * (size + gap);
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
      this.buttons.add(parts);
    });
    return y + size + 12;
  }

  /** Party members able to fight; wild groups never outnumber them (see effectiveGroup). */
  private slots(): number {
    return currentWorld().deploySlots ?? MAX_ACTIVE_UNITS;
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
    const g = this.add.graphics();
    for (let y = 0; y < grid.height; y++)
      for (let x = 0; x < grid.width; x++) {
        const id = grid.terrainAt({ x, y }).id;
        g.fillStyle(biomeColor(id), 1).fillRect(MAP_X + x * T, MAP_Y + y * T, T, T);
        if (id === "mountain") g.fillStyle(0x9a8a72, 1).fillTriangle(MAP_X + x * T + 6, MAP_Y + y * T + 22, MAP_X + x * T + 14, MAP_Y + y * T + 7, MAP_X + x * T + 22, MAP_Y + y * T + 22);
        if (id === "trees") g.fillStyle(0x2a5a2e, 1).fillCircle(MAP_X + x * T + 14, MAP_Y + y * T + 14, 10);
        if (id === "forest") g.fillStyle(0x3f8a45, 1).fillTriangle(MAP_X + x * T + 9, MAP_Y + y * T + 20, MAP_X + x * T + 14, MAP_Y + y * T + 8, MAP_X + x * T + 19, MAP_Y + y * T + 20);
        if (id === "town") {
          g.fillStyle(0xe8e0d0, 1).fillRect(MAP_X + x * T + 8, MAP_Y + y * T + 13, 12, 9);
          g.fillStyle(0xc0392b, 1).fillTriangle(MAP_X + x * T + 6, MAP_Y + y * T + 14, MAP_X + x * T + 14, MAP_Y + y * T + 6, MAP_X + x * T + 22, MAP_Y + y * T + 14);
        }
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
      this.add.text(e.x + inward.x * (T / 2 + 2), e.y + inward.y * (T / 2 + 2), `${arrow} ${exit.name}${open ? "" : " (coming soon)"}`, {
        fontFamily: FONT, fontSize: px(10), color: "#f5d76e", backgroundColor: "#10141ccc", padding: { x: 3, y: 1 },
      }).setOrigin(inward.x === 0 ? 0.5 : inward.x > 0 ? 0 : 1, inward.y === 0 ? 0.5 : inward.y > 0 ? 0 : 1).setDepth(6);
    }
    g.lineStyle(1, 0x000000, 0.15);
    for (let x = 0; x <= grid.width; x++) g.lineBetween(MAP_X + x * T, MAP_Y, MAP_X + x * T, MAP_Y + grid.height * T);
    for (let y = 0; y <= grid.height; y++) g.lineBetween(MAP_X, MAP_Y + y * T, MAP_X + grid.width * T, MAP_Y + y * T);
  }

  private render(): void {
    const world = this.world;
    this.markers.removeAll(true);
    // The last camp is where a defeated party wakes up.
    const camp = this.center(world.lastCamp);
    this.markers.add(this.add.triangle(camp.x, camp.y, 0, 16, 8, 0, 16, 16, 0xe8d8b0, 0.85).setStrokeStyle(1, 0x5a4a30));
    for (const p of world.pickups) {
      const { x, y } = this.center(p.pos);
      this.drawPickup(x, y, pickupKind(p, (id) => PROGRESSION.items[id]?.kind));
    }
    for (const raw of world.encounters) {
      const e = effectiveGroup(raw, this.healthy(), this.slots());
      const { x, y } = this.center(e.pos);
      // Wild groups are visible: the strongest member stands on the map, with the group size.
      this.markers.add(this.add.ellipse(x, y + 8, 22, 8, 0xd0021b, 0.6).setStrokeStyle(1, 0xd0021b));
      const leadIdx = e.levels.indexOf(Math.max(...e.levels));
      const lead = wildForm(CONTENT, e.species[leadIdx] ?? e.species[0]!, e.levels[leadIdx] ?? e.levels[0]!);
      if (hasSprite(lead)) this.markers.add(this.add.sprite(x, y + 8, `${lead}-idle`).setOrigin(0.5, 0.85).play(animKey(lead, "idle", 0)));
      else this.markers.add(this.add.circle(x, y, 10, 0xd0021b).setStrokeStyle(2, 0x10141c));
      this.markers.add(this.add.text(x + 9, y - 13, String(e.species.length), {
        fontFamily: FONT, fontSize: px(11), color: "#ffffff", fontStyle: "bold", backgroundColor: "#a0101a", padding: { x: 2, y: 0 },
      }).setOrigin(0.5));
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
      const sprite = n.sprite ?? teamOf(session.game, n)[0]?.species;
      if (sprite && hasSprite(sprite)) this.markers.add(this.add.sprite(x, y + 8, `${sprite}-idle`).setOrigin(0.5, 0.85).play(animKey(sprite, "idle", 0)));
      else this.markers.add(this.add.circle(x, y, 9, color).setStrokeStyle(2, 0x10141c));
      const done = npcDone(session.game, n);
      if (!done && isBattler(n)) this.markers.add(this.add.text(x, y - 15, "!", { fontFamily: FONT, fontSize: px(13), color: "#10141c", fontStyle: "bold", backgroundColor: "#f5d76e", padding: { x: 3, y: 0 } }).setOrigin(0.5));
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
      if (isBattler(npc)) buttons.push([npc.kind === "wild" ? "Battle!" : "Battle!", () => this.startNpcBattle(npc)]);
      else if (npc.choices?.length) npc.choices.forEach((c, i) => buttons.push([c.label, () => this.finishNpc(npc, i)]));
      else buttons.push(["OK", () => this.finishNpc(npc)]);
    }
    buttons.push([done || !ready || !isBattler(npc) ? "Close" : "Not now", () => this.closeDialog()]);
    const bw = Math.min(170, (w - 32 - (buttons.length - 1) * 8) / buttons.length);
    buttons.forEach(([label, fn], i) => items.push(new Button(this, x0 + 16 + i * (bw + 8), y0 + h - 40, bw, 28, label, fn)));
    this.dialog = this.add.container(0, 0, items).setDepth(30);
    sfx(this, "talk");
  }

  private finishNpc(npc: NpcDef, choice?: number): void {
    const reward = choice !== undefined ? npc.choices?.[choice]?.reward : npc.reward;
    const { game, notes } = grantGifts(completeNpc(session.game, npc, choice), reward);
    session.update(game);
    this.closeDialog();
    if (notes.length) sfx(this, "pickup");
    this.message = tag("good", notes.length ? notes.join(" ") : `${npc.name}: done.`);
    this.render();
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
    this.scene.start("Battle", { scenario, npcId: npc.id, mapId: def.id });
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
      g.fillStyle(0xffffff).fillCircle(x, y, 6);
      g.fillStyle(0xd0021b).slice(x, y, 6, Math.PI, 0, false).fillPath();
      g.lineStyle(1.5, 0x10141c).strokeCircle(x, y, 6).lineBetween(x - 6, y, x + 6, y);
      g.fillStyle(0xffffff).fillCircle(x, y, 1.8);
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
      ? [level.movePenalty ? `−${level.movePenalty} movement` : "", level.damageMultiplier !== 1 ? `−${Math.round((1 - level.damageMultiplier) * 100)}% damage` : ""].filter(Boolean).join(", ")
      : `no penalty until ${WORLD_CONTENT.fatigue.max}`;
    const bar = "█".repeat(Math.round(world.fatigue / 10)) + "░".repeat(10 - Math.round(world.fatigue / 10));
    const here = biomeAt(WORLD_CONTENT, currentWorld(), world.pos);
    const lines = [
      // Compact: phones show the HUD at about two thirds of its size, so every line counts.
      `${tag("title", "Fatigue")} ${tag(levelKey, `${world.fatigue}/${WORLD_CONTENT.fatigue.max} ${level.name}`)} ${tag(levelKey, bar)}`,
      ...(over ? [tag("bad", `In battle: ${effect}`)] : []),
      `${tag("title", "Badges")} ${tag("num", `${(session.game.badges ?? []).length}/${BADGES.length}`)}${(session.game.keyItems ?? []).length ? `  ${tag("title", "Key items")} ${tag("num", (session.game.keyItems ?? []).length)}` : ""}`,
      ...(currentGoal(session.game, STORY_STEPS) ? [tag("dim", `Goal: ${currentGoal(session.game, STORY_STEPS)}`)] : []),
    ];
    const lower = [
      `${tag("num", `₽${session.game.money}`)}  ${tag("title", "Candy")} ${tag("num", inventory.items.candy ?? 0)}  ${tag("title", CONTENT.terms.food)} ${tag("num", Object.entries(inventory.items).filter(([id]) => PROGRESSION.items[id]?.kind === "food").reduce((n, [, c]) => n + c, 0))}`,
      `${tag("title", "Meal")} ${world.meal ? tag(world.meal.id === "hungry" ? "bad" : "good", world.meal.name) : tag("dim", "none")}`,
      `${tag("title", "Bag")} ${Object.entries(inventory.balls).map(([id, n]) => `${CONTENT.balls[id]?.name.replace(" Ball", "") ?? id} ${n}`).join(" · ")}`,
    ];
    const h = this.hud.setMarkup(lines.join("\n"));
    this.buttons.removeAll(true);
    let y = 16 + h + 6;
    y = this.partyStrip(y);
    const stats = new RichText(this, 0, y, 240, 12);
    y += stats.setMarkup(lower.join("\n")) + 8;
    this.buttons.add(stats);
    // The latest message (path preview, heal, errors) sits right under the stats, so it never falls off small screens.
    if (this.message) {
      const msg = new RichText(this, 0, y, 240, 12);
      y += msg.setMarkup(this.message) + 8;
      this.buttons.add(msg);
    }
    // Buttons two to a row to keep the column short.
    const half = (x: number, label: string, onClick: () => void) => {
      const b = new Button(this, x, y, 116, 28, label, onClick);
      this.buttons.add(b);
      return b;
    };
    const pending = roster.party.some((m) => pendingChoice(CONTENT, PROGRESSION, m) || m.unspentPoints > 0);
    // One button: the camp screen manages the party, and resting there is a separate choice.
    half(0, pending ? "★ Camp" : "⛺ Camp", () => this.scene.start("Party", { rested: false, choosingMeal: false })).setEnabled(!this.moving).setHighlighted(pending);
    half(124, "🎒 Bag", () => this.scene.start("Inventory", { from: "Overworld" })).setEnabled(!this.moving);
    y += 34;
    const spawns = spawnsAt(WORLD_CONTENT, currentWorld(), world.pos);
    this.buttons.add(new Button(this, 0, y, 240, 28, this.spawnPanel ? "✕ Close wild Pokémon list" : "🔍 Wild Pokémon here [I]", () => this.toggleSpawnPanel())
      .setEnabled(spawns.length > 0 || this.spawnPanel !== null));
    y += 34;
    if (here.id === "town") {
      const hurt = roster.party.some((m) => m.hp < memberMaxHp(CONTENT, PROGRESSION, m));
      half(0, "❤ Heal", () => {
        session.update(centerHeal(CONTENT, PROGRESSION, session.game));
        sfx(this, "heal");
        this.message = tag("heal", `Your team is fully healed!`);
        this.render();
      }).setEnabled(hurt && !this.moving);
      const cost = centerTreatmentCost(session.game, CAMP.treatmentPerMark);
      half(124, cost ? `✚ KO ₽${cost}` : "✚ KO marks", () => {
        try {
          session.update(centerTreatment(session.game, CAMP.treatmentPerMark));
          sfx(this, "heal");
          this.message = tag("heal", "All knockout marks treated.");
        } catch (e) {
          this.message = tag("bad", e instanceof Error ? e.message : "Cannot treat.");
        }
        this.render();
      }).setEnabled(cost > 0 && session.game.money >= cost && !this.moving);
      y += 34;
      this.buttons.add(new Button(this, 0, y, 240, 28, "🛒 Poké Mart", () => this.scene.start("Shop", {})));
      y += 34;
    }
    half(0, "⌂ Title", () => this.scene.start("Title"));
    const full = addFullscreenButton(this, 124, y, 116);
    if (full) this.buttons.add(full);
  }

  private announceArea(p: Point): void {
    const name = areaName(WORLD_CONTENT, currentWorld(), p);
    this.toast(biomeAt(WORLD_CONTENT, currentWorld(), p).id === "town" ? `${name}\n${CONTENT.terms.healCenter} · Poké Mart` : name);
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
    const spawns = spawnsAt(WORLD_CONTENT, currentWorld(), world.pos);
    const known = knownSpecies(session.game);
    const rows = spawns.map((s) => {
      const sp = CONTENT.species[s.speciesId]!;
      const name = known.has(s.speciesId)
        ? `${sp.types.map((t) => tag(t, "●")).join("")} ${tag("title", sp.name.padEnd(11))}`
        : `  ${tag("dim", "???".padEnd(11))}`;
      const limit = s.maxPerGroup !== undefined ? tag("dim", ` · max ${s.maxPerGroup}/group`) : "";
      return `${name} ${tag("num", `${Math.round(s.chance * 100)}%`.padStart(4))}  ${tag("dim", `Lv ${s.levels.min}-${s.levels.max}`)}${limit}`;
    });
    const lines = [
      tag("title", `Wild Pokémon · ${areaName(WORLD_CONTENT, currentWorld(), world.pos)}`),
      tag("dim", "Share of wild Pokémon here. Species you have not met yet show as ???."),
      "",
      ...rows,
      "",
      tag("dim", "Tap anywhere on this panel to close."),
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

  private showPreview(t: Point | null): void {
    this.preview.clear();
    if (!t || this.moving) return;
    const path = travelPath(WORLD_CONTENT, currentWorld(), this.world, t, this.access());
    if (!path) return;
    const grid = worldGrid(WORLD_CONTENT, currentWorld(), this.access());
    let cost = 0;
    this.preview.fillStyle(0xf5d76e, 0.4);
    for (const p of path) {
      cost += grid.terrainAt(p).moveCost!;
      this.preview.fillRect(MAP_X + p.x * T + 4, MAP_Y + p.y * T + 4, T - 8, T - 8);
    }
    const after = Math.min(WORLD_CONTENT.fatigue.max, this.world.fatigue + cost);
    const rawEnc = this.world.encounters.find((e) => samePoint(e.pos, t));
    const enc = rawEnc ? effectiveGroup(rawEnc, this.healthy()) : undefined;
    const hint = `${tag("num", `${path.length} tiles`)}, fatigue ${tag("dmg", `+${cost}`)} → ${after} (${fatigueLevel(WORLD_CONTENT.fatigue, after).name})${enc ? `\n${tag("enemy", "Wild group — battle!")}\n${enc.species.map((sp, i) => `${tag(`foe:${CONTENT.species[sp]!.types[0]}`, CONTENT.species[sp]!.name)} Lv ${enc.levels[i]}`).join("\n")}` : ""}`;
    this.message = hint;
    this.renderHud();
  }

  private async travelTo(t: Point): Promise<void> {
    if (this.moving || samePoint(t, this.world.pos)) return;
    if (!travelPath(WORLD_CONTENT, currentWorld(), this.world, t, this.access())) return;
    if (this.spawnPanel) this.toggleSpawnPanel();
    const before = this.world.pos;
    const result = travel(WORLD_CONTENT, currentWorld(), this.world, t, this.access());
    this.moving = true;
    this.preview.clear();
    for (const step of result.path) {
      if (result.encounter && samePoint(step, t)) break;
      const c = this.center(step);
      if (this.leader) this.leaderSprite?.play(animKey(this.leader, "walk", facingFor(c.x - this.token.x, c.y - this.token.y)), true);
      await new Promise<void>((resolve) => this.tweens.add({ targets: this.token, x: c.x, y: c.y, duration: STEP_MS, onComplete: () => resolve() }));
    }
    if (this.leader) this.leaderSprite?.play(animKey(this.leader, "idle", 0), true);
    this.moving = false;

    let inventory = session.game.inventory;
    const found: string[] = [];
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
    // An encounter stops the party on the tile next to the wild group.
    const stopAt = result.encounter ? (result.path.length >= 2 ? result.path[result.path.length - 2]! : before) : t;
    session.update({ ...session.game, inventory, world: { ...result.world, pos: stopAt } });
    this.message = found.length ? tag("good", `Found ${found.join(", ")}!`) : "";
    if (found.length) sfx(this, "pickup");
    const exit = !result.encounter ? exitAt(currentWorld(), stopAt) : undefined;
    if (exit?.to && WORLDS[exit.to] && !meets(session.game, exit.requires)) {
      this.message = tag("bad", exit.lockedText ?? "The way is shut for now.");
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

    if (result.encounter) {
      const scenario = wildScenario(WORLD_CONTENT, effectiveGroup(result.encounter, this.healthy(), this.slots()), (s, lv) => wildSetup(CONTENT, PROGRESSION, s, lv), this.slots(), Date.now() >>> 0);
      sfx(this, "encounter");
      this.scene.start("Battle", { scenario, encounterId: result.encounter.id, biome: result.encounter.biome });
    }
  }

}
