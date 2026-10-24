import Phaser from "phaser";
import { CONTENT, WORLD, WORLD_CONTENT } from "../../content";
import { maxHpOf } from "../../core/battle";
import {
  biomeAt,
  fatigueLevel,
  makeCamp,
  travel,
  travelPath,
  worldGrid,
  wildScenario,
  type WorldState,
} from "../../core/expedition";
import { samePoint, type Point } from "../../core/grid";
import { KNOCKOUTS_TO_DEATH, restAll } from "../../core/party";
import { session } from "../session";
import { Button } from "../ui/Button";
import { tag } from "../ui/markup";
import { RichText } from "../ui/RichText";
import { COLORS, FONT, TYPE_COLORS } from "../ui/theme";

const T = 28;
const MAP_X = 16;
const MAP_Y = 60;
const HUD_X = 704;
const STEP_MS = 70;

const BIOME_COLORS: Record<string, number> = {
  route: 0x55704a, forest: 0x2f6b34, mountain: 0x7a6a55, cave: 0x4a4038, town: 0x8a7a62, water: 0x2d5a8c, trees: 0x1d3a20,
};

export class OverworldScene extends Phaser.Scene {
  private token!: Phaser.GameObjects.Container;
  private markers!: Phaser.GameObjects.Container;
  private preview!: Phaser.GameObjects.Graphics;
  private hud!: RichText;
  private buttons!: Phaser.GameObjects.Container;
  private moving = false;
  private message = "";

  constructor() {
    super("Overworld");
  }

  init(data: { message?: string }): void {
    this.message = data?.message ?? "";
    this.moving = false;
  }

  create(): void {
    this.add.text(MAP_X, 16, WORLD.name, { fontFamily: FONT, fontSize: "20px", color: "#f5d76e" });
    this.add.text(MAP_X, 40, "Click a tile to travel. Red markers are wild Pokémon (number = group size). The tent is your last camp.", {
      fontFamily: FONT, fontSize: "11px", color: COLORS.dim,
    });
    this.drawMap();
    this.preview = this.add.graphics();
    this.markers = this.add.container(0, 0);
    this.token = this.add.container(0, 0, [
      this.add.circle(0, 0, 10, 0xf5d76e).setStrokeStyle(2, 0x10141c),
      this.add.text(0, 0, "★", { fontFamily: FONT, fontSize: "12px", color: "#10141c" }).setOrigin(0.5),
    ]).setDepth(5);
    this.hud = new RichText(this, HUD_X, 16, 240, 12);
    this.buttons = this.add.container(HUD_X, 0);

    this.input.on("pointermove", (p: Phaser.Input.Pointer) => this.showPreview(this.tileAt(p)));
    this.input.on("pointerdown", (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (over.length > 0) return;
      const t = this.tileAt(p);
      if (t) void this.travelTo(t);
    });
    this.render();
  }

  private get world(): WorldState {
    return session.game.world;
  }

  private setWorld(world: WorldState): void {
    session.update({ ...session.game, world });
  }

  private tileAt(p: Phaser.Input.Pointer): Point | null {
    const t = { x: Math.floor((p.worldX - MAP_X) / T), y: Math.floor((p.worldY - MAP_Y) / T) };
    return worldGrid(WORLD_CONTENT, WORLD).inBounds(t) ? t : null;
  }

  private center(p: Point) {
    return { x: MAP_X + p.x * T + T / 2, y: MAP_Y + p.y * T + T / 2 };
  }

