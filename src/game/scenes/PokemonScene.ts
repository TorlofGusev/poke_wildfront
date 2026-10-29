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
import { portraitKey } from "../sprites";
import { Button } from "../ui/Button";
import { describeItem, focusLabel, describeTalent, STAT_LABEL, STAT_SHORT } from "../ui/describeEffects";
import { describeMove, reachShort } from "../ui/describeMove";
import { tag } from "../ui/markup";
import { t } from "../i18n";
import { RichText } from "../ui/RichText";
import { showTip } from "../tips";
import { COLORS, FONT, TYPE_COLORS, px } from "../ui/theme";

const LIST_X = 16;
const DETAIL_X = 16;
const DETAIL_W = 928;

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

  constructor() {
    super("Pokemon");
  }

  /** The EV explanation, reopened with "?". */
  private evHelp = false;
  /** Level-up points: the +1 / +2 switch (+2 costs EV unless the offer is a lucky one). */
  private plusTwo = false;

  init(data: { uid: string; tab?: Tab }): void {
    this.message = "";
    this.selected = data.uid;
    this.tab = data.tab ?? (pendingChoice(CONTENT, PROGRESSION, findMember(session.game, data.uid)!) ? "talents" : "stats");
    this.selectedTalent = null;
  }

  create(): void {
    this.root = this.add.container(0, 0);
    this.render();
  }

  private act(f: () => void, success?: string): void {
    try {
      f();
      this.message = success ? tag("good", success) : "";
    } catch (e) {
      this.message = tag("bad", e instanceof Error ? t("Cannot do that: {reason}.", { reason: t(e.message) }) : t("Cannot do that."));
    }
    this.render();
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
      add(new Button(this, prev.x - 136, 12, 128, 26, inParty ? t("📦 To storage") : t("↩ To party"), () =>
        this.act(() => session.update({ ...session.game, roster: moveBetweenPartyAndStorage(session.game.roster, shown.uid) }))));
    }

    const member = this.selected ? findMember(session.game, this.selected) : undefined;
    if (member) this.renderDetail(member, add);
    if (this.message) add(new RichText(this, DETAIL_X, 506, DETAIL_W, 12)).setMarkup(this.message);
  }

  private card(x: number, y: number, m: PartyMember): Phaser.GameObjects.Container {
    const s = CONTENT.species[m.speciesId]!;
    const sel = m.uid === this.selected;
    const pending = pendingChoice(CONTENT, PROGRESSION, m) ?? (m.unspentPoints > 0 ? "points" : null);
    const bg = this.add.rectangle(0, 0, 304, 36, sel ? 0x2a3245 : 0x1c2130).setOrigin(0)
      .setStrokeStyle(sel ? 2 : 1, sel ? 0xf5d76e : m.knockouts === 2 ? 0xd0021b : 0x3a4560);
    bg.setInteractive({ useHandCursor: true }).on("pointerdown", () => {
      this.selected = m.uid;
      this.selectedTalent = null;
      this.message = "";
      this.render();
    });
    const dot = this.textures.exists(portraitKey(m.speciesId))
      ? this.add.image(18, 18, portraitKey(m.speciesId)).setDisplaySize(30, 30)
      : this.add.circle(18, 18, 11, TYPE_COLORS[s.types[0]!] ?? 0x888888);
    const name = this.add.text(36, 3, `${s.name}  Lv ${m.level}`, { fontFamily: FONT, fontSize: px(13), color: COLORS.text });
    const max = memberMaxHp(CONTENT, PROGRESSION, m);
    const hp = this.add.text(36, 19, m.hp > 0 ? `HP ${m.hp}/${max}` : t("fainted"), { fontFamily: FONT, fontSize: px(11), color: m.hp > 0 ? COLORS.dim : COLORS.bad });
    const pips = "●".repeat(m.knockouts) + "○".repeat(KNOCKOUTS_TO_DEATH - m.knockouts);
    const ko = this.add.text(296, 18, `${pending ? "★ " : ""}KO ${pips}`, { fontFamily: FONT, fontSize: px(12), color: pending ? "#f5d76e" : m.knockouts === 2 ? COLORS.bad : COLORS.dim }).setOrigin(1, 0.5);
    return this.add.container(x, y, [bg, dot, name, hp, ko]);
  }

  private renderDetail(m: PartyMember, add: <T extends Phaser.GameObjects.GameObject>(o: T) => T): void {
    const s = CONTENT.species[m.speciesId]!;
    const { stats, maxHp } = memberStats(CONTENT, PROGRESSION, m);
    const held = m.heldItem ? PROGRESSION.items[m.heldItem] : null;
    const evo = s.evolution ? t(" · evolves at Lv {lv}", { lv: s.evolution.level }) : "";
    const header = [
      `${tag("title", s.name)}  ${s.types.map((t) => tag(t, t)).join("/")}${roleTag(s.role)}  Lv ${tag("num", m.level)}  XP ${m.xp}/${xpToNext(PROGRESSION, m.level)}${tag("dim", evo)}`,
      // The stats themselves live on the Stats tab, with what each one does.
      `HP ${tag(m.hp > 0 ? "heal" : "ko", `${m.hp}/${maxHp}`)}  KO ${tag(m.knockouts ? "ko" : "dim", `${m.knockouts}/${KNOCKOUTS_TO_DEATH}`)}`,
      ...(s.ability && CONTENT.abilities[s.ability] ? [`${t("Ability:")} ${tag("special", CONTENT.abilities[s.ability]!.name)} ${tag("dim", CONTENT.abilities[s.ability]!.description)}`] : []),
      `${t("Focus:")} ${m.focus ? tag("special", focusLabel(m.focus)) : tag("dim", m.level < PROGRESSION.rules.focusLevel ? t("chosen at Lv {lv}", { lv: PROGRESSION.rules.focusLevel }) : t("not chosen"))}  ${t("Held:")} ${held ? tag("num", held.name) : tag("dim", t("nothing"))}`,
    ];
    let y = 48;
    if (this.textures.exists(portraitKey(m.speciesId))) add(this.add.image(DETAIL_X + 32, y + 32, portraitKey(m.speciesId)).setDisplaySize(64, 64));
    y += Math.max(64, add(new RichText(this, DETAIL_X + 76, y, DETAIL_W - 76, 13)).setMarkup(header.join("\n"))) + 8;

    // Tabs. A ★ marks where a decision is waiting.
    const pending = pendingChoice(CONTENT, PROGRESSION, m);
    const tabs: [Tab, string][] = [
      ["stats", `${m.unspentPoints > 0 ? "★ " : ""}${t("Stats")}`],
      ["talents", `${pending ? "★ " : ""}${t("Masteries")}`],
      ["moves", t("Moves")],
      ["equipment", t("Equipment")],
    ];
    const tw = Math.floor((DETAIL_W - 18) / 4);
    tabs.forEach(([id, label], i) => {
      add(new Button(this, DETAIL_X + i * (tw + 6), y, tw, 26, label, () => {
        this.tab = id;
        this.selectedTalent = null;
        this.message = "";
        this.render();
      }).setHighlighted(this.tab === id));
    });
    y += 34;
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
    const max = Math.max(10, ...STAT_NAMES.map((st) => stats[st]));
    for (const st of STAT_NAMES) {
      const offer = offers.find((o) => o.stat === st);
      const hit = add(this.add.rectangle(DETAIL_X, y - 2, 300, 22, 0xffffff, offer ? 0.05 : 0.001).setOrigin(0).setInteractive({ useHandCursor: true }));
      hit.on("pointerover", () => (hit.setFillStyle(0xffffff, 0.08), show(st)));
      hit.on("pointerout", () => (hit.setFillStyle(0xffffff, offer ? 0.05 : 0.001), rest()));
      hit.on("pointerdown", () => show(st));
      add(new RichText(this, DETAIL_X + 6, y, 120, 13)).setMarkup(`${STAT_LABEL[st]}${m.focus === st ? ` ${tag("good", "★")}` : ""}`);
      add(new RichText(this, DETAIL_X + 130, y, 40, 13)).setMarkup(tag("num", `${stats[st]}`));
      add(this.add.rectangle(DETAIL_X + 172, y + 7, 120, 5, 0x10141c).setOrigin(0, 0.5));
      add(this.add.rectangle(DETAIL_X + 172, y + 7, Math.max(2, (120 * stats[st]) / max), 5, 0x7ed321).setOrigin(0, 0.5));
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
    y += add(new RichText(this, DETAIL_X, y, DETAIL_W, 13)).setMarkup(
      `${tag("title", t("Moves"))}  ◆ ${tag("basic", t("basic"))} 1/1  ■ ${tag("special", t("special"))} ${count("skill")}/${LOADOUT.skill}  ▲ ${tag("ultimate", CONTENT.terms.bond)} ${count("bond")}/${LOADOUT.bond}  ${tag("dim", t("(filled: in use; tap to inspect)"))}`) + 4;
    const listW = 440;
    // As on the battle buttons: type, reach ↔, power ⚔, a Bond move's cost in Bond pips (the groups give the kind).
    const kindLabel = (id: string) => {
      const d = CONTENT.moves[id]!;
      const r = reachShort(d);
      return `${d.type.padEnd(9)}↔${r.padEnd(4)}${d.power ? `⚔${String(d.power).padStart(3)}` : "    "}${d.kind === "bond" ? `  ${"●".repeat(d.bondCost ?? 0)}` : ""}`;
    };
    const shown = this.selectedMove && (m.knownMoves.includes(this.selectedMove) || this.selectedMove === basic) ? this.selectedMove : activeBasic;
    // Grouped by kind (basic attacks, skills, Bond moves), a thin rule between the groups.
    const order = { basic: 0, skill: 1, bond: 2 } as const;
    const rows = [basic, ...m.knownMoves.filter((mv) => mv !== basic)].sort((a, b) => order[slotOf(CONTENT, a)] - order[slotOf(CONTENT, b)]);
    let rowY = y;
    rows.forEach((mv, i) => {
      if (i > 0 && slotOf(CONTENT, mv) !== slotOf(CONTENT, rows[i - 1]!)) {
        add(this.add.rectangle(DETAIL_X, rowY + 1, listW, 1, 0x6b7899, 0.9).setOrigin(0));
        rowY += 6;
      }
      const def = CONTENT.moves[mv]!;
      // Filled: in use; hollow: known but resting. ◆ basic, ■ special, ▲ Bond.
      const slotOfMv = slotOf(CONTENT, mv);
      const inUse = mv === activeBasic || fighting.includes(mv);
      const mark = slotOfMv === "basic" ? (inUse ? "◆" : "◇") : slotOfMv === "bond" ? (inUse ? "▲" : "△") : inUse ? "■" : "□";
      add(new Button(this, DETAIL_X, rowY, listW, 24, `${mark} ${def.name.padEnd(13)} ${kindLabel(mv)}`, () => {
        this.selectedMove = mv;
        this.render();
      }).setHighlighted(mv === shown));
      rowY += 28;
    });
    const infoX = DETAIL_X + listW + 16;
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
${into.types.map((ty) => tag(ty, ty)).join("/")}`);
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
    const rowH = 30;
    const cell = (x: number, cy: number, w: number, label: string, key: string, state: "picked" | "open" | "excluded" | "locked", accent?: number) => {
      const mark = state === "picked" ? "✓ " : state === "open" ? "★ " : "";
      const b = new Button(this, x, cy, w, 24, `${mark}${label}`, () => {
        this.selectedTalent = key;
        this.render();
      }).setHighlighted(this.selectedTalent === key || state === "picked").centerLabel();
      // Masteries that teach a new move wear that move's type colour.
      if (accent !== undefined) b.setAccent(accent);
      if (state === "excluded") b.setAlpha(0.35);
      if (state === "locked") b.setAlpha(0.6);
      add(b);
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
          this.act(() => this.updateMember(m, (x2) => chooseFocus(CONTENT, PROGRESSION, x2, focus.skill)), t("{name} chose {focus}.", { name: s.name, focus: skill.name }))).setHighlighted(true));
    } else if (key && PROGRESSION.talents[key]) {
      const tal = PROGRESSION.talents[key]!;
      const row = grid.find((r) => r.options.includes(key));
      const kind = tal.grantsMove ? t("Skill") : t("Passive");
      iy += add(new RichText(this, infoX, iy, infoW, 12)).setMarkup(
        [tag("title", tal.name), tag("dim", `${kind} · Lv ${row?.level ?? "?"}`), ...describeTalent(CONTENT, PROGRESSION, tal)].join("\n")) + 8;
      if (open.has(key)) {
        add(new Button(this, infoX, iy, infoW, 28, t("Learn {talent}", { talent: tal.name }), () => {
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
    const potions = Object.entries(session.game.inventory.items).filter(([id, n]) => n > 0 && PROGRESSION.items[id]?.kind === "potion");
    const max = memberMaxHp(CONTENT, PROGRESSION, m);
    y += add(new RichText(this, DETAIL_X, y, DETAIL_W, 13)).setMarkup(`${tag("title", t("Healing"))}  HP ${m.hp}/${max}`) + 4;
    if (!potions.length) y += add(new RichText(this, DETAIL_X, y, DETAIL_W, 12)).setMarkup(tag("dim", t("No potions. Resting at camp restores all HP."))) + 8;
    potions.forEach(([id, n], i) => {
      const item = PROGRESSION.items[id]!;
      add(new Button(this, DETAIL_X + i * 236, y, 230, 26, t("Use {item} (+{hp} HP) ×{n}", { item: item.name, hp: String(item.heal), n }), () =>
        this.act(() => session.update(usePotion(CONTENT, PROGRESSION, session.game, m.uid, id)), t("{name} recovered HP.", { name: s.name }))).setEnabled(m.hp > 0 && m.hp < max));
    });
    if (potions.length) y += 36;
    // Rare Candy: one level at once.
    const candies = session.game.inventory.items[CANDY] ?? 0;
    if (candies > 0) {
      add(new Button(this, DETAIL_X, y, 300, 26, t("Use Rare Candy (+1 Lv) ×{n}", { n: candies }), () =>
        this.act(() => session.update(useRareCandy(CONTENT, PROGRESSION, session.game, m.uid).game), t("{name} grew to Lv {lv}!", { name: s.name, lv: m.level + 1 }))).setEnabled(m.level < PROGRESSION.rules.maxLevel));
      y += 36;
    }
    // Knockout marks: only remedies (or Pokémon Center treatment) remove them.
    const remedies = Object.entries(session.game.inventory.items).filter(([id, n]) => n > 0 && PROGRESSION.items[id]?.kind === "remedy");
    if (m.knockouts > 0) {
      y += add(new RichText(this, DETAIL_X, y, DETAIL_W, 12)).setMarkup(`${tag("ko", t("Knockout marks {n}/3", { n: m.knockouts }))} ${tag("dim", remedies.length ? "" : t("· a Revival Herb or Pokémon Center treatment removes them"))}`) + 4;
      remedies.forEach(([id, n], i) => {
        const item = PROGRESSION.items[id]!;
        add(new Button(this, DETAIL_X + i * 236, y, 230, 26, t("Use {item} (−{marks} mark) ×{n}", { item: item.name, marks: String(item.clearsKnockouts), n }), () =>
          this.act(() => session.update(useRemedy(PROGRESSION, session.game, m.uid, id)), t("A knockout mark faded from {name}.", { name: s.name }))));
      });
      if (remedies.length) y += 36;
    }

    const held = m.heldItem ? PROGRESSION.items[m.heldItem] : null;
    y += add(new RichText(this, DETAIL_X, y, DETAIL_W, 13)).setMarkup(
      `${tag("title", t("Holding"))}: ${held ? `${tag("num", held.name)} · ${describeItem(CONTENT, held).join(" · ")}` : tag("dim", t("nothing (one held item per Pokémon)"))}`) + 6;
    if (held) {
      add(new Button(this, DETAIL_X, y, 160, 24, t("Take off"), () => this.act(() => session.update(equipItem(PROGRESSION, session.game, m.uid, null)), t("{item} returned to the bag.", { item: held.name }))));
      y += 32;
    }
    const bagItems = Object.entries(session.game.inventory.items).filter(([id, n]) => n > 0 && PROGRESSION.items[id]?.kind === "held");
    y += add(new RichText(this, DETAIL_X, y, DETAIL_W, 13)).setMarkup(tag("title", t("In the bag"))) + 4;
    if (!bagItems.length) {
      add(new RichText(this, DETAIL_X, y, DETAIL_W, 12)).setMarkup(tag("dim", t("No held items. The Poké Mart in towns sells them.")));
      return;
    }
    for (const [id, n] of bagItems) {
      const item = PROGRESSION.items[id]!;
      add(this.add.rectangle(DETAIL_X, y, DETAIL_W, 40, 0x1c2130).setOrigin(0).setStrokeStyle(1, 0x3a4560));
      add(new RichText(this, DETAIL_X + 8, y + 4, DETAIL_W - 120, 12)).setMarkup(`${tag("num", item.name)} ×${n}\n${describeItem(CONTENT, item).join(" · ")}`);
      add(new Button(this, DETAIL_X + DETAIL_W - 100, y + 8, 92, 24, held ? t("Swap") : t("Equip"), () =>
        this.act(() => session.update(equipItem(PROGRESSION, session.game, m.uid, id)), t("{name} now holds {item}.", { name: s.name, item: item.name }))));
      y += 46;
    }
  }
}

export type Tab = "stats" | "talents" | "moves" | "equipment";
