import Phaser from "phaser";
import { playMusic } from "../music";
import { CAMP, CONTENT, MEALS, PROGRESSION, WORLD_CONTENT } from "../../content";
import { canCook, KNOCKOUTS_TO_DEATH, MAX_PARTY_SIZE, memberMaxHp, rest, type MealDef, type PartyMember } from "../../core/party";
import { describeModifiers, focusLabel } from "../ui/describeEffects";
import { pendingChoice, xpToNext } from "../../core/progression";
import { currentWorld, session } from "../session";
import { portraitKey } from "../sprites";
import { FEEDBACK_URL, openFeedback } from "../feedback";
import { showHelp, showTip } from "../tips";
import { Button } from "../ui/Button";
import { tag } from "../ui/markup";
import { RichText } from "../ui/RichText";
import { COLORS, FONT, TYPE_COLORS, px } from "../ui/theme";
import { t } from "../i18n";

/** Five compact cards per row: the full party of 10 fits in two rows. */
const CARD_COLS = 3;
const CARD_W = 178;
const CARD_H = 130;
/** Storage fills the right side, two columns of small cards. */
const STORE_X = 16 + CARD_COLS * (CARD_W + 10) + 6;
const STORE_COLS = 2;
const STORE_ROWS = 9;

/** Camp: party overview (what needs attention) and the choice to rest. Details open per Pokémon. */
/** An effect line continuing a sentence starts lower case ("takes 10% less damage"); the Bond term keeps its capital. */
const midSentence = (s: string): string => (s.startsWith(CONTENT.terms.bond) ? s : s.charAt(0).toLowerCase() + s.slice(1));

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
    new RichText(this, 16, 68, 928, 12).setMarkup(`${tag("title", t("Cook a meal ({food} in the bag:", { food: CONTENT.terms.food.toLowerCase() }))} ${food.map((f) => `${f.name} ${tag("num", bag[f.id] ?? 0)}`).join(" · ")}${tag("title", ")")}`);
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
        ...(meal.bond?.startBond ? [t("Battles start with {bonus}", { bonus: tag("good", `+${meal.bond.startBond} ${CONTENT.terms.bond}`) })] : []),
        ...(meal.bond?.maxBond ? [t("{bond} cap {bonus}", { bond: CONTENT.terms.bond, bonus: tag("good", `+${meal.bond.maxBond}`) })] : []),
        ...describeModifiers(CONTENT, meal.mods ?? {}),
      ];
      new RichText(this, x + 10, y + 6, 330, 12).setMarkup([
        tag("title", meal.name),
        t("Needs: {needs}", { needs }),
        effects.length ? t("Full rest; until the next rest: {effects}", { effects: effects.map(midSentence).join(", ") }) : t("Full rest"),
      ].join("\n"));
      new Button(this, x + 350, y + 30, 100, 28, t("Cook"), () => doRest(meal)).setEnabled(ok).setHighlighted(ok);
    });
    const hy = 92 + Math.ceil(Object.keys(MEALS).length / 2) * 96 + 6;
    const h = CAMP.hungry;
    new RichText(this, 16, hy, 700, 12).setMarkup(t("{label}: only {pct}% HP, fatigue stays at {fatigue}, and {effect}", { label: tag("bad", t("Rest without eating")), pct: Math.round(h.hpFraction * 100), fatigue: h.fatigue, effect: h.effect.description.toLowerCase() }));
    new Button(this, 734, hy, 210, 26, t("Rest hungry"), () => doRest(null));
  }

  create(): void {
    playMusic(this, "overworld");
    const { roster, money, inventory, world } = session.game;
    this.add.text(16, 14, t("Camp"), { fontFamily: FONT, fontSize: "20px", color: "#f5d76e" });
    new RichText(this, 100, 19, 300, 14).setMarkup(t("{money}   EV {ev}   Fatigue {fatigue}", { money: tag("num", `₽${money}`), ev: tag("num", session.game.ev ?? 0), fatigue: tag("num", world.fatigue) }));
    // The top row, packed from the right edge: back to the map (an arrow is enough), rest, bag, Pokédex, feedback.
    let right = 944;
    const top = (w: number, label: string, onClick: () => void) => {
      right -= w;
      const b = new Button(this, right, 12, w, 26, label, onClick).centerLabel();
      right -= 6;
      return b;
    };
    top(40, "➜", () => this.scene.start("Overworld", {}));
    // Resting is a decision: pick a meal (or go hungry); wild groups move and this becomes the respawn point.
    top(130, this.choosingMeal ? t("✕ Cancel") : t("⛺ Rest here…"), () =>
      this.scene.restart({ rested: this.rested, choosingMeal: !this.choosingMeal })).setEnabled(!this.rested);
    top(90, t("🎒 Bag"), () => this.scene.start("Inventory", { from: "Party" }));
    top(110, t("📖 Pokédex"), () => this.scene.start("Pokedex", { from: "Party" }));
    if (FEEDBACK_URL) top(140, t("💬 Feedback"), () => openFeedback(this.game, "camp"));
    top(34, "?", () => showHelp(this));
    this.time.delayedCall(300, () => showTip(this, "camp"));
    const meal = world.meal;
    new RichText(this, 16, 44, 928, 12).setMarkup(this.rested
      ? tag("good", meal && meal.id !== CAMP.hungry.effect.id
        ? t("Rested and ate {meal}. Wild Pokémon have moved; defeat brings you back here.", { meal: meal.name })
        : t("Rested hungry. Wild Pokémon have moved; defeat brings you back here."))
      : meal ? `${tag("dim", t("Current meal:"))} ${tag("num", meal.name)} ${tag("dim", `— ${(MEALS[meal.id] ?? CAMP.hungry.effect).description}`)}` : tag("dim", t("Rest here to restore HP and fatigue with a camp meal.")));
    if (this.choosingMeal) {
      this.mealChooser();
      return;
    }

    this.add.text(16, 64, t("Party {n}/{max} · tap a Pokémon for its details", { n: roster.party.length, max: MAX_PARTY_SIZE }), {
      fontFamily: FONT, fontSize: px(12), color: COLORS.dim,
    });
    roster.party.forEach((m, i) => this.card(16 + (i % CARD_COLS) * (CARD_W + 10), 84 + Math.floor(i / CARD_COLS) * (CARD_H + 8), m));

    this.add.text(STORE_X, 64, t("Storage ({n})", { n: roster.storage.length }), { fontFamily: FONT, fontSize: px(12), color: COLORS.dim });
    const room = STORE_COLS * STORE_ROWS;
    const shown = roster.storage.length > room ? room - 1 : roster.storage.length;
    const at = (i: number) => ({ x: STORE_X + (i % STORE_COLS) * 154, y: 84 + Math.floor(i / STORE_COLS) * 46 });
    roster.storage.slice(0, shown).forEach((m, i) => this.mini(at(i).x, at(i).y, m));
    if (roster.storage.length > shown) this.add.text(at(shown).x + 8, at(shown).y + 12, t("+{n} more", { n: roster.storage.length - shown }), { fontFamily: FONT, fontSize: px(11), color: COLORS.dim });
    if (roster.fallen.length) {
      new RichText(this, 16, 512, 928, 12).setMarkup(`${tag("ko", t("Fallen"))}: ${roster.fallen.map((m) => CONTENT.species[m.speciesId]!.name).join(", ")}`);
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
    const waiting = [pending === "evolution" ? t("choose its evolution") : pending === "focus" ? t("choose its focus") : pending === "talent" ? t("learn a mastery") : "", m.unspentPoints ? (m.unspentPoints > 1 ? t("{n} stat points", { n: m.unspentPoints }) : t("{n} stat point", { n: m.unspentPoints })) : ""].filter(Boolean);
    const bg = this.add.rectangle(x, y, CARD_W, CARD_H, 0x1c2130).setOrigin(0)
      .setStrokeStyle(waiting.length ? 2 : 1, waiting.length ? 0xf5d76e : m.knockouts === 2 ? 0xd0021b : 0x3a4560);
    bg.setInteractive({ useHandCursor: true }).on("pointerdown", () => this.open(m));
    this.portrait(x + 6, y + 6, 40, m.speciesId);

    const max = memberMaxHp(CONTENT, PROGRESSION, m);
    const frac = Math.min(1, m.hp / max);
    const role = m.focus ? focusLabel(m.focus) : t("no focus yet");
    const held = m.heldItem ? PROGRESSION.items[m.heldItem]!.name : t("no item");
    const pips = "●".repeat(m.knockouts) + "○".repeat(KNOCKOUTS_TO_DEATH - m.knockouts);
    // Text first; the HP bar goes below however tall the text turned out (fonts are larger on phones).
    new RichText(this, x + 52, y + 6, CARD_W - 58, 12).setMarkup([
      tag("title", s.name),
      t("Lv {level} {xp}", { level: tag("num", m.level), xp: tag("dim", t("XP {xp}/{next}", { xp: m.xp, next: xpToNext(PROGRESSION, m.level) })) }),
    ].join("\n"));
    const textH = new RichText(this, x + 6, y + 50, CARD_W - 12, 11).setMarkup([
      `${s.types.map((ty) => tag(ty, ty)).join("/")} ${tag("dim", `· ${role}`)}`,
      tag("dim", held),
    ].join("\n"));
    const barY = y + 50 + textH + 8;
    this.add.rectangle(x + 8, barY, CARD_W - 16, 6, 0x000000).setOrigin(0, 0.5);
    this.add.rectangle(x + 8, barY, (CARD_W - 16) * frac, 6, frac > 0.5 ? 0x7ed321 : frac > 0.25 ? 0xf5a623 : 0xd0021b).setOrigin(0, 0.5);
    new RichText(this, x + 8, barY + 8, CARD_W - 16, 12).setMarkup(
      // A pending choice is just flagged here (the Pokémon's page has the details).
      `${m.hp > 0 ? `HP ${Math.min(m.hp, max)}/${max}` : tag("ko", t("fainted"))}  KO ${tag(m.knockouts ? "ko" : "dim", pips)}${waiting.length ? `  ${tag("num", t("★ Lv up"))}` : ""}`);
  }

  private mini(x: number, y: number, m: PartyMember): void {
    const s = CONTENT.species[m.speciesId]!;
    const bg = this.add.rectangle(x, y, 148, 40, 0x1c2130).setOrigin(0).setStrokeStyle(1, 0x3a4560);
    bg.setInteractive({ useHandCursor: true }).on("pointerdown", () => this.open(m));
    this.portrait(x + 4, y + 4, 32, m.speciesId);
    this.add.text(x + 42, y + 4, `${s.name}`, { fontFamily: FONT, fontSize: px(12), color: COLORS.text });
    this.add.text(x + 42, y + 21, t("Lv {level}", { level: m.level }), { fontFamily: FONT, fontSize: px(11), color: COLORS.dim });
  }
}
