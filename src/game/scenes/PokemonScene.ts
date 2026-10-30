import Phaser from "phaser";
import { CONTENT, PROGRESSION } from "../../content";
import {
  allocatePoint,
  CANDY,
  equipItem,
  findMember,
  KNOCKOUTS_TO_DEATH,
  MAX_PARTY_SIZE,
  memberMaxHp,
  moveBetweenPartyAndStorage,
  respecMember,
  useRareCandy,
  usePotion,
  useRemedy,
  withMember,
  type PartyMember,
} from "../../core/party";
import {
  basicMoveOf,
  battleMoves,
  LOADOUT,
  slotOf,
  chooseFocus,
  chooseTalent,
  memberFocusGrowth,
  focusOptions,
  memberStats,
  pendingChoice,
  respecCost,
  chooseEvolution,
  evolutionDue,
  readyToEvolve,
  evolutionChoices,
  memberGrid,
  rowPick,
  setActiveMoves,
  talentOptions,
  xpToNext,
  statOffer,
  type FocusOption,
} from "../../core/progression";
import { type Role, baseMovement, speedAtMoveCap, STAT_NAMES, type StatName } from "../../core/battle";
import { session } from "../session";
import { animKey, footOrigin, hasSprite, portraitKey } from "../sprites";
import { playCry, sfx } from "../audio";
import { panel } from "../ui/frames";
import { pixText } from "../ui/pixelFont";
import { moveCard, type MoveCardLook } from "../ui/moveCard";
import { Button } from "../ui/Button";
import { itemIcon } from "../ui/itemIcon";
import { describeItem, focusLabel, describeTalent, STAT_LABEL, STAT_SHORT } from "../ui/describeEffects";
import { describeMove, reachShort } from "../ui/describeMove";
import { tag } from "../ui/markup";
import { t } from "../i18n";
import { RichText } from "../ui/RichText";
import { showTip } from "../tips";
import { COLORS, FONT, TYPE_COLORS, px } from "../ui/theme";
import { typeName, typeTag } from "../ui/typeName";

const LIST_X = 16;
const DETAIL_X = 16;
const DETAIL_W = 928;
/** The hero band under the top buttons: the Pokémon's stage, then its name, chips and bars, then ability and focus. */
const HERO_Y = 44;
const HERO_H = 92;
const HERO_STAGE_W = 150;
const HERO_INFO_X = 560;
const BAR_W = 200;
/** Stat bars: 20 segments, each stat in its own colour. */
const SEGMENTS = 20;
const STAT_COLORS: Record<StatName, number> = {
  hp: 0xff6b6b, attack: 0xf5a05a, defense: 0xf5d76e, speed: 0xf88fb8, willpower: 0x9db7f5, crit: 0x7ed6c8,
};
/** The open tab's page. */
const PAGE_FILL = 0x161c28;

/** Mixes colour `c` towards `to` by `k` (0–1). */
const mixColor = (c: number, to: number, k: number): number => {
  const ch = (sh: number) => Math.round(((c >> sh) & 255) * (1 - k) + ((to >> sh) & 255) * k);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};

/** A 16×16 tile of one diagonal white stripe, made once. */
function stripeTexture(scene: Phaser.Scene): string {
  const key = "ui-stripe";
  if (!scene.textures.exists(key)) {
    const tex = scene.textures.createCanvas(key, 16, 16)!;
    const ctx = tex.getContext();
    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < 16; i++) ctx.fillRect(i, 15 - i, 4, 1);
    tex.refresh();
  }
  return key;
}

/** One Pokémon: stats (and stat points), talent tree, moves, equipment. */
/** Set once the player has read the EV explanation. */
const EV_HELP_FLAG = "help-ev";

/** What a focus adds when chosen: "+2 Atk", or "+1 Atk +1 Def" for a mixed focus. */
const focusBonusLabel = (f: FocusOption): string => (f.second
  ? `+${PROGRESSION.rules.focusBonus / 2} ${STAT_LABEL[f.stat]} +${PROGRESSION.rules.focusBonus / 2} ${STAT_LABEL[f.second]}`
  : `+${PROGRESSION.rules.focusBonus} ${STAT_LABEL[f.stat]}`);

/** " · Melee" / " · Ranged": how the Pokémon fights (its tree and moves follow it). */
const roleTag = (role: Role | undefined): string => (role ? `  ${tag("special", role === "melee" ? t("Melee") : t("Ranged"))}` : "");

export class PokemonScene extends Phaser.Scene {
  private root!: Phaser.GameObjects.Container;
  private selected: string | null = null;
  private message = "";
  private tab: Tab = "stats";
  private selectedTalent: string | null = null;
  private selectedMove: string | null = null;
  /** The hero backdrop's stripes, drifting slowly. */
  private stripes: Phaser.GameObjects.TileSprite | null = null;
  /** A mastery (or focus) just learned: its cell celebrates on the next draw. */
  private justPicked: string | null = null;

  constructor() {
    super("Pokemon");
  }

  /** The EV explanation, reopened with "?". */
  private evHelp = false;
  /** Level-up points: the +1 / +2 switch (+2 costs EV unless the offer is a lucky one). */
  private plusTwo = false;
  /** First shown row of the bag's held items on the Equipment tab (wheel or ▲▼ scrolls). */
  private bagRow = 0;

  init(data: { uid: string; tab?: Tab }): void {
    this.message = "";
    this.selected = data.uid;
    this.tab = data.tab ?? (pendingChoice(CONTENT, PROGRESSION, findMember(session.game, data.uid)!) ? "talents" : "stats");
    this.selectedTalent = null;
  }

  create(): void {
    // Screens fade in from the background colour instead of cutting.
    this.cameras.main.fadeIn(160, 16, 20, 28);
    this.root = this.add.container(0, 0);
    this.bagRow = 0;
    this.input.on("wheel", (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      if (this.tab !== "equipment") return;
      this.bagRow = Math.max(0, this.bagRow + Math.sign(dy));
      this.render();
    });
    this.render();
  }

  private act(f: () => void, success?: string): void {
    try {
      f();
      this.message = success ? tag("good", success) : "";
    } catch (e) {
      this.justPicked = null;
      this.message = tag("bad", e instanceof Error ? t("Cannot do that: {reason}.", { reason: t(e.message) }) : t("Cannot do that."));
    }
    this.render();
  }

  private evolve(uid: string): void {
    this.scene.start("Evolution", { uids: [uid], next: "Pokemon", nextData: { uid, tab: this.tab } });
  }

  private updateMember(member: PartyMember, f: (m: PartyMember) => PartyMember): void {
    session.update(withMember(session.game, member.uid, f));
  }

