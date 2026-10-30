import Phaser from "phaser";
import { playMusic } from "../music";
import { CAMP, CONTENT, MEALS, PROGRESSION, WORLD_CONTENT } from "../../content";
import { canCook, KNOCKOUTS_TO_DEATH, MAX_PARTY_SIZE, memberMaxHp, rest, type MealDef, type PartyMember } from "../../core/party";
import { describeModifiers, focusLabel } from "../ui/describeEffects";
import { pendingChoice, xpToNext } from "../../core/progression";
import { currentWorld, session } from "../session";
import { animKey, facingFor, footOrigin, hasSprite, portraitKey } from "../sprites";
import { playCry, sfx } from "../audio";
import { campfire } from "../moveFx";
import { baked } from "../ui/bake";
import { drawCampBackdrop, firePit } from "../ui/campArt";
import { itemIcon } from "../ui/itemIcon";
import { pixText } from "../ui/pixelFont";
import { FEEDBACK_URL, openFeedback } from "../feedback";
import { showHelp, showTip } from "../tips";
import { Button } from "../ui/Button";
import { tag } from "../ui/markup";
import { RichText } from "../ui/RichText";
import { COLORS, FONT, TYPE_COLORS, px } from "../ui/theme";
import { t } from "../i18n";
import { typeTag } from "../ui/typeName";
import { panel, screenTitle } from "../ui/frames";

/** Three cards per row: a full party of 9 fits in three rows. */
const CARD_COLS = 3;
const CARD_W = 178;
/** The least a card is tall; a row grows to its tallest card's text (fonts are larger on phones). */
const CARD_H = 112;
/** Storage fills the right side, two columns of small cards. */
const STORE_X = 16 + CARD_COLS * (CARD_W + 10) + 6;
/** Seats round the camp fire, in degrees (0 = right, 90 = towards the viewer), in the order they fill. */
const SEATS = [180, 0, 232, 308, 270, 148, 32, 205, 335];
/** The camp scene's width (the right column). */
const SCENE_W = 944 - STORE_X;

/** Camp: party overview (what needs attention) and the choice to rest. Details open per Pokémon. */
/** An effect line continuing a sentence starts lower case ("takes 10% less damage"); the Bond term keeps its capital. */
const midSentence = (s: string): string => (s.startsWith(CONTENT.terms.bond) ? s : s.charAt(0).toLowerCase() + s.slice(1));

export class PartyScene extends Phaser.Scene {
  private rested = false;
  private choosingMeal = false;
  /** HP before the rest just taken, so the bars can refill on screen. */
  private hpBefore: Readonly<Record<string, number>> = {};

  constructor() {
    super("Party");
  }

  init(data: { rested?: boolean; choosingMeal?: boolean; hpBefore?: Record<string, number> }): void {
    this.rested = data?.rested ?? false;
    this.choosingMeal = data?.choosingMeal ?? false;
    this.hpBefore = data?.hpBefore ?? {};
  }

