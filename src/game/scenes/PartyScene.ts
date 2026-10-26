import Phaser from "phaser";
import { playMusic } from "../music";
import { CAMP, CONTENT, MEALS, PROGRESSION, WORLD_CONTENT } from "../../content";
import { canCook, KNOCKOUTS_TO_DEATH, MAX_PARTY_SIZE, memberMaxHp, rest, type MealDef, type PartyMember } from "../../core/party";
import { describeModifiers } from "../ui/describeEffects";
import { pendingChoice, xpToNext } from "../../core/progression";
import { currentWorld, session } from "../session";
import { portraitKey } from "../sprites";
import { Button } from "../ui/Button";
import { tag } from "../ui/markup";
import { RichText } from "../ui/RichText";
import { COLORS, FONT, TYPE_COLORS, px } from "../ui/theme";

/** Five compact cards per row: the full party of 10 fits in two rows. */
const CARD_COLS = 5;
const CARD_W = 178;
const CARD_H = 150;

/** Camp: party overview (what needs attention) and the choice to rest. Details open per Pokémon. */
export class PartyScene extends Phaser.Scene {
  private rested = false;
  private choosingMeal = false;

  constructor() {
    super("Party");
  }

  init(data: { rested?: boolean; choosingMeal?: boolean }): void {
    this.rested = data?.rested ?? false;
    this.choosingMeal = data?.choosingMeal ?? false;
  }