  private render(): void {
    this.root.removeAll(true);
    const { roster, money } = session.game;
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => (this.root.add(o), o);
    const text = (x: number, y: number, s: string, color: string = COLORS.text, size = 13) =>
      add(this.add.text(x, y, s, { fontFamily: FONT, fontSize: px(size), color }));

    // EV is spent here on stats; money pays for a mastery reset.
    add(new RichText(this, LIST_X, 18, 220, 14)).setMarkup(`EV ${tag("num", session.game.ev ?? 0)}   ${tag("num", `₽${money}`)}`);
    // Navigation sits top right, as on the Camp screen: ◀ n/N ▶ cycle through the same list
    // (party, or storage when viewing a stored Pokémon), then back to Camp.
    const list = roster.party.some((m) => m.uid === this.selected) ? roster.party : roster.storage;
    const idx = list.findIndex((m) => m.uid === this.selected);
    const go = (d: number) => {
      const next = list[(idx + d + list.length) % list.length];
      if (!next) return;
      this.selected = next.uid;
      this.selectedTalent = null;
      this.message = "";
      this.render();
    };
    const right = DETAIL_X + DETAIL_W;
    add(new Button(this, right - 120, 12, 120, 26, t("← Camp"), () => this.scene.start("Party", { rested: false, choosingMeal: false })));
    add(new Button(this, right - 172, 12, 40, 26, " ▶", () => go(1)).setEnabled(list.length > 1));
    const count = text(right - 180, 17, list === roster.storage ? t("{i}/{n} in storage", { i: idx + 1, n: list.length }) : `${idx + 1}/${list.length}`, COLORS.dim, 13).setOrigin(1, 0);
    const prev = add(new Button(this, count.x - count.width - 48, 12, 40, 26, " ◀", () => go(-1)).setEnabled(list.length > 1));
    // Party ↔ storage sits by the pager: it is about which list this Pokémon is in, on every tab.
    const shown = this.selected ? findMember(session.game, this.selected) : undefined;
    if (shown) {
      const inParty = roster.party.some((x) => x.uid === shown.uid);
      const store = add(new Button(this, prev.x - 136, 12, 128, 26, inParty ? t("📦 To storage") : t("↩ To party"), () =>
        this.act(() => session.update({ ...session.game, roster: moveBetweenPartyAndStorage(session.game.roster, shown.uid) })))
        // The last Pokémon in the party stays; a full party takes no one from storage.
        .setEnabled(inParty ? roster.party.length > 1 : roster.party.length < MAX_PARTY_SIZE));
      // A held-back (or just reached) evolution starts here, with its scene.
      if (evolutionDue(CONTENT, shown)) {
        add(new Button(this, store.x - 128, 12, 120, 26, t("✦ Evolve"), () => this.evolve(shown.uid)).setHighlighted(true));
      }
    }

    const member = this.selected ? findMember(session.game, this.selected) : undefined;
    if (member) this.renderDetail(member, add);
    if (this.message) add(new RichText(this, DETAIL_X, 506, DETAIL_W, 12)).setMarkup(this.message);
  }

  /**
   * The summary's hero band: the Pokémon itself, animated, on a backdrop in its type's colour (tap it for its cry),
   * then its name, level, type chips, HP and EXP bars and when it evolves.
   */
  private renderHero(m: PartyMember, add: <T extends Phaser.GameObjects.GameObject>(o: T) => T): void {
    const s = CONTENT.species[m.speciesId]!;
    const base = TYPE_COLORS[s.types[0]!] ?? 0x888888;
    const x = DETAIL_X, y = HERO_Y, w = HERO_STAGE_W, h = HERO_H;
    add(panel(this, x, y, w, h, { fill: mixColor(base, 0x10141c, 0.62), edge: mixColor(base, 0x000000, 0.45), edgeWidth: 2 }));
    // Slow diagonal stripes and a soft light behind the Pokémon.
    this.stripes = add(this.add.tileSprite(x + 2, y + 2, w - 4, h - 4, stripeTexture(this)).setOrigin(0).setAlpha(0.09));
    add(this.add.ellipse(x + w / 2, y + h / 2 + 4, w * 0.8, h * 0.9, mixColor(base, 0xffffff, 0.3), 0.18));
    add(this.add.ellipse(x + w / 2, y + h - 14, 64, 12, 0x000000, 0.35));
    let body: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image | null = null;
    if (hasSprite(m.speciesId)) {
      const spr = this.add.sprite(x + w / 2, y + h - 14, `${m.speciesId}-idle`).play(animKey(m.speciesId, "idle", 0));
      // Whole-number scale keeps the pixels square: 3× for small sheets, 2× for big ones.
      spr.setOrigin(0.5, footOrigin(this, m.speciesId)).setScale(spr.frame.height <= 40 ? 3 : 2);
      body = add(spr);
    } else if (this.textures.exists(portraitKey(m.speciesId))) {
      body = add(this.add.image(x + w / 2, y + h / 2, portraitKey(m.speciesId)).setDisplaySize(64, 64));
    }
    if (body) {
      const at = body.y;
      const hit = add(this.add.rectangle(x, y, w, h, 0xffffff, 0.001).setOrigin(0).setInteractive({ useHandCursor: true }));
      hit.on("pointerdown", () => {
        playCry(this, m.speciesId);
        this.tweens.add({ targets: body, y: at - 10, duration: 120, yoyo: true, ease: "Quad.easeOut" });
      });
    }

    // Name and level, then the type chips (and how it fights).
    const ix = x + w + 14;
    const name = add(pixText(this, ix, y + 2, s.name, 0xffffff, 2));
    add(pixText(this, ix + name.width + 10, y + 2, `Lv${m.level}`, 0xf5d76e, 2));
    let cx = ix;
    for (const ty of s.types) {
      const label = this.add.text(0, 0, typeName(ty).toUpperCase(), { fontFamily: FONT, fontSize: "10px", color: "#ffffff", fontStyle: "bold" }).setOrigin(0.5).setStroke("#10141c", 2);
      const cw = label.width + 10;
      add(this.add.rectangle(cx, y + 31, cw, 14, TYPE_COLORS[ty] ?? 0x888888).setOrigin(0, 0.5).setStrokeStyle(1, 0x10141c));
      add(label.setPosition(cx + cw / 2, y + 31));
      cx += cw + 4;
    }
    if (s.role) add(this.add.text(cx + 4, y + 31, s.role === "melee" ? t("Melee") : t("Ranged"), { fontFamily: FONT, fontSize: px(12), color: "#7fb8ff" }).setOrigin(0, 0.5));

    // HP and EXP as framed bars, as in battle.
    const { maxHp } = memberStats(CONTENT, PROGRESSION, m);
    const next = xpToNext(PROGRESSION, m.level);
    const bar = (by: number, label: string, frac: number, color: number, value: string) => {
      add(pixText(this, ix, by, label, 0xc8d0e0, 1).setOrigin(0, 0.5));
      add(this.add.rectangle(ix + 26, by, BAR_W, 8, 0x0c1018).setOrigin(0, 0.5).setStrokeStyle(1, 0x3a4560));
      add(this.add.rectangle(ix + 27, by, Math.max(0, (BAR_W - 2) * Math.min(1, frac)), 6, color).setOrigin(0, 0.5));
      add(this.add.text(ix + 34 + BAR_W, by, value, { fontFamily: FONT, fontSize: px(12), color: COLORS.text }).setOrigin(0, 0.5));
    };
    const hpFrac = m.hp / maxHp;
    bar(y + 52, "HP", hpFrac, hpFrac > 0.5 ? 0x58d058 : hpFrac > 0.2 ? 0xf0c838 : 0xf05050, m.hp > 0 ? `${m.hp}/${maxHp}` : t("fainted"));
    bar(y + 68, "EXP", m.xp / next, 0x58b8f8, `${m.xp}/${next}`);
    // When it evolves, and its knockouts (three and it is gone).
    const evo = s.evolution ? t("evolves at Lv {lv}", { lv: s.evolution.level }) : "";
    add(new RichText(this, ix, y + 78, HERO_INFO_X - ix - 10, 12)).setMarkup(
      `${evo ? `${tag("dim", evo)}   ` : ""}KO ${tag(m.knockouts ? "ko" : "dim", "●".repeat(m.knockouts) + "○".repeat(KNOCKOUTS_TO_DEATH - m.knockouts))}`);
  }