  /** Recipes with what they need and what they do; cooking one rests the team. */
  private mealChooser(): void {
    const game = session.game;
    const bag = game.inventory.items;
    const food = Object.values(PROGRESSION.items).filter((i) => i.kind === "food");
    new RichText(this, 16, 68, 928, 12).setMarkup(`${tag("title", t("Cook a meal ({food} in the bag:", { food: CONTENT.terms.food.toLowerCase() }))} ${food.map((f) => `${f.name} ${tag("num", bag[f.id] ?? 0)}`).join(" · ")}${tag("title", ")")}`);
    const doRest = (meal: MealDef | null) => {
      const hpBefore = Object.fromEntries(session.game.roster.party.map((m) => [m.uid, m.hp]));
      session.update(rest(CONTENT, PROGRESSION, { content: WORLD_CONTENT, def: currentWorld() }, CAMP, session.game, meal));
      this.scene.restart({ rested: true, hpBefore });
    };
    // What can be cooked comes first.
    const meals = Object.values(MEALS).sort((a, b) => Number(canCook(game, b)) - Number(canCook(game, a)));
    meals.forEach((meal, i) => {
      const x = 16 + (i % 2) * 470;
      const y = 92 + Math.floor(i / 2) * 96;
      const ok = canCook(game, meal);
      panel(this, x, y, 460, 88, ok ? { edge: 0xd08a3a, edgeWidth: 2 } : { fill: 0x141821 });
      // The ingredients as their icons, each with how many it needs of how many you have.
      let ix = x + 10;
      for (const [id, n] of Object.entries(meal.ingredients)) {
        const have = bag[id] ?? 0;
        const icon = this.add.image(ix, y + 34, itemIcon(this, id)).setOrigin(0, 0.5).setDisplaySize(20, 20);
        if (have < n) icon.setTint(0x6a6a78);
        const label = this.add.text(ix + 22, y + 34, `${PROGRESSION.items[id]?.name ?? id} ${Math.min(have, n)}/${n}`, {
          fontFamily: FONT, fontSize: px(12), color: have >= n ? "#9be36b" : "#ff8a8a",
        }).setOrigin(0, 0.5);
        ix += 22 + label.width + 14;
      }
      const effects = [
        ...(meal.bond?.startBond ? [t("Battles start with {bonus}", { bonus: tag("good", `+${meal.bond.startBond} ${CONTENT.terms.bond}`) })] : []),
        ...(meal.bond?.maxBond ? [t("{bond} cap {bonus}", { bond: CONTENT.terms.bond, bonus: tag("good", `+${meal.bond.maxBond}`) })] : []),
        ...describeModifiers(CONTENT, meal.mods ?? {}),
      ];
      new RichText(this, x + 10, y + 6, 330, 12).setMarkup(tag(ok ? "title" : "dim", meal.name));
      new RichText(this, x + 10, y + 48, 330, 11).setMarkup(
        effects.length ? t("Full rest; until the next rest: {effects}", { effects: effects.map(midSentence).join(", ") }) : t("Full rest"));
      const cook = new Button(this, x + 350, y + 30, 100, 28, t("Cook"), () => this.cook(meal, () => doRest(meal))).centerLabel().setEnabled(ok);
      if (ok) cook.setSolid(0xc8682a);
    });
    const hy = 92 + Math.ceil(Object.keys(MEALS).length / 2) * 96 + 6;
    const h = CAMP.hungry;
    new RichText(this, 16, hy, 700, 12).setMarkup(t("{label}: only {pct}% HP, fatigue becomes {fatigue}, and {effect}", { label: tag("bad", t("Rest without eating")), pct: Math.round(h.hpFraction * 100), fatigue: h.fatigue, effect: midSentence(h.effect.description) }));
    // Going hungry is the poor choice: a plain button with a red label.
    new Button(this, 734, hy, 210, 26, t("Rest hungry"), () => doRest(null)).centerLabel().setLabelColor("#ff8a8a");
  }