  private drawMap(): void {
    const grid = worldGrid(WORLD_CONTENT, WORLD);
    const g = this.add.graphics();
    for (let y = 0; y < grid.height; y++)
      for (let x = 0; x < grid.width; x++) {
        const id = grid.terrainAt({ x, y }).id;
        g.fillStyle(BIOME_COLORS[id] ?? 0x333333, 1).fillRect(MAP_X + x * T, MAP_Y + y * T, T, T);
        if (id === "mountain") g.fillStyle(0x9a8a72, 1).fillTriangle(MAP_X + x * T + 6, MAP_Y + y * T + 22, MAP_X + x * T + 14, MAP_Y + y * T + 7, MAP_X + x * T + 22, MAP_Y + y * T + 22);
        if (id === "trees") g.fillStyle(0x2a5a2e, 1).fillCircle(MAP_X + x * T + 14, MAP_Y + y * T + 14, 10);
        if (id === "forest") g.fillStyle(0x3f8a45, 1).fillTriangle(MAP_X + x * T + 9, MAP_Y + y * T + 20, MAP_X + x * T + 14, MAP_Y + y * T + 8, MAP_X + x * T + 19, MAP_Y + y * T + 20);
        if (id === "cave") g.fillStyle(0x221c18, 1).fillCircle(MAP_X + x * T + 14, MAP_Y + y * T + 16, 6);
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
    for (const p of WORLD.pickups) {
      if (world.collected.includes(p.id)) continue;
      const { x, y } = this.center(p.pos);
      this.markers.add(this.add.circle(x, y, 6, 0xffffff).setStrokeStyle(2, 0xd0021b));
    }
    for (const e of world.encounters) {
      const { x, y } = this.center(e.pos);
      this.markers.add(this.add.circle(x, y, 10, 0xd0021b).setStrokeStyle(2, 0x10141c));
      this.markers.add(this.add.text(x, y, String(e.species.length), { fontFamily: FONT, fontSize: "12px", color: "#ffffff", fontStyle: "bold" }).setOrigin(0.5));
    }
    const c = this.center(world.pos);
    if (!this.moving) this.token.setPosition(c.x, c.y);
    this.renderHud();
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
    const here = biomeAt(WORLD_CONTENT, WORLD, world.pos);
    const lines = [
      `${tag("title", "Fatigue")} ${tag(levelKey, `${world.fatigue}/${WORLD_CONTENT.fatigue.max} ${level.name}`)}`,
      tag(levelKey, bar),
      tag("dim", `In battle: ${effect}`),
      "",
      `Here: ${tag("num", here.name)}`,
      "",
      tag("title", "Party"),
      ...roster.party.map((m) => {
        const s = CONTENT.species[m.speciesId]!;
        const hpKey = m.hp === 0 ? "ko" : m.hp / maxHpOf(CONTENT, m.speciesId) > 0.5 ? "heal" : "dmg";
        const pips = "●".repeat(m.knockouts) + "○".repeat(KNOCKOUTS_TO_DEATH - m.knockouts);
        return `${tag(s.types[0]!, s.name.padEnd(11))}${tag(hpKey, m.hp === 0 ? "fainted" : `${m.hp} HP`)} ${tag(m.knockouts ? "ko" : "dim", pips)}`;
      }),
      "",
      `${tag("title", "Bag")} ${Object.entries(inventory.balls).map(([id, n]) => `${CONTENT.balls[id]?.name.replace(" Ball", "") ?? id} ${n}`).join(" · ")}`,
    ];
    const h = this.hud.setMarkup(lines.join("\n"));
    this.buttons.removeAll(true);
    let y = 16 + h + 10;
    const campButton = new Button(this, 0, y, 240, 28, "⛺ Make camp here", () => this.makeCamp());
    campButton.setEnabled(!this.moving);
    this.buttons.add(campButton);
    y += 30;
    const note = this.add.text(0, y, "Restores HP and fatigue. Wild groups move.", { fontFamily: FONT, fontSize: "10px", color: COLORS.dim });
    this.buttons.add(note);
    y += 20;
    this.buttons.add(new Button(this, 0, y, 240, 28, "⌂ Title", () => this.scene.start("Title")));
    y += 40;
    if (this.message) {
      const msg = new RichText(this, 0, y, 240, 12);
      msg.setMarkup(this.message);
      this.buttons.add(msg);
    }
  }

  private showPreview(t: Point | null): void {
    this.preview.clear();
    if (!t || this.moving) return;
    const path = travelPath(WORLD_CONTENT, WORLD, this.world, t);
    if (!path) return;
    const grid = worldGrid(WORLD_CONTENT, WORLD);
    let cost = 0;
    this.preview.fillStyle(0xf5d76e, 0.25);
    for (const p of path) {
      cost += grid.terrainAt(p).moveCost!;
      this.preview.fillRect(MAP_X + p.x * T + 4, MAP_Y + p.y * T + 4, T - 8, T - 8);
    }
    const after = Math.min(WORLD_CONTENT.fatigue.max, this.world.fatigue + cost);
    const enc = this.world.encounters.find((e) => samePoint(e.pos, t));
    const hint = `${tag("num", `${path.length} tiles`)}, fatigue ${tag("dmg", `+${cost}`)} → ${after} (${fatigueLevel(WORLD_CONTENT.fatigue, after).name})${enc ? `\n${tag("enemy", `Wild group of ${enc.species.length} (${biomeAt(WORLD_CONTENT, WORLD, enc.pos).name}) — battle!`)}` : ""}`;
    this.message = hint;
    this.renderHud();
  }

  private async travelTo(t: Point): Promise<void> {
    if (this.moving || samePoint(t, this.world.pos)) return;
    if (!travelPath(WORLD_CONTENT, WORLD, this.world, t)) return;
    const before = this.world.pos;
    const result = travel(WORLD_CONTENT, WORLD, this.world, t);
    this.moving = true;
    this.preview.clear();
    for (const step of result.path) {
      if (result.encounter && samePoint(step, t)) break;
      const c = this.center(step);
      await new Promise<void>((resolve) => this.tweens.add({ targets: this.token, x: c.x, y: c.y, duration: STEP_MS, onComplete: () => resolve() }));
    }
    this.moving = false;

    let inventory = session.game.inventory;
    const found: string[] = [];
    for (const p of result.pickedUp) {
      const balls = { ...inventory.balls };
      for (const [id, n] of Object.entries(p.balls)) {
        balls[id] = (balls[id] ?? 0) + n;
        found.push(`${n} ${CONTENT.balls[id]?.name ?? id}`);
      }
      inventory = { ...inventory, balls };
    }
    // An encounter stops the party on the tile next to the wild group.
    const stopAt = result.encounter ? (result.path.length >= 2 ? result.path[result.path.length - 2]! : before) : t;
    session.update({ ...session.game, inventory, world: { ...result.world, pos: stopAt } });
    this.message = found.length ? tag("good", `Found ${found.join(", ")}!`) : "";
    this.render();

    if (result.encounter) {
      const scenario = wildScenario(WORLD_CONTENT, result.encounter);
      this.scene.start("Battle", { scenario, encounterId: result.encounter.id });
    }
  }

  private makeCamp(): void {
    const world = makeCamp(WORLD_CONTENT, WORLD, this.world);
    session.update({ ...session.game, world, roster: restAll(CONTENT, session.game.roster) });
    this.scene.start("Camp");
  }
}