  update(_time: number, delta: number): void {
    if (this.stripes?.active) this.stripes.tilePositionX += delta * 0.01;
  }

  private renderDetail(m: PartyMember, add: <T extends Phaser.GameObjects.GameObject>(o: T) => T): void {
    const s = CONTENT.species[m.speciesId]!;
    const { stats, maxHp } = memberStats(CONTENT, PROGRESSION, m);
    const held = m.heldItem ? PROGRESSION.items[m.heldItem] : null;
    const evo = s.evolution ? t(" · evolves at Lv {lv}", { lv: s.evolution.level }) : "";
    const header = [
      `${tag("title", s.name)}  ${s.types.map((ty) => typeTag(ty)).join("/")}${roleTag(s.role)}  Lv ${tag("num", m.level)}  XP ${m.xp}/${xpToNext(PROGRESSION, m.level)}${tag("dim", evo)}`,
      // The stats themselves live on the Stats tab, with what each one does.
      `HP ${tag(m.hp > 0 ? "heal" : "ko", `${m.hp}/${maxHp}`)}  KO ${tag(m.knockouts ? "ko" : "dim", `${m.knockouts}/${KNOCKOUTS_TO_DEATH}`)}`,
      ...(s.ability && CONTENT.abilities[s.ability] ? [`${t("Ability:")} ${tag("special", CONTENT.abilities[s.ability]!.name)} ${tag("dim", CONTENT.abilities[s.ability]!.description)}`] : []),
      `${t("Focus:")} ${m.focus ? tag("special", focusLabel(m.focus)) : tag("dim", m.level < PROGRESSION.rules.focusLevel ? t("chosen at Lv {lv}", { lv: PROGRESSION.rules.focusLevel }) : t("not chosen"))}  ${t("Held:")} ${held ? tag("num", held.name) : tag("dim", t("nothing"))}`,
    ];
    this.renderHero(m, add);
    // Ability, focus and held item at the right of the hero band.
    add(new RichText(this, HERO_INFO_X, HERO_Y + 2, DETAIL_X + DETAIL_W - HERO_INFO_X, 12)).setMarkup(header.slice(2).join("\n"));

    // Tabs on a folder: the open one joins the page below; a gold dot marks where a decision is waiting.
    const pending = pendingChoice(CONTENT, PROGRESSION, m);
    const tabs: [Tab, string, boolean][] = [
      ["stats", t("Stats"), m.unspentPoints > 0],
      ["talents", t("Masteries"), !!pending],
      ["moves", t("Moves"), false],
      ["equipment", t("Equipment"), false],
    ];
    const tabY = HERO_Y + HERO_H + 8, tabH = 28;
    const tw = Math.floor((DETAIL_W - 18) / 4);
    add(this.add.rectangle(DETAIL_X, tabY + tabH, DETAIL_W, 540 - 8 - tabY - tabH, PAGE_FILL).setOrigin(0).setStrokeStyle(1, 0x2c3650));
    tabs.forEach(([id, label, waiting], i) => {
      const x = DETAIL_X + i * (tw + 6), on = this.tab === id;
      const tab = add(this.add.rectangle(x, tabY + (on ? 0 : 3), tw, tabH + (on ? 2 : -3), on ? PAGE_FILL : 0x121722).setOrigin(0)
        .setStrokeStyle(1, on ? 0x2c3650 : 0x1c2232));
      if (on) add(this.add.rectangle(x, tabY, tw, 2, 0xf5d76e).setOrigin(0));
      const word = add(pixText(this, x + tw / 2, tabY + tabH / 2 + 1, label, on ? 0xffffff : 0x8a93a6, 2).setOrigin(0.5));
      if (waiting) {
        const dot = add(this.add.circle(word.x + word.width / 2 + 10, word.y, 4, 0xf5d76e));
        this.tweens.add({ targets: dot, alpha: 0.35, duration: 600, yoyo: true, repeat: -1 });
      }
      tab.setInteractive({ useHandCursor: true }).on("pointerdown", () => {
        if (on) return;
        sfx(this, "select");
        this.tab = id;
        this.selectedTalent = null;
        this.message = "";
        this.render();
      });
      if (!on) tab.on("pointerover", () => tab.setFillStyle(0x1a2130)).on("pointerout", () => tab.setFillStyle(0x121722));
    });
    let y = tabY + tabH + 10;
    if (this.tab === "moves") this.renderMoves(m, y, add);
    else if (this.tab === "equipment") this.renderEquipment(m, y, add);
    else if (this.tab === "talents") this.renderTalents(m, y, add);
    else this.renderStats(m, y, add);
  }