  /** Recipes with what they need and what they do; cooking one rests the team. */
  private mealChooser(): void {
    const game = session.game;
    const bag = game.inventory.items;
    const food = Object.values(PROGRESSION.items).filter((i) => i.kind === "food");
    new RichText(this, 16, 68, 928, 12).setMarkup(`${tag("title", `Cook a meal (${CONTENT.terms.food.toLowerCase()} in the bag:`)} ${food.map((f) => `${f.name} ${tag("num", bag[f.id] ?? 0)}`).join(" · ")}${tag("title", ")")}`);
    const doRest = (meal: MealDef | null) => {
      session.update(rest(CONTENT, PROGRESSION, { content: WORLD_CONTENT, def: currentWorld() }, CAMP, session.game, meal));
      this.scene.restart({ rested: true });
    };
    Object.values(MEALS).forEach((meal, i) => {
      const x = 16 + (i % 2) * 470;
      const y = 92 + Math.floor(i / 2) * 96;
      const ok = canCook(game, meal);
      this.add.rectangle(x, y, 460, 88, 0x1c2130).setOrigin(0).setStrokeStyle(1, ok ? 0x5a6785 : 0x2a3040);
      const needs = Object.entries(meal.ingredients).map(([id, n]) => {
        const have = bag[id] ?? 0;
        return tag(have >= n ? "good" : "bad", `${n} ${PROGRESSION.items[id]?.name ?? id} (${have})`);
      }).join(", ");
      const effects = [
        ...(meal.bond?.startBond ? [`Battles start with ${tag("good", `+${meal.bond.startBond} ${CONTENT.terms.bond}`)}`] : []),
        ...(meal.bond?.maxBond ? [`${CONTENT.terms.bond} cap ${tag("good", `+${meal.bond.maxBond}`)}`] : []),
        ...describeModifiers(CONTENT, meal.mods ?? {}),
      ];
      new RichText(this, x + 10, y + 6, 330, 12).setMarkup([
        tag("title", meal.name),
        `Needs: ${needs}`,
        `Full rest${effects.length ? `; until the next rest: ${effects.join(", ")}` : ""}`,
      ].join("\n"));
      new Button(this, x + 350, y + 30, 100, 28, "Cook", () => doRest(meal)).setEnabled(ok).setHighlighted(ok);
    });
    const hy = 92 + Math.ceil(Object.keys(MEALS).length / 2) * 96 + 6;
    const h = CAMP.hungry;
    new RichText(this, 16, hy, 700, 12).setMarkup(`${tag("bad", "Rest without eating")}: only ${Math.round(h.hpFraction * 100)}% HP, fatigue stays at ${h.fatigue}, and ${h.effect.description.toLowerCase()}`);
    new Button(this, 734, hy, 210, 26, "Rest hungry", () => doRest(null));
  }

  create(): void {
    playMusic(this, "overworld");
    const { roster, money, inventory, world } = session.game;
    this.add.text(16, 14, "Camp", { fontFamily: FONT, fontSize: "20px", color: "#f5d76e" });
    new RichText(this, 100, 19, 400, 14).setMarkup(`${tag("num", `₽${money}`)}   Candy ${tag("num", inventory.items.candy ?? 0)}   Fatigue ${tag("num", world.fatigue)}`);
    new Button(this, 794, 12, 150, 26, "➜ Back to map", () => this.scene.start("Overworld", {}));
    new Button(this, 474, 12, 150, 26, "🎒 Bag", () => this.scene.start("Inventory", { from: "Party" }));
    // Resting is a decision: pick a meal (or go hungry); wild groups move and this becomes the respawn point.
    new Button(this, 634, 12, 150, 26, this.choosingMeal ? "✕ Cancel" : "⛺ Rest here…", () =>
      this.scene.restart({ rested: this.rested, choosingMeal: !this.choosingMeal })).setEnabled(!this.rested);
    const meal = world.meal;
    new RichText(this, 16, 44, 928, 12).setMarkup(this.rested
      ? tag("good", `Rested${meal && meal.id !== CAMP.hungry.effect.id ? ` and ate ${meal.name}` : " hungry"}. Wild Pokémon have moved; defeat brings you back here.`)
      : meal ? `${tag("dim", "Current meal:")} ${tag("num", meal.name)} ${tag("dim", `— ${(MEALS[meal.id] ?? CAMP.hungry.effect).description}`)}` : tag("dim", "Rest here to restore HP and fatigue with a camp meal."));
    if (this.choosingMeal) {
      this.mealChooser();
      return;
    }

    this.add.text(16, 64, `Party ${roster.party.length}/${MAX_PARTY_SIZE} · tap a Pokémon for stats, masteries, moves and equipment`, {
      fontFamily: FONT, fontSize: px(12), color: COLORS.dim,
    });
    roster.party.forEach((m, i) => this.card(16 + (i % CARD_COLS) * (CARD_W + 10), 84 + Math.floor(i / CARD_COLS) * (CARD_H + 8), m));

    const sy = 84 + 2 * (CARD_H + 8) + 4;
    this.add.text(16, sy, `Storage (${roster.storage.length})`, { fontFamily: FONT, fontSize: px(12), color: COLORS.dim });
    roster.storage.slice(0, 6).forEach((m, i) => this.mini(16 + i * 154, sy + 18, m));
    if (roster.storage.length > 6) this.add.text(16, sy + 62, `+${roster.storage.length - 6} more`, { fontFamily: FONT, fontSize: px(11), color: COLORS.dim });
    if (roster.fallen.length) {
      new RichText(this, 16, 512, 928, 12).setMarkup(`${tag("ko", "Fallen")}: ${roster.fallen.map((m) => CONTENT.species[m.speciesId]!.name).join(", ")}`);
    }
  }

  private open(m: PartyMember): void {
    this.scene.start("Pokemon", { uid: m.uid });
  }

  private portrait(x: number, y: number, size: number, speciesId: string): void {
    if (this.textures.exists(portraitKey(speciesId))) this.add.image(x, y, portraitKey(speciesId)).setOrigin(0).setDisplaySize(size, size);
    else this.add.circle(x + size / 2, y + size / 2, size / 2 - 2, TYPE_COLORS[CONTENT.species[speciesId]!.types[0]!] ?? 0x888888);
  }

  /** A party card: portrait, name, level, types, role, held item, HP bar, knockouts and what is waiting. */
  private card(x: number, y: number, m: PartyMember): void {
    const s = CONTENT.species[m.speciesId]!;
    const pending = pendingChoice(CONTENT, PROGRESSION, m);
    const waiting = [pending === "role" ? "choose role & mastery type" : pending === "talent" ? "learn a mastery" : "", m.unspentPoints ? `${m.unspentPoints} stat point${m.unspentPoints > 1 ? "s" : ""}` : ""].filter(Boolean);
    const bg = this.add.rectangle(x, y, CARD_W, CARD_H, 0x1c2130).setOrigin(0)
      .setStrokeStyle(waiting.length ? 2 : 1, waiting.length ? 0xf5d76e : m.knockouts === 2 ? 0xd0021b : 0x3a4560);
    bg.setInteractive({ useHandCursor: true }).on("pointerdown", () => this.open(m));
    this.portrait(x + 6, y + 6, 40, m.speciesId);

    const max = memberMaxHp(CONTENT, PROGRESSION, m);
    const frac = m.hp / max;
    const role = m.role ? PROGRESSION.roles[m.role]!.name : "no role yet";
    const held = m.heldItem ? PROGRESSION.items[m.heldItem]!.name : "no item";
    const pips = "●".repeat(m.knockouts) + "○".repeat(KNOCKOUTS_TO_DEATH - m.knockouts);
    // Text first; the HP bar goes below however tall the text turned out (fonts are larger on phones).
    new RichText(this, x + 52, y + 6, CARD_W - 58, 12).setMarkup([
      tag("title", s.name),
      `Lv ${tag("num", m.level)} ${tag("dim", `XP ${m.xp}/${xpToNext(PROGRESSION, m.level)}`)}`,
    ].join("\n"));
    const textH = new RichText(this, x + 6, y + 50, CARD_W - 12, 11).setMarkup([
      s.types.map((t) => tag(t, t)).join("/"),
      tag("dim", role),
      tag("dim", held),
    ].join("\n"));
    const barY = y + 50 + textH + 8;
    this.add.rectangle(x + 8, barY, CARD_W - 16, 6, 0x000000).setOrigin(0, 0.5);
    this.add.rectangle(x + 8, barY, (CARD_W - 16) * frac, 6, frac > 0.5 ? 0x7ed321 : frac > 0.25 ? 0xf5a623 : 0xd0021b).setOrigin(0, 0.5);
    new RichText(this, x + 8, barY + 8, CARD_W - 16, 12).setMarkup(
      `${m.hp > 0 ? `HP ${m.hp}/${max}` : tag("ko", "fainted")}  KO ${tag(m.knockouts ? "ko" : "dim", pips)}${waiting.length ? `\n${tag("num", `★ ${waiting.join(", ")}`)}` : ""}`);
  }

  private mini(x: number, y: number, m: PartyMember): void {
    const s = CONTENT.species[m.speciesId]!;
    const bg = this.add.rectangle(x, y, 148, 40, 0x1c2130).setOrigin(0).setStrokeStyle(1, 0x3a4560);
    bg.setInteractive({ useHandCursor: true }).on("pointerdown", () => this.open(m));
    this.portrait(x + 4, y + 4, 32, m.speciesId);
    this.add.text(x + 42, y + 4, `${s.name}`, { fontFamily: FONT, fontSize: px(12), color: COLORS.text });
    this.add.text(x + 42, y + 21, `Lv ${m.level}`, { fontFamily: FONT, fontSize: px(11), color: COLORS.dim });
  }
}