  create(): void {
    // Screens fade in from the background colour instead of cutting.
    this.cameras.main.fadeIn(160, 16, 20, 28);
    playMusic(this, "overworld");
    const { roster, money, inventory, world } = session.game;
    const title = screenTitle(this, 16, 14, t("Camp"));
    new RichText(this, 16 + title.width + 18, 19, 300, 14).setMarkup(t("{money}   EV {ev}   Fatigue {fatigue}", { money: tag("num", `₽${money}`), ev: tag("num", session.game.ev ?? 0), fatigue: tag("num", world.fatigue) }));
    // The top row, packed from the right edge: back to the map (an arrow is enough), rest, bag, Pokédex, feedback.
    let right = 944;
    // Each as wide as its label (in either language), so none looks bigger than the rest.
    const top = (min: number, label: string, onClick: () => void) => {
      const probe = this.add.text(0, 0, label, { fontFamily: FONT, fontSize: "14px" });
      const w = Math.max(min, Math.ceil(probe.width) + 24);
      probe.destroy();
      right -= w;
      const b = new Button(this, right, 12, w, 26, label, onClick).centerLabel();
      right -= 6;
      return b;
    };
    top(40, "➜", () => this.scene.start("Overworld", {}));
    // Resting is a decision: pick a meal (or go hungry); wild groups move and this becomes the respawn point.
    const restButton = top(40, this.choosingMeal ? t("✕ Cancel") : t("⛺ Rest here…"), () =>
      this.scene.restart({ rested: this.rested, choosingMeal: !this.choosingMeal })).setEnabled(!this.rested);
    // Resting is what the camp is for: the warm, solid button (until done).
    if (!this.rested && !this.choosingMeal) restButton.setSolid(0xc8682a);
    top(40, t("🎒 Bag"), () => this.scene.start("Inventory", { from: "Party" }));
    top(40, t("📖 Pokédex"), () => this.scene.start("Pokedex", { from: "Party" }));
    if (FEEDBACK_URL) top(40, t("💬 Feedback"), () => openFeedback(this.game, "camp"));
    top(34, "?", () => showHelp(this));
    this.time.delayedCall(300, () => showTip(this, "camp"));
    const meal = world.meal;
    new RichText(this, 16, 44, 928, 12).setMarkup(this.rested
      ? meal && meal.id !== CAMP.hungry.effect.id
        ? tag("good", t("Rested and ate {meal}. Wild Pokémon have moved; defeat brings you back here.", { meal: meal.name }))
        : tag("num", t("Rested hungry. Wild Pokémon have moved; defeat brings you back here."))
      : meal ? `${tag("dim", t("Current meal:"))} ${tag("num", meal.name)} ${tag("dim", `— ${(MEALS[meal.id] ?? CAMP.hungry.effect).description}`)}` : tag("dim", t("Rest here to restore HP and fatigue with a camp meal.")));
    if (this.choosingMeal) {
      this.mealChooser();
      return;
    }

    this.add.text(16, 64, t("Party {n}/{max} · tap a Pokémon for its details", { n: roster.party.length, max: MAX_PARTY_SIZE }), {
      fontFamily: FONT, fontSize: px(12), color: COLORS.dim,
    });
    // Row by row: every card in a row as tall as the tallest, so the HP bars line up.
    let rowY = 84;
    for (let r = 0; r * CARD_COLS < roster.party.length; r++) {
      const row = roster.party.slice(r * CARD_COLS, (r + 1) * CARD_COLS).map((m, i) => this.card(16 + i * (CARD_W + 10), rowY, m));
      const h = Math.max(CARD_H, ...row.map((c) => c.h));
      row.forEach((c) => c.finish(h));
      rowY += h + 8;
    }

    // The camp itself on the right; storage (the PC box) opens as its own scrolling screen, the newest arrivals shown here.
    const sceneH = 340;
    this.campScene(STORE_X, 66, SCENE_W, sceneH, roster.party);
    const storeY = 66 + sceneH + 12;
    new Button(this, STORE_X, storeY, SCENE_W, 30, t("📦 Storage ({n})", { n: roster.storage.length }), () => this.scene.start("Storage", {})).centerLabel();
    roster.storage.slice(-6).reverse().forEach((m, i) => {
      if (this.textures.exists(portraitKey(m.speciesId))) this.add.image(STORE_X + i * 52, storeY + 40, portraitKey(m.speciesId)).setOrigin(0).setDisplaySize(44, 44);
    });
    if (roster.fallen.length) {
      new RichText(this, 16, 512, 928, 12).setMarkup(`${tag("ko", t("Fallen"))}: ${roster.fallen.map((m) => CONTENT.species[m.speciesId]!.name).join(", ")}`);
    }
  }