  /**
   * The stats, one row each; hovering (or tapping) a row explains what it does and where it comes from.
   * While level-up points wait, every row gets a button: offered stats are free (★ ones give +2), the others
   * cost EV; the +1 / +2 switch sets what a point should give, and every button shows its price.
   */
  private renderStats(m: PartyMember, y: number, add: <T extends Phaser.GameObjects.GameObject>(o: T) => T): void {
    const { stats } = memberStats(CONTENT, PROGRESSION, m);
    const points = m.unspentPoints > 0;
    const ev = session.game.ev ?? 0;
    const r = PROGRESSION.rules.ev;
    if (points) y = this.renderEvHelp(y, add);
    if (points) {
      add(new RichText(this, DETAIL_X, y + 5, 300, 13)).setMarkup(
        `${tag("num", m.unspentPoints > 1 ? t("★ {n} stat points to spend", { n: m.unspentPoints }) : t("★ {n} stat point to spend", { n: m.unspentPoints }))}  ${tag("dim", `EV ${ev}`)}`);
      add(new RichText(this, DETAIL_X + 300, y + 5, 60, 12)).setMarkup(tag("dim", t("Gives:")));
      add(new Button(this, DETAIL_X + 350, y, 44, 24, "+1", () => ((this.plusTwo = false), this.render())).centerLabel().setHighlighted(!this.plusTwo));
      add(new Button(this, DETAIL_X + 398, y, 44, 24, "+2", () => ((this.plusTwo = true), this.render())).centerLabel().setHighlighted(this.plusTwo));
      y += 32;
    }
    const rowW = points ? 450 : 300;
    const tipX = DETAIL_X + rowW + 20;
    const tipW = DETAIL_W - rowW - 20;
    const tip = add(this.add.container(tipX, y).setVisible(false));
    const show = (st: StatName, gain = 0) => {
      tip.removeAll(true);
      const text = new RichText(this, 10, 8, tipW - 20, 12);
      const preview = gain ? `\n${tag("good", `${STAT_LABEL[st]} ${stats[st]} → ${stats[st] + gain}`)}` : "";
      const h = text.setMarkup(this.statTooltip(m, st) + preview);
      tip.add([this.add.rectangle(0, 0, tipW, h + 16, 0x1c2433, 0.97).setOrigin(0).setStrokeStyle(1, 0x3a4560), text]);
      this.root.bringToTop(tip);
      tip.setVisible(true);
    };
    // With nothing hovered the panel explains the focus stat (or HP), so the space is never empty.
    const rest = () => show(m.focus ?? "hp");
    const offers = points ? statOffer(CONTENT, PROGRESSION, m) : [];
    // One scale for every Pokémon you have (the highest stat among them), so bars compare across the team.
    const { party, storage } = session.game.roster;
    const max = Math.max(10, ...[...party, ...storage].flatMap((x) => STAT_NAMES.map((st) => memberStats(CONTENT, PROGRESSION, x).stats[st])));
    const segs = add(this.add.graphics());
    for (const st of STAT_NAMES) {
      const offer = offers.find((o) => o.stat === st);
      const hit = add(this.add.rectangle(DETAIL_X, y - 2, 300, 22, 0xffffff, offer ? 0.05 : 0.001).setOrigin(0).setInteractive({ useHandCursor: true }));
      hit.on("pointerover", () => (hit.setFillStyle(0xffffff, 0.08), show(st)));
      hit.on("pointerout", () => (hit.setFillStyle(0xffffff, offer ? 0.05 : 0.001), rest()));
      hit.on("pointerdown", () => show(st));
      add(new RichText(this, DETAIL_X + 6, y, 120, 13)).setMarkup(`${STAT_LABEL[st]}${m.focus === st ? ` ${tag("good", "★")}` : ""}`);
      add(new RichText(this, DETAIL_X + 130, y, 40, 13)).setMarkup(tag("num", `${stats[st]}`));
      // Segmented, in the stat's own colour (as on the handhelds' summary), on one scale for the whole team.
      const lit = Math.max(1, Math.round((SEGMENTS * stats[st]) / max));
      for (let k = 0; k < SEGMENTS; k++) segs.fillStyle(k < lit ? STAT_COLORS[st] : 0x0c1018, 1).fillRect(DETAIL_X + 172 + k * 6, y + 4, 5, 7);
      if (points) {
        // What a point gives here and what it costs: offered stats are free at their +1 (or lucky +2).
        const lucky = offer?.plus === 2;
        const gain = this.plusTwo || lucky ? 2 : 1;
        const upgrade = this.plusTwo && !lucky;
        const cost = (offer ? 0 : r.offerCost) + (upgrade ? r.upgradeCost : 0);
        const label = `+${gain}${lucky ? " ★" : ""}${cost ? ` · ${cost} EV` : ""}`;
        add(new Button(this, DETAIL_X + 310, y - 3, 130, 22, label, () =>
          this.act(() => session.update(allocatePoint(CONTENT, PROGRESSION, session.game, m.uid, st, upgrade))))
          .setEnabled(ev >= cost).setHighlighted(!!offer).onHover((over) => (over ? show(st, gain) : rest())));
      }
      y += 24;
    }
    rest();
    add(new RichText(this, DETAIL_X, y + 2, rowW, 11)).setMarkup(tag("dim", points
      ? t("Highlighted stats are offered this level and cost no EV. Hover a stat for details.")
      : t("Hover or tap a stat for details.")));
  }

  /** What a stat does in battle right now, and where its value comes from. */
  private statTooltip(m: PartyMember, st: StatName): string {
    const s = CONTENT.species[m.speciesId]!;
    const { stats, maxHp } = memberStats(CONTENT, PROGRESSION, m);
    const growth = memberFocusGrowth(PROGRESSION, m)[st];
    const talents = m.talents.reduce((sum, id) => sum + (PROGRESSION.talents[id]?.stats?.[st] ?? 0), 0);
    const r = CONTENT.rules;
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    const what: Record<StatName, string> = {
      hp: t("Max HP: +{n} per point. Now {max} HP; sturdier species also gain more HP per level.", { n: r.hpPerPoint, max: tag("num", maxHp) }),
      attack: t("Raises the damage of every move."),
      defense: t("Lowers the damage of every move that hits it."),
      speed: t("Movement: {base} + {per} per Speed point, at most {max}; now {n}. Past {last} Speed it hits harder after moving (momentum).", {
        base: r.movement.base, per: r.movement.perSpeed, max: r.movement.max, n: tag("num", baseMovement(CONTENT, stats.speed).toFixed(1)), last: speedAtMoveCap(CONTENT) }),
      willpower: t("Fills the Spirit bar faster (full: Pumped, more damage and +1 move) and shrugs off statuses foes inflict: {n} chance now.", {
        n: tag("num", pct(Math.min(0.5, r.willpower.resistPerPoint * stats.willpower))) }),
      crit: t("Critical hits: {c} chance, ×{x} damage now.", {
        c: tag("num", pct(r.crit.base + r.crit.perPoint * stats.crit)), x: tag("num", (r.crit.damage + r.crit.damagePerPoint * stats.crit).toFixed(2)) }),
    };
    // Tags do not nest: each part carries its own colour.
    const parts = [
      tag("dim", t("Species {n}", { n: s.stats[st] })),
      ...(growth ? [tag("good", t("Focus +{n}", { n: growth }))] : []),
      ...(m.statPoints[st] ? [tag("dim", t("Points +{n}", { n: m.statPoints[st] }))] : []),
      ...(talents ? [tag("dim", t("Masteries +{n}", { n: talents }))] : []),
    ];
    return [`${tag("title", STAT_LABEL[st])}  ${tag("num", stats[st])}`, what[st], parts.join(tag("dim", " · "))].join("\n");
  }

  /** What EV is: shown by itself the first time points wait, then behind the "?" button. Returns the y below. */
  private renderEvHelp(y: number, add: <T extends Phaser.GameObjects.GameObject>(o: T) => T): number {
    const helpSeen = session.game.flags?.includes(EV_HELP_FLAG) ?? false;
    if (helpSeen && !this.evHelp) {
      add(new Button(this, DETAIL_X + DETAIL_W - 28, y, 28, 22, "?", () => ((this.evHelp = true), this.render())));
      return y;
    }
    const r = PROGRESSION.rules.ev;
    const box = add(new RichText(this, DETAIL_X + 8, y + 6, DETAIL_W - 16, 12));
    const h = box.setMarkup([
      tag("title", t("Effort (EV)")),
      t("Each level-up point offers 3 stats for free; one marked ★ gives +2."),
      t("With EV you choose: switch to +2 and a point gives +2 ({up} EV more), or pick a stat that was not offered ({off} EV).", { up: r.upgradeCost, off: r.offerCost }),
      t("EV comes from winning: wild battle +{wild}, trainer +{trainer}, badge +{badge}, helping people +{quest}.", { wild: r.wildWin, trainer: r.trainerWin, badge: r.badge, quest: r.quest }),
    ].join("\n"));
    add(this.add.rectangle(DETAIL_X, y, DETAIL_W, h + 42, 0x1c2433, 0.95).setOrigin(0).setStrokeStyle(1, 0xf5d76e));
    this.root.bringToTop(box);
    add(new Button(this, DETAIL_X + 8, y + h + 12, 120, 24, t("Got it"), () => {
      this.evHelp = false;
      if (!helpSeen) session.update({ ...session.game, flags: [...(session.game.flags ?? []), EV_HELP_FLAG] });
      this.render();
    }));
    return y + h + 50;
  }

  /** Moves: the basic attack, then the toggleable moves (left); the selected move's exact rules (right). */
  private renderMoves(m: PartyMember, y: number, add: <T extends Phaser.GameObjects.GameObject>(o: T) => T): void {
    const s = CONTENT.species[m.speciesId]!;
    const basic = basicMoveOf(CONTENT, s);
    // What it fights with: one basic attack, two skills, one Bond move.
    const fighting = battleMoves(CONTENT, m);
    const activeBasic = fighting[0]!;
    const count = (slot: "skill" | "bond") => fighting.filter((mv) => slotOf(CONTENT, mv) === slot).length;
    const shown = this.selectedMove && (m.knownMoves.includes(this.selectedMove) || this.selectedMove === basic) ? this.selectedMove : activeBasic;
    // Cards in the battle's look, grouped by kind: in use in their full colour, resting ones greyed. Tap one for its rules.
    const cols = 3, cardW = 140, cardH = 44, gap = 8;
    const gridW = cols * cardW + (cols - 1) * gap;
    const groups: { slot: "basic" | "skill" | "bond"; label: string; used: string }[] = [
      { slot: "basic", label: t("Basic attack"), used: "1/1" },
      { slot: "skill", label: t("Special"), used: `${count("skill")}/${LOADOUT.skill}` },
      { slot: "bond", label: CONTENT.terms.bond, used: `${count("bond")}/${LOADOUT.bond}` },
    ];
    const known = [basic, ...m.knownMoves.filter((mv) => mv !== basic)];
    let rowY = y;
    for (const g of groups) {
      const moves = known.filter((mv) => slotOf(CONTENT, mv) === g.slot);
      if (!moves.length) continue;
      add(pixText(this, DETAIL_X, rowY, g.label.toUpperCase(), 0xc8d0e0, 1));
      add(pixText(this, DETAIL_X + gridW, rowY, t("{n} in use", { n: g.used }), 0x8a93a6, 1).setOrigin(1, 0));
      rowY += 14;
      moves.forEach((mv, i) => {
        const def = CONTENT.moves[mv]!;
        const inUse = mv === activeBasic || fighting.includes(mv);
        const look: MoveCardLook = { state: inUse ? "ready" : "noTarget", note: def.kind === "bond" ? "●".repeat(def.bondCost ?? 0) : reachShort(def) };
        add(moveCard(this, def, def.power, look, cardW, cardH, mv === shown, () => {
          this.selectedMove = mv;
          this.render();
        }, () => {}, "always").setPosition(DETAIL_X + (i % cols) * (cardW + gap), rowY + Math.floor(i / cols) * (cardH + 6)));
      });
      rowY += Math.ceil(moves.length / cols) * (cardH + 6) + 6;
    }
    add(new RichText(this, DETAIL_X, rowY, gridW, 11)).setMarkup(tag("dim", t("Full colour: in use. Grey: known, resting. Tap a card for its rules.")));
    const infoX = DETAIL_X + gridW + 20;
    const infoW = DETAIL_X + DETAIL_W - infoX;
    const h = add(new RichText(this, infoX, y, infoW, 12)).setMarkup(describeMove(CONTENT, CONTENT.moves[shown]!));
    const slot = slotOf(CONTENT, shown);
    // Only the moves that fit the loadout (an old save may list more).
    const current = fighting.filter((mv) => mv !== basic && m.activeMoves.includes(mv));
    if (shown === activeBasic) {
      add(new RichText(this, infoX, y + h + 8, infoW, 12)).setMarkup(tag("dim", t("Basic attack: always available, once per turn.")));
    } else if (slot === "basic") {
      // Another basic attack: choosing it swaps it in for the current one.
      add(new Button(this, infoX, y + h + 8, infoW, 26, t("Use as basic attack"), () => {
        const others = current.filter((x) => slotOf(CONTENT, x) !== "basic");
        this.act(() => this.updateMember(m, (x) => setActiveMoves(CONTENT, PROGRESSION, x, shown === basic ? others : [shown, ...others])));
      }).setHighlighted(true));
    } else {
      const active = current.includes(shown);
      const full = !active && count(slot) >= LOADOUT[slot];
      const label = active ? t("Remove from active moves") : full ? (slot === "bond" ? t("{bond} slot full: remove one first", { bond: CONTENT.terms.bond }) : t("Skill slots full: remove one first")) : t("Make active");
      add(new Button(this, infoX, y + h + 8, infoW, 26, label, () => {
        if (full) return;
        const next = active ? current.filter((x) => x !== shown) : [...current, shown];
        this.act(() => this.updateMember(m, (x) => setActiveMoves(CONTENT, PROGRESSION, x, next)));
      }).setHighlighted(!active && !full));
    }
    y = Math.max(y, rowY) + 6;

  }