  /**
   * The camp itself: a fire under a dusk sky with the party round it, each in its own idle animation and facing the
   * fire (tap one for its cry). After a rest the fire burns low and the team sleeps.
   */
  private campScene(x: number, y: number, w: number, h: number, members: readonly PartyMember[]): void {
    panel(this, x - 2, y - 2, w + 4, h + 4, { edgeWidth: 2 });
    baked(this, `camp-backdrop:${w}x${h}`, w, h, (g) => drawCampBackdrop(g, w, h)).setPosition(x, y);
    const pit = firePit(w, h), fx = x + pit.x, fy = y + pit.y;
    const glow = this.add.ellipse(fx, fy - 6, w * 0.72, h * 0.42, 0xff9a40, this.rested ? 0.1 : 0.17).setBlendMode(Phaser.BlendModes.ADD).setDepth(1);
    this.tweens.add({ targets: glow, scaleX: 1.05, scaleY: 1.08, alpha: glow.alpha * 0.65, duration: 380, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    campfire(this, fx, fy - 2, 2, this.rested ? 0.7 : 1);
    members.forEach((m, i) => {
      if (!hasSprite(m.speciesId)) return;
      // Seats round the fire, filled sides first, then the back, then the front corners (the front stays open).
      const a = Phaser.Math.DegToRad(SEATS[i % SEATS.length]!);
      const sx = Math.round(fx + Math.cos(a) * w * 0.37), sy = Math.round(fy + Math.sin(a) * h * 0.24);
      this.add.ellipse(sx, sy, 24, 7, 0x000000, 0.35).setDepth(1.4);
      const spr = this.add.sprite(sx, sy, `${m.speciesId}-idle`).play(animKey(m.speciesId, "idle", facingFor(fx - sx, fy - sy)));
      spr.setOrigin(0.5, footOrigin(this, m.speciesId)).setScale(spr.frame.height > 64 ? 1 : 2).setDepth(sy < fy ? 1.5 : 3);
      if (m.hp <= 0) spr.setTint(0x7a7a8a).setAlpha(0.75);
      spr.setInteractive({ useHandCursor: true }).on("pointerdown", () => {
        playCry(this, m.speciesId);
        this.tweens.add({ targets: spr, y: sy - 10, duration: 120, yoyo: true, ease: "Quad.easeOut" });
      });
      if (this.rested) {
        const head = sy - spr.displayHeight * spr.originY * 0.75;
        const z = pixText(this, sx + 8, head, "z", 0xc8d8ff, 2).setDepth(4).setAlpha(0);
        this.tweens.add({ targets: z, y: head - 20, x: sx + 16, alpha: { from: 0.9, to: 0 }, duration: 1500, repeat: -1, delay: i * 330 });
      }
    });
  }

  /** The cooking moment: a pot over the fire, the ingredients drop in, steam rises, the meal is named; then `done`. */
  private cook(meal: MealDef, done: () => void): void {
    this.input.enabled = false;
    const cx = 480, cy = 300;
    this.add.rectangle(0, 0, 960, 540, 0x0a0c12, 0.82).setOrigin(0).setDepth(50);
    this.add.ellipse(cx, cy + 36, 260, 90, 0xff9a40, 0.07).setBlendMode(Phaser.BlendModes.ADD).setDepth(51);
    campfire(this, cx, cy + 34, 52, 1.2);
    const pot = this.add.graphics({ x: cx, y: cy }).setDepth(53);
    pot.fillStyle(0x23232c, 1).fillEllipse(0, 0, 92, 62).fillStyle(0x34343f, 1).fillEllipse(-8, -8, 64, 38);
    pot.fillStyle(0x15151b, 1).fillEllipse(0, -24, 88, 20).fillStyle(0xc8a060, 1).fillEllipse(0, -22, 76, 13);
    pot.lineStyle(3, 0x4a4a56, 1).strokeEllipse(0, -24, 88, 20);
    const ids = Object.entries(meal.ingredients).flatMap(([id, n]) => Array.from({ length: n }, () => id));
    ids.forEach((id, i) => {
      const fromLeft = i % 2 === 0;
      const icon = this.add.image(fromLeft ? cx - 260 : cx + 260, cy - 120 - (i % 3) * 20, itemIcon(this, id)).setDisplaySize(32, 32).setDepth(54);
      this.tweens.add({ targets: icon, x: cx + (fromLeft ? -10 : 10), duration: 420, delay: 200 + i * 260, ease: "Sine.easeOut" });
      this.tweens.add({
        targets: icon, y: { from: icon.y, to: cy - 26 }, scale: icon.scale * 0.6, duration: 420, delay: 200 + i * 260, ease: "Back.easeIn",
        onComplete: () => { icon.destroy(); sfx(this, "pickup"); },
      });
    });
    const stewed = 200 + ids.length * 260 + 450;
    this.time.delayedCall(stewed, () => {
      for (let i = 0; i < 8; i++) {
        const puff = this.add.circle(cx + Phaser.Math.Between(-30, 30), cy - 28, Phaser.Math.Between(5, 9), 0xffffff, 0.35).setDepth(55);
        this.tweens.add({ targets: puff, y: cy - 90 - Phaser.Math.Between(0, 40), x: puff.x + Phaser.Math.Between(-16, 16), scale: 2.6, alpha: 0, duration: 1100, delay: i * 110, onComplete: () => puff.destroy() });
      }
      sfx(this, "levelUp");
      const name = pixText(this, cx, cy - 150, meal.name, 0xf5d76e, 3).setOrigin(0.5).setDepth(56).setScale(0.5).setAlpha(0);
      this.tweens.add({ targets: name, scale: 1, alpha: 1, duration: 260, ease: "Back.easeOut" });
    });
    this.time.delayedCall(stewed + 1300, () => {
      this.input.enabled = true;
      done();
    });
  }

  private open(m: PartyMember): void {
    this.scene.start("Pokemon", { uid: m.uid });
  }

  private portrait(x: number, y: number, size: number, speciesId: string): void {
    if (this.textures.exists(portraitKey(speciesId))) this.add.image(x, y, portraitKey(speciesId)).setOrigin(0).setDisplaySize(size, size);
    else this.add.circle(x + size / 2, y + size / 2, size / 2 - 2, TYPE_COLORS[CONTENT.species[speciesId]!.types[0]!] ?? 0x888888);
  }

  /**
   * A party card: portrait, name, level, types, role, held item and what is waiting, then (in `finish`, once the
   * row's height is known) the frame, the HP bar and the HP/knockout line at the card's foot.
   */
  private card(x: number, y: number, m: PartyMember): { h: number; finish: (h: number) => void } {
    const s = CONTENT.species[m.speciesId]!;
    const pending = pendingChoice(CONTENT, PROGRESSION, m);
    const waiting = [pending === "evolution" ? t("choose its evolution") : pending === "focus" ? t("choose its focus") : pending === "talent" ? t("learn a mastery") : "", m.unspentPoints ? (m.unspentPoints > 1 ? t("{n} stat points", { n: m.unspentPoints }) : t("{n} stat point", { n: m.unspentPoints })) : ""].filter(Boolean);
    this.portrait(x + 6, y + 6, 40, m.speciesId);

    const max = memberMaxHp(CONTENT, PROGRESSION, m);
    const frac = Math.min(1, m.hp / max);
    const role = m.focus ? focusLabel(m.focus) : t("no focus yet");
    const held = m.heldItem ? PROGRESSION.items[m.heldItem]!.name : t("no item");
    const pips = "●".repeat(m.knockouts) + "○".repeat(KNOCKOUTS_TO_DEATH - m.knockouts);
    new RichText(this, x + 52, y + 6, CARD_W - 58, 12).setMarkup([
      tag("title", s.name),
      t("Lv {level} {xp}", { level: tag("num", m.level), xp: tag("dim", t("XP {xp}/{next}", { xp: m.xp, next: xpToNext(PROGRESSION, m.level) })) }),
    ].join("\n"));
    // What is waiting gets its own line, in words (the Pokémon's page has the details).
    const textH = new RichText(this, x + 6, y + 50, CARD_W - 12, 11).setMarkup([
      `${s.types.map((ty) => typeTag(ty)).join("/")} ${tag("dim", `· ${role}`)}`,
      tag("dim", held),
      ...(waiting.length ? [tag("num", `★ ${waiting.join(", ")}`)] : []),
    ].join("\n"));
    return {
      h: 50 + textH + 36,
      finish: (h) => {
        const frame = panel(this, x, y, CARD_W, h, waiting.length ? { edge: 0xf5d76e, edgeWidth: 2 } : m.knockouts === 2 ? { edge: 0xd0021b, edgeWidth: 2 } : {}).setDepth(-1);
        const bg = frame.list[1] as Phaser.GameObjects.Rectangle;
        // Hovering lifts the card's frame a little: it is a door to the Pokémon's page.
        bg.setInteractive({ useHandCursor: true }).on("pointerdown", () => this.open(m))
          .on("pointerover", () => bg.setFillStyle(0x252c3e)).on("pointerout", () => bg.setFillStyle(0x1c2130));
        const barY = y + h - 26;
        this.add.rectangle(x + 8, barY, CARD_W - 16, 6, 0x000000).setOrigin(0, 0.5);
        const fill = this.add.rectangle(x + 8, barY, (CARD_W - 16) * frac, 6, frac > 0.5 ? 0x7ed321 : frac > 0.25 ? 0xf5a623 : 0xd0021b).setOrigin(0, 0.5);
        // Just rested: the bar refills from where it was, and the HP won floats up.
        const before = this.hpBefore[m.uid];
        if (before !== undefined && before < m.hp) {
          fill.width = (CARD_W - 16) * Math.min(1, before / max);
          const order = session.game.roster.party.indexOf(m);
          this.tweens.add({ targets: fill, width: (CARD_W - 16) * frac, delay: 350 + order * 90, duration: 600, ease: "Cubic.easeOut", onStart: () => order === 0 && sfx(this, "heal") });
          const gain = pixText(this, x + 26, y + 30, `+${m.hp - before}`, 0x9be36b, 2).setOrigin(0.5, 1).setAlpha(0);
          this.tweens.add({ targets: gain, alpha: 1, y: y + 22, delay: 350 + order * 90, duration: 300, hold: 900, yoyo: true });
        }
        new RichText(this, x + 8, barY + 6, CARD_W - 16, 12).setMarkup(
          `${m.hp > 0 ? `HP ${Math.min(m.hp, max)}/${max}` : tag("ko", t("fainted"))}  KO ${tag(m.knockouts ? "ko" : "dim", pips)}`);
      },
    };
  }
}