  /**
   * The mastery grid on one page (as in Wartales): the focus row, then one row per level whose
   * masteries exclude each other (left), and the exact rules of the selected cell with its action (right).
   */
  private renderTalents(m: PartyMember, y: number, add: <T extends Phaser.GameObjects.GameObject>(o: T) => T): void {
    const s = CONTENT.species[m.speciesId]!;
    const pending = pendingChoice(CONTENT, PROGRESSION, m);
    // A branching evolution (Eevee) is picked here before anything else.
    if (pending === "evolution") {
      y += add(new RichText(this, DETAIL_X, y, DETAIL_W, 13)).setMarkup(tag("num", t("★ {name} is ready to evolve. Choose its form:", { name: s.name }))) + 10;
      evolutionChoices(CONTENT, m).forEach((id, i) => {
        const into = CONTENT.species[id]!;
        const x = DETAIL_X + i * 210;
        if (this.textures.exists(portraitKey(id))) add(this.add.image(x + 30, y + 30, portraitKey(id)).setDisplaySize(56, 56));
        add(new RichText(this, x + 66, y + 4, 140, 12)).setMarkup(`${tag("title", into.name)}
${into.types.map((ty) => typeTag(ty)).join("/")}`);
        add(new Button(this, x, y + 66, 200, 28, t("Evolve into {name}", { name: into.name }), () => {
          this.act(() => this.updateMember(m, (x2) => chooseEvolution(CONTENT, PROGRESSION, x2, id).member), t("{name} evolved into {into}!", { name: s.name, into: into.name }));
        }).setHighlighted(true));
      });
      return;
    }
    if (pending === "focus") this.time.delayedCall(200, () => showTip(this, "focus"));
    // The focus row (stat + Bond skill), then the line's rows; the whole tree can be looked at before choosing.
    const focuses = focusOptions(PROGRESSION, m.speciesId);
    const grid = memberGrid(PROGRESSION, m);
    const open = new Set(talentOptions(CONTENT, PROGRESSION, m));
    const waiting = grid.filter((r) => r.level <= m.level && !rowPick(r, m)).length;

    const status = m.level < PROGRESSION.rules.focusLevel
      ? t("The focus is chosen at Lv {lv}; until then you can look around.", { lv: PROGRESSION.rules.focusLevel })
      : pending === "focus"
        ? t("★ Choose a focus first: its stat grows every level and its Bond skill scales with it.")
        : pending === "talent"
          ? waiting > 1 ? t("★ {n} rows waiting: pick one mastery in each.", { n: waiting }) : t("★ {n} row waiting: pick one mastery in each.", { n: waiting })
          : t("All reached rows are picked.");
    y += add(new RichText(this, DETAIL_X, y, DETAIL_W, 12)).setMarkup(
      `${tag(pending ? "num" : "dim", status)}  ${tag("dim", t("One pick per row; masteries in a row exclude each other."))}`) + 6;

    const labelW = 50;
    const infoW = 270;
    const gridW = DETAIL_W - labelW - infoW - 16;
    const rowH = 28;
    // The picks, row by row: a gold path joins them so the build reads as one line through the tree.
    const path: { x: number; top: number; bottom: number }[] = [];
    const cell = (x: number, cy: number, w: number, label: string, key: string, state: "picked" | "open" | "excluded" | "locked", accent?: number) => {
      const mark = state === "picked" ? "✓ " : state === "open" ? "★ " : "";
      const b = new Button(this, x, cy, w, 24, `${mark}${label}`, () => {
        this.selectedTalent = key;
        this.render();
      }).centerLabel();
      // One look per state. Picked: filled (a taught move in its type's colour, a passive in gold). Open: a pulsing
      // gold frame. Excluded: pushed back. Locked (not reached yet): plain, its type stripe as a hint.
      if (state === "picked") {
        b.setSolid(accent !== undefined ? mixColor(accent, 0x000000, 0.2) : 0x8a6a1c);
        path.push({ x: x + w / 2, top: cy, bottom: cy + 24 });
      } else if (state === "excluded") b.setMuted();
      else {
        if (accent !== undefined) b.setAccent(accent);
        if (state === "locked") b.setLabelColor("#9aa3b6");
      }
      add(b);
      if (state === "open") {
        const ring = add(this.add.rectangle(x - 1, cy - 1, w + 2, 26).setOrigin(0).setStrokeStyle(2, 0xf5d76e));
        this.tweens.add({ targets: ring, alpha: 0.3, duration: 650, yoyo: true, repeat: -1 });
      }
      if (this.selectedTalent === key) add(this.add.rectangle(x + 2, cy + 2, w - 4, 20).setOrigin(0).setStrokeStyle(1, 0xffffff, 0.9));
      // Just learned: the cell pops and sparks fly.
      if (state === "picked" && this.justPicked === key) {
        this.justPicked = null;
        b.setScale(1.12);
        this.tweens.add({ targets: b, scale: 1, x: { from: x - w * 0.06, to: x }, y: { from: cy - 1.5, to: cy }, duration: 260, ease: "Back.easeOut" });
        sfx(this, "levelUp");
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          const st = add(this.add.star(x + w / 2, cy + 12, 5, 2, 5, 0xfff3a0));
          this.tweens.add({ targets: st, x: st.x + Math.cos(a) * (w / 2 + 14), y: st.y + Math.sin(a) * 22, alpha: 0, duration: 600, onComplete: () => st.destroy() });
        }
      }
    };
    const rowLabel = (cy: number, lv: number) =>
      add(new RichText(this, DETAIL_X, cy + 5, labelW, 12)).setMarkup(tag(m.level >= lv ? "num" : "dim", `Lv ${lv}`));
    const lines = add(this.add.graphics());

    // The focus row.
    let cy = y;
    rowLabel(cy, PROGRESSION.rules.focusLevel);
    const focusW = Math.min(180, Math.floor((gridW - 6 * (focuses.length - 1)) / Math.max(1, focuses.length)));
    // Rows are centred in the grid area.
    const rowX = (n: number, w: number) => DETAIL_X + labelW + (gridW - (n * w + 6 * (n - 1))) / 2;
    const skillType = (id: string) => {
      const mv = PROGRESSION.talents[id]?.grantsMove;
      const ty = mv ? CONTENT.moves[mv]?.type : undefined;
      return ty ? TYPE_COLORS[ty] : undefined;
    };
    focuses.forEach((f, i) => {
      const state = m.talents.includes(f.skill) ? "picked" : m.focus ? "excluded" : pending === "focus" ? "open" : "locked";
      const fx = rowX(focuses.length, focusW) + i * (focusW + 6);
      cell(fx, cy, focusW, PROGRESSION.talents[f.skill]?.name ?? f.skill, `focus:${f.skill}`, state, skillType(f.skill));
      // Under the skill: what the pick adds to its stat.
      add(this.add.text(fx + focusW / 2, cy + 26, focusBonusLabel(f), { fontFamily: FONT, fontSize: px(11), color: "#7ed321" }).setOrigin(0.5, 0));
    });
    // The path leaves the focus pick below its bonus line, not through it.
    if (path[0]) path[0] = { ...path[0], bottom: path[0].bottom + 16 };
    cy += rowH + 14;

    // Mastery rows.
    for (const row of grid) {
      lines.lineStyle(1, 0x2a3245, 1).lineBetween(DETAIL_X, cy - 3, DETAIL_X + labelW + gridW, cy - 3);
      rowLabel(cy, row.level);
      const pick = rowPick(row, m);
      const w = Math.min(180, Math.floor((gridW - 6 * (row.options.length - 1)) / row.options.length));
      row.options.forEach((id, i) => {
        const state = pick === id ? "picked" : pick ? "excluded" : open.has(id) ? "open" : "locked";
        cell(rowX(row.options.length, w) + i * (w + 6), cy, w, PROGRESSION.talents[id]?.name ?? id, id, state, skillType(id));
      });
      cy += rowH;
    }
    path.slice(1).forEach((p, i) => lines.lineStyle(2, 0xf5d76e, 0.55).lineBetween(path[i]!.x, path[i]!.bottom, p.x, p.top));

    // Detail panel.
    const infoX = DETAIL_X + DETAIL_W - infoW;
    const key = this.selectedTalent;
    let iy = y;
    const focus = key?.startsWith("focus:") ? focuses.find((f) => `focus:${f.skill}` === key) : undefined;
    if (focus) {
      const skill = PROGRESSION.talents[focus.skill]!;
      iy += add(new RichText(this, infoX, iy, infoW, 12)).setMarkup([
        tag("title", skill.name),
        tag("dim", t("Focus · Lv {lv}", { lv: PROGRESSION.rules.focusLevel })),
        focus.second
          ? t("{stat} +{n} and {second} +{n} now, and they keep growing in turns as it levels up.", { stat: tag("good", STAT_LABEL[focus.stat]), second: tag("good", STAT_LABEL[focus.second]), n: PROGRESSION.rules.focusBonus / 2 })
          : t("{stat} +{n} now, and it keeps growing as it levels up.", { stat: tag("good", STAT_LABEL[focus.stat]), n: PROGRESSION.rules.focusBonus }),
        t("Learns the Bond skill {skill}:", { skill: tag("special", skill.name) }),
        ...describeTalent(CONTENT, PROGRESSION, skill),
      ].join("\n")) + 8;
      if (pending === "focus")
        add(new Button(this, infoX, iy, infoW, 28, t("Choose {focus}", { focus: skill.name }), () =>
          ((this.justPicked = `focus:${focus.skill}`), this.act(() => this.updateMember(m, (x2) => chooseFocus(CONTENT, PROGRESSION, x2, focus.skill)), t("{name} chose {focus}.", { name: s.name, focus: skill.name })))).setHighlighted(true));
    } else if (key && PROGRESSION.talents[key]) {
      const tal = PROGRESSION.talents[key]!;
      const row = grid.find((r) => r.options.includes(key));
      const kind = tal.grantsMove ? t("Skill") : t("Passive");
      iy += add(new RichText(this, infoX, iy, infoW, 12)).setMarkup(
        [tag("title", tal.name), tag("dim", `${kind} · Lv ${row?.level ?? "?"}`), ...describeTalent(CONTENT, PROGRESSION, tal)].join("\n")) + 8;
      if (open.has(key)) {
        add(new Button(this, infoX, iy, infoW, 28, t("Learn {talent}", { talent: tal.name }), () => {
          this.justPicked = key;
          this.act(() => this.updateMember(m, (x2) => chooseTalent(CONTENT, PROGRESSION, x2, key)), t("{name} learned {talent}.", { name: s.name, talent: tal.name }));
          this.selectedTalent = null;
        }).setHighlighted(true));
      } else if (m.talents.includes(key)) add(new RichText(this, infoX, iy, infoW, 12)).setMarkup(tag("good", t("Learned.")));
    } else {
      add(new RichText(this, infoX, iy, infoW, 12)).setMarkup(
        [tag("dim", t("Tap a cell to see its exact effect.")), "", tag("dim", t("✓ picked · ★ can pick now")), tag("dim", t("Faded: excluded by the pick in its row."))].join("\n"));
    }

    // Reset (respec) for Pokédollars.
    if (m.focus !== null) {
      const cost = respecCost(PROGRESSION, m);
      add(new Button(this, infoX, 470, infoW, 26, t("Reset focus & masteries (₽{cost})", { cost }), () =>
        this.act(() => session.update(respecMember(CONTENT, PROGRESSION, session.game, m.uid)), t("{name} forgot its focus and masteries.", { name: s.name })))
        .setEnabled(session.game.money >= cost));
    }
  }

  /** Healing items, then the held item: what it holds now and every held item in the bag with its exact effect. */
  private renderEquipment(m: PartyMember, y: number, add: <T extends Phaser.GameObjects.GameObject>(o: T) => T): void {
    const s = CONTENT.species[m.speciesId]!;
    // An item's icon at the left end of its button (the label leaves room for it).
    const iconButton = (b: Button, id: string) => b.add(this.add.image(16, 13, itemIcon(this, id)).setDisplaySize(16, 16));
    const potions = Object.entries(session.game.inventory.items).filter(([id, n]) => n > 0 && PROGRESSION.items[id]?.kind === "potion");
    const remedies = Object.entries(session.game.inventory.items).filter(([id, n]) => n > 0 && PROGRESSION.items[id]?.kind === "remedy");
    const candies = session.game.inventory.items[CANDY] ?? 0;
    const max = memberMaxHp(CONTENT, PROGRESSION, m);
    // One status line (HP, knockout marks), then every usable item as one row of buttons, wrapping only if needed.
    const ko = m.knockouts > 0
      ? `   ${tag("ko", t("Knockout marks {n}/3", { n: m.knockouts }))}${remedies.length ? "" : ` ${tag("dim", t("· a Revival Herb or Pokémon Center treatment removes them"))}`}`
      : "";
    y += add(new RichText(this, DETAIL_X, y, DETAIL_W, 13)).setMarkup(`${tag("title", t("Healing"))}  HP ${m.hp}/${max}${ko}`) + 4;
    const uses: { id: string; label: string; enabled: boolean; run: () => void; ok: string }[] = [
      ...potions.map(([id, n]) => {
        const item = PROGRESSION.items[id]!;
        // Greyed with its reason: full HP, or fainted (only a Pokémon Center helps then).
        const why = m.hp <= 0 ? t("fainted") : m.hp >= max ? t("HP full") : "";
        return { id, label: `${t("Use {item} (+{hp} HP) ×{n}", { item: item.name, hp: String(item.heal), n })}${why ? ` · ${why}` : ""}`, enabled: m.hp > 0 && m.hp < max,
          run: () => session.update(usePotion(CONTENT, PROGRESSION, session.game, m.uid, id)), ok: t("{name} recovered HP.", { name: s.name }) };
      }),
      // Rare Candy: one level at once; reaching the evolution level plays its scene at once.
      ...(candies > 0 ? [{ id: CANDY, label: t("Use Rare Candy (+1 Lv) ×{n}", { n: candies }), enabled: m.level < PROGRESSION.rules.maxLevel, run: () => {
        session.update(useRareCandy(CONTENT, PROGRESSION, session.game, m.uid).game);
        if (readyToEvolve(CONTENT, findMember(session.game, m.uid)!)) this.time.delayedCall(0, () => this.evolve(m.uid));
      }, ok: t("{name} grew to Lv {lv}!", { name: s.name, lv: m.level + 1 }) }] : []),
      // Knockout marks: only remedies (or Pokémon Center treatment) remove them.
      ...(m.knockouts > 0 ? remedies.map(([id, n]) => {
        const item = PROGRESSION.items[id]!;
        return { id, label: t("Use {item} (−{marks} mark) ×{n}", { item: item.name, marks: String(item.clearsKnockouts), n }), enabled: true,
          run: () => session.update(useRemedy(PROGRESSION, session.game, m.uid, id)), ok: t("A knockout mark faded from {name}.", { name: s.name }) };
      }) : []),
    ];
    if (!uses.length) y += add(new RichText(this, DETAIL_X, y, DETAIL_W, 12)).setMarkup(tag("dim", t("No potions. Resting at camp restores all HP."))) + 8;
    let x = DETAIL_X;
    for (const u of uses) {
      // As wide as its label (the Button's own 14px font), plus room for the icon.
      const probe = this.add.text(0, 0, `    ${u.label}`, { fontFamily: FONT, fontSize: "14px" });
      const w = Math.ceil(probe.width) + 20;
      probe.destroy();
      if (x > DETAIL_X && x + w > DETAIL_X + DETAIL_W) {
        x = DETAIL_X;
        y += 32;
      }
      iconButton(add(new Button(this, x, y, w, 26, `    ${u.label}`, () => this.act(u.run, u.ok)).setEnabled(u.enabled)), u.id);
      x += w + 6;
    }
    if (uses.length) y += 36;

    const held = m.heldItem ? PROGRESSION.items[m.heldItem] : null;
    // The held item's icon leads the line.
    const heldIcon = held ? 24 : 0;
    if (held) add(this.add.image(DETAIL_X + 9, y + 8, itemIcon(this, held.id)).setDisplaySize(18, 18));
    // Take off sits at the end of the same line, so it costs no row of its own.
    if (held) add(new Button(this, DETAIL_X + DETAIL_W - 120, y - 4, 120, 24, t("Take off"), () => this.act(() => session.update(equipItem(PROGRESSION, session.game, m.uid, null)), t("{item} returned to the bag.", { item: held.name }))));
    y += add(new RichText(this, DETAIL_X + heldIcon, y, DETAIL_W - heldIcon - (held ? 130 : 0), 13)).setMarkup(
      `${tag("title", t("Holding"))}: ${held ? `${tag("num", held.name)} · ${describeItem(CONTENT, held).join(" · ")}` : tag("dim", t("nothing (one held item per Pokémon)"))}`) + 6;
    y += 6;
    const bagItems = Object.entries(session.game.inventory.items).filter(([id, n]) => n > 0 && PROGRESSION.items[id]?.kind === "held");
    y += add(new RichText(this, DETAIL_X, y, DETAIL_W, 13)).setMarkup(tag("title", t("In the bag")) + " " + tag("dim", held ? t("(tap one to swap)") : t("(tap one to equip)"))) + 6;
    if (!bagItems.length) {
      add(new RichText(this, DETAIL_X, y, DETAIL_W, 12)).setMarkup(tag("dim", t("No held items. The Poké Mart in towns sells them.")));
      return;
    }
    // A compact grid: tap a tile to equip (or swap to) that item. Only the rows that fit are drawn
    // (masks don't clip here), the rest scroll in with the wheel or the arrows.
    const COLS = 3;
    const gap = 4;
    const tileW = (DETAIL_W - gap * (COLS - 1)) / COLS;
    const tileH = 44;
    const rows = Math.ceil(bagItems.length / COLS);
    const fit = Math.max(1, Math.floor((500 - y + gap) / (tileH + gap)));
    this.bagRow = Math.min(this.bagRow, Math.max(0, rows - fit));
    if (rows > fit) {
      add(new Button(this, DETAIL_X + DETAIL_W - 76, y - 24, 36, 20, "▲", () => ((this.bagRow -= 1), this.render())).setEnabled(this.bagRow > 0));
      add(new Button(this, DETAIL_X + DETAIL_W - 36, y - 24, 36, 20, "▼", () => ((this.bagRow += 1), this.render())).setEnabled(this.bagRow < rows - fit));
    }
    bagItems.slice(this.bagRow * COLS, (this.bagRow + fit) * COLS).forEach(([id, n], i) => {
      const item = PROGRESSION.items[id]!;
      const x = DETAIL_X + (i % COLS) * (tileW + gap);
      const ty = y + Math.floor(i / COLS) * (tileH + gap);
      const tile = add(new Button(this, x, ty, tileW, tileH, "", () =>
        this.act(() => session.update(equipItem(PROGRESSION, session.game, m.uid, id)), t("{name} now holds {item}.", { name: s.name, item: item.name }))));
      tile.add(this.add.image(16, tileH / 2, itemIcon(this, id)).setDisplaySize(20, 20));
      const label = new RichText(this, 32, 4, tileW - 38, 11);
      label.setMarkup(`${tag("num", item.name)} ×${n}
${describeItem(CONTENT, item).join(" · ")}`);
      tile.add(label);
    });
  }
}

export type Tab = "stats" | "talents" | "moves" | "equipment";
