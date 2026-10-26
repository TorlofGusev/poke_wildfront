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
  usePotion,
  useRemedy,
  withMember,
  type PartyMember,
} from "../../core/party";
import {
  basicMoveOf,
  chooseRole,
  chooseTalent,
  masteryGrid,
  memberStats,
  roleGrowth,
  pendingChoice,
  respecCost,
  roleOptions,
  rowPick,
  setActiveMoves,
  talentFor,
  talentOptions,
  xpToNext,
} from "../../core/progression";
import { STAT_NAMES, type StatName } from "../../core/battle";
import { session } from "../session";
import { portraitKey } from "../sprites";
import { Button } from "../ui/Button";
import { describeGrowth, describeItem, describeTalent, STAT_LABEL, STAT_SHORT, statLine } from "../ui/describeEffects";
import { describeMove } from "../ui/describeMove";
import { tag } from "../ui/markup";
import { RichText } from "../ui/RichText";
import { COLORS, FONT, TYPE_COLORS, px } from "../ui/theme";

const LIST_X = 16;
const DETAIL_X = 16;
const DETAIL_W = 928;

/** One Pokémon: stats (and stat points), talent tree, moves, equipment. */
export class PokemonScene extends Phaser.Scene {
  private root!: Phaser.GameObjects.Container;
  private selected: string | null = null;
  private message = "";
  private tab: Tab = "stats";
  private selectedTalent: string | null = null;
  private previewRole: string | null = null;
  private selectedMove: string | null = null;

  constructor() {
    super("Pokemon");
  }

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
      this.message = tag("bad", e instanceof Error ? `Cannot do that: ${e.message}.` : "Cannot do that.");
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

    add(new Button(this, LIST_X, 12, 120, 26, "← Camp", () => this.scene.start("Party", { rested: false, choosingMeal: false })));
    // ◀ ▶ cycle through the same list (party, or storage when viewing a stored Pokémon).
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
    add(new Button(this, LIST_X + 132, 12, 40, 26, " ◀", () => go(-1)).setEnabled(list.length > 1));
    text(LIST_X + 180, 17, `${idx + 1}/${list.length}${list === roster.storage ? " in storage" : ""}`, COLORS.dim, 13);
    add(new Button(this, LIST_X + 270, 12, 40, 26, " ▶", () => go(1)).setEnabled(list.length > 1));
    text(LIST_X + 330, 18, `₽${money}`, "#f5d76e", 14);

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
    const hp = this.add.text(36, 19, m.hp > 0 ? `HP ${m.hp}/${max}` : "fainted", { fontFamily: FONT, fontSize: px(11), color: m.hp > 0 ? COLORS.dim : COLORS.bad });
    const pips = "●".repeat(m.knockouts) + "○".repeat(KNOCKOUTS_TO_DEATH - m.knockouts);
    const ko = this.add.text(296, 18, `${pending ? "★ " : ""}KO ${pips}`, { fontFamily: FONT, fontSize: px(12), color: pending ? "#f5d76e" : m.knockouts === 2 ? COLORS.bad : COLORS.dim }).setOrigin(1, 0.5);
    return this.add.container(x, y, [bg, dot, name, hp, ko]);
  }

  private renderDetail(m: PartyMember, add: <T extends Phaser.GameObjects.GameObject>(o: T) => T): void {
    const s = CONTENT.species[m.speciesId]!;
    const { stats, maxHp } = memberStats(CONTENT, PROGRESSION, m);
    const role = m.role ? PROGRESSION.roles[m.role] : null;
    const held = m.heldItem ? PROGRESSION.items[m.heldItem] : null;
    const evo = s.evolution ? ` · evolves at Lv ${s.evolution.level}` : "";
    const header = [
      `${tag("title", s.name)}  ${s.types.map((t) => tag(t, t)).join("/")}  Lv ${tag("num", m.level)}  XP ${m.xp}/${xpToNext(PROGRESSION, m.level)}${tag("dim", evo)}`,
      `HP ${tag(m.hp > 0 ? "heal" : "ko", `${m.hp}/${maxHp}`)}  ${statLine(stats)}  KO ${tag(m.knockouts ? "ko" : "dim", `${m.knockouts}/${KNOCKOUTS_TO_DEATH}`)}`,
      ...(s.ability && CONTENT.abilities[s.ability] ? [`Ability: ${tag("special", CONTENT.abilities[s.ability]!.name)} ${tag("dim", CONTENT.abilities[s.ability]!.description)}`] : []),
      `Role: ${role ? `${tag("special", role.name)}` : tag("dim", m.level < PROGRESSION.rules.roleLevel ? `chosen at Lv ${PROGRESSION.rules.roleLevel}` : "not chosen")}  Held: ${held ? tag("num", held.name) : tag("dim", "nothing")}`,
    ];
    let y = 48;
    if (this.textures.exists(portraitKey(m.speciesId))) add(this.add.image(DETAIL_X + DETAIL_W - 32, 12 + 32, portraitKey(m.speciesId)).setDisplaySize(64, 64));
    y += add(new RichText(this, DETAIL_X, y, DETAIL_W - 76, 13)).setMarkup(header.join("\n")) + 8;

    // Tabs. A ★ marks where a decision is waiting.
    const pending = pendingChoice(CONTENT, PROGRESSION, m);
    const tabs: [Tab, string][] = [
      ["stats", `${m.unspentPoints > 0 ? "★ " : ""}Stats`],
      ["talents", `${pending ? "★ " : ""}Masteries`],
      ["moves", "Moves"],
      ["equipment", "Equipment"],
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

  /** Where every stat comes from (species, role growth, points, talents), then the stat points to spend. */
  private renderStats(m: PartyMember, y: number, add: <T extends Phaser.GameObjects.GameObject>(o: T) => T): void {
    const s = CONTENT.species[m.speciesId]!;
    const { stats, maxHp } = memberStats(CONTENT, PROGRESSION, m);
    const growth = roleGrowth(PROGRESSION, m.role, m.level);
    const fromTalents = (st: StatName) => m.talents.reduce((sum, t) => sum + (PROGRESSION.talents[t]?.stats?.[st] ?? 0), 0);
    const cols = [0, 150, 260, 380, 490, 600];
    const head = ["Stat", "Species", "Role growth", "Points", "Masteries", "Total"];
    head.forEach((h, i) => add(new RichText(this, DETAIL_X + cols[i]!, y, 140, 12)).setMarkup(tag("dim", h)));
    y += 20;
    for (const st of STAT_NAMES) {
      const cells = [STAT_LABEL[st], `${s.stats[st]}`, growth[st] ? tag("good", `+${growth[st]}`) : tag("dim", "–"),
        m.statPoints[st] ? `+${m.statPoints[st]}` : tag("dim", "–"), fromTalents(st) ? `+${fromTalents(st)}` : tag("dim", "–"), tag("num", `${stats[st]}`)];
      cells.forEach((c, i) => add(new RichText(this, DETAIL_X + cols[i]!, y, 140, 13)).setMarkup(c));
      y += 20;
    }
    const role = m.role ? PROGRESSION.roles[m.role]! : null;
    const r = CONTENT.rules;
    y += 4 + add(new RichText(this, DETAIL_X, y + 4, DETAIL_W, 12)).setMarkup([
      `Max HP ${tag("num", maxHp)} = ${r.hpBase} + ${r.hpPerPoint} × HP + Lv growth (${r.hpPerLevel} + ${r.hpPerLevelPerDefense} × species Def per level)`,
      role ? `${tag("special", role.name)} growth per level: ${describeGrowth(role)}` : tag("dim", `No role yet: role growth starts when a role is chosen (Lv ${PROGRESSION.rules.roleLevel}+), counted from Lv 1.`),
    ].join("\n")) + 10;
    this.renderPoints(m, y, add);
  }

  /** Stat points block (only when points are waiting). Returns the y below it. */
  private renderPoints(m: PartyMember, y: number, add: <T extends Phaser.GameObjects.GameObject>(o: T) => T): number {
    // Stat points: +1 per level into any stat, +2 when a Candy is spent with it.
    if (m.unspentPoints > 0) {
      const candies = session.game.inventory.items[CANDY] ?? 0;
      y += add(new RichText(this, DETAIL_X, y, DETAIL_W, 13)).setMarkup(
        `${tag("num", `★ ${m.unspentPoints} stat point${m.unspentPoints > 1 ? "s" : ""} to spend`)}  ${tag("dim", `Candy ×${candies}: a point with a Candy gives +2`)}`) + 4;
      const labels = STAT_SHORT;
      const w = Math.floor((DETAIL_W - 6 * (STAT_NAMES.length - 1)) / STAT_NAMES.length);
      STAT_NAMES.forEach((stat, i) => {
        add(new Button(this, DETAIL_X + i * (w + 6), y, w, 24, `+1 ${labels[stat]}`, () =>
          this.act(() => session.update(allocatePoint(PROGRESSION, session.game, m.uid, stat)))));
        if (candies > 0) {
          add(new Button(this, DETAIL_X + i * (w + 6), y + 27, w, 22, `+2 ${labels[stat]} (Candy)`, () =>
            this.act(() => session.update(allocatePoint(PROGRESSION, session.game, m.uid, stat, true)), `Candy used: +2 ${labels[stat]}.`)));
        }
      });
      y += candies > 0 ? 56 : 30;
      y += add(new RichText(this, DETAIL_X, y, DETAIL_W, 11)).setMarkup(tag("dim",
        `HP: +${CONTENT.rules.hpPerPoint} max HP per point · Atk/Def: physical damage dealt/taken · SpA/SpD: special damage (${CONTENT.rules.specialTypes.join(", ")} moves) · Speed: +1 movement every ${CONTENT.rules.speedPerMove} points, acts earlier`)) + 6;
    }
    return y;
  }

  /** Moves: the basic attack, then the toggleable moves (left); the selected move's exact rules (right). */
  private renderMoves(m: PartyMember, y: number, add: <T extends Phaser.GameObjects.GameObject>(o: T) => T): void {
    const s = CONTENT.species[m.speciesId]!;
    const basic = basicMoveOf(CONTENT, s);
    y += add(new RichText(this, DETAIL_X, y, DETAIL_W, 13)).setMarkup(
      `${tag("title", "Moves")} ${tag("dim", `(${m.activeMoves.length}/${PROGRESSION.rules.maxActiveMoves} active besides the basic attack; tap to inspect, toggle on the right)`)}`) + 4;
    const listW = 440;
    const kindLabel = (id: string) => {
      const d = CONTENT.moves[id]!;
      const kind = d.kind === "bond" ? CONTENT.terms.bond : d.kind;
      const r = d.range.min === d.range.max ? `${d.range.max}` : `${d.range.min}-${d.range.max}`;
      return `${d.type} · ${kind} · range ${r}${d.power ? ` · Power ${d.power}` : ""}`;
    };
    const shown = this.selectedMove && m.knownMoves.includes(this.selectedMove) ? this.selectedMove : basic;
    const rows = [basic, ...m.knownMoves.filter((mv) => mv !== basic)];
    rows.forEach((mv, i) => {
      const def = CONTENT.moves[mv]!;
      const mark = mv === basic ? "◆" : m.activeMoves.includes(mv) ? "■" : "□";
      add(new Button(this, DETAIL_X, y + i * 28, listW, 24, `${mark} ${def.name.padEnd(13)} ${kindLabel(mv)}`, () => {
        this.selectedMove = mv;
        this.render();
      }).setHighlighted(mv === shown));
    });
    const infoX = DETAIL_X + listW + 16;
    const infoW = DETAIL_X + DETAIL_W - infoX;
    const h = add(new RichText(this, infoX, y, infoW, 12)).setMarkup(describeMove(CONTENT, CONTENT.moves[shown]!));
    if (shown === basic) {
      add(new RichText(this, infoX, y + h + 8, infoW, 12)).setMarkup(tag("dim", "Basic attack: always available, once per turn."));
    } else {
      const active = m.activeMoves.includes(shown);
      add(new Button(this, infoX, y + h + 8, infoW, 26, active ? "Remove from active moves" : "Make active", () => {
        const next = active ? m.activeMoves.filter((x) => x !== shown) : [...m.activeMoves, shown];
        this.act(() => this.updateMember(m, (x) => setActiveMoves(CONTENT, PROGRESSION, x, next)));
      }).setHighlighted(!active));
    }
    y += rows.length * 28 + 6;

    const bx = { x: DETAIL_X };
    const chip = (label: string, onClick: () => void) => {
      const w = Math.min(DETAIL_W, label.length * 8 + 20);
      if (bx.x + w > DETAIL_X + DETAIL_W) {
        bx.x = DETAIL_X;
        y += 28;
      }
      add(new Button(this, bx.x, y, w, 24, label, onClick));
      bx.x += w + 6;
    };
    const inParty = session.game.roster.party.some((x) => x.uid === m.uid);
    chip(inParty ? "Send to storage" : "Move to party", () => this.act(() => session.update({ ...session.game, roster: moveBetweenPartyAndStorage(session.game.roster, m.uid) })));
  }

  /**
   * The mastery grid on one page (as in Wartales): the role row, then one row per level whose
   * masteries exclude each other (left), and the exact rules of the selected cell with its action (right).
   */
  private renderTalents(m: PartyMember, y: number, add: <T extends Phaser.GameObjects.GameObject>(o: T) => T): void {
    const s = CONTENT.species[m.speciesId]!;
    const pending = pendingChoice(CONTENT, PROGRESSION, m);
    const roles = roleOptions(CONTENT, m);
    const role = m.role ?? (this.previewRole && roles.includes(this.previewRole) ? this.previewRole : roles[0] ?? null);
    const grid = masteryGrid(CONTENT, PROGRESSION, m.speciesId, role);
    const open = new Set(talentOptions(CONTENT, PROGRESSION, m));
    const waiting = grid.filter((r) => r.level <= m.level && !rowPick(r, m)).length;

    const status = m.level < PROGRESSION.rules.roleLevel
      ? `The role is chosen at Lv ${PROGRESSION.rules.roleLevel}; until then you can look around.`
      : pending === "role"
        ? "★ Choose a role first: it decides the role rows below."
        : pending === "talent"
          ? `★ ${waiting} row${waiting > 1 ? "s" : ""} waiting: pick one mastery in each.`
          : "All reached rows are picked.";
    y += add(new RichText(this, DETAIL_X, y, DETAIL_W, 12)).setMarkup(
      `${tag(pending ? "num" : "dim", status)}  ${tag("dim", "One pick per row; masteries in a row exclude each other.")}`) + 6;

    const labelW = 50;
    const infoW = 270;
    const gridW = DETAIL_W - labelW - infoW - 16;
    const rowH = 30;
    const cell = (x: number, cy: number, w: number, label: string, key: string, state: "picked" | "open" | "excluded" | "locked") => {
      const mark = state === "picked" ? "✓ " : state === "open" ? "★ " : "";
      const b = new Button(this, x, cy, w, 24, `${mark}${label}`, () => {
        this.selectedTalent = key;
        if (key.startsWith("role:") && m.role === null) this.previewRole = key.slice(5);
        this.render();
      }).setHighlighted(this.selectedTalent === key || state === "picked");
      if (state === "excluded") b.setAlpha(0.35);
      if (state === "locked") b.setAlpha(0.6);
      add(b);
    };
    const rowLabel = (cy: number, lv: number) =>
      add(new RichText(this, DETAIL_X, cy + 5, labelW, 12)).setMarkup(tag(m.level >= lv ? "num" : "dim", `Lv ${lv}`));
    const lines = add(this.add.graphics());

    // The role row.
    let cy = y;
    rowLabel(cy, PROGRESSION.rules.roleLevel);
    const roleW = Math.min(180, Math.floor((gridW - 6 * (roles.length - 1)) / Math.max(1, roles.length)));
    roles.forEach((r, i) => {
      const state = m.role === r ? "picked" : m.role ? "excluded" : pending === "role" ? "open" : "locked";
      cell(DETAIL_X + labelW + i * (roleW + 6), cy, roleW, PROGRESSION.roles[r]!.name, `role:${r}`, state);
    });
    cy += rowH;

    // Mastery rows.
    for (const row of grid) {
      lines.lineStyle(1, 0x2a3245, 1).lineBetween(DETAIL_X, cy - 3, DETAIL_X + labelW + gridW, cy - 3);
      rowLabel(cy, row.level);
      const pick = m.role === role ? rowPick(row, m) : null;
      const w = Math.min(180, Math.floor((gridW - 6 * (row.options.length - 1)) / row.options.length));
      row.options.forEach((id, i) => {
        const state = pick === id ? "picked" : pick ? "excluded" : open.has(id) ? "open" : "locked";
        cell(DETAIL_X + labelW + i * (w + 6), cy, w, talentFor(CONTENT, PROGRESSION, id, s.types).name, id, state);
      });
      cy += rowH;
    }

    // Detail panel.
    const infoX = DETAIL_X + DETAIL_W - infoW;
    const key = this.selectedTalent;
    let iy = y;
    if (key?.startsWith("role:")) {
      const r = key.slice(5);
      const def = PROGRESSION.roles[r]!;
      iy += add(new RichText(this, infoX, iy, infoW, 12)).setMarkup([
        tag("title", def.name), tag("dim", `Role · Lv ${PROGRESSION.rules.roleLevel}`), def.description,
        `Grows every level: ${tag("good", describeGrowth(def))}`,
      ].join("\n")) + 8;
      if (pending === "role")
        add(new Button(this, infoX, iy, infoW, 28, `Become ${def.name}`, () =>
          this.act(() => this.updateMember(m, (x2) => chooseRole(CONTENT, PROGRESSION, x2, r)), `${s.name} is now a ${def.name}.`)).setHighlighted(true));
    } else if (key && PROGRESSION.talents[key]) {
      const t = talentFor(CONTENT, PROGRESSION, key, s.types);
      const row = grid.find((r) => r.options.includes(key));
      const kind = t.grantsMove ? "Skill" : t.requiresType ? `${t.requiresType} type mastery` : t.stats && !t.mods ? "Stat mastery" : "Mastery";
      iy += add(new RichText(this, infoX, iy, infoW, 12)).setMarkup(
        [tag("title", t.name), tag("dim", `${kind} · Lv ${row?.level ?? "?"}`), ...describeTalent(CONTENT, PROGRESSION, t)].join("\n")) + 8;
      if (open.has(key)) {
        add(new Button(this, infoX, iy, infoW, 28, `Learn ${t.name}`, () => {
          this.act(() => this.updateMember(m, (x2) => chooseTalent(CONTENT, PROGRESSION, x2, key)), `${s.name} learned ${t.name}.`);
          this.selectedTalent = null;
        }).setHighlighted(true));
      } else if (m.talents.includes(key)) add(new RichText(this, infoX, iy, infoW, 12)).setMarkup(tag("good", "Learned."));
    } else {
      add(new RichText(this, infoX, iy, infoW, 12)).setMarkup(
        [tag("dim", "Tap a cell to see its exact effect."), "", tag("dim", "✓ picked · ★ can pick now"), tag("dim", "Faded: excluded by the pick in its row.")].join("\n"));
    }

    // Reset (respec) for Pokédollars.
    if (m.role !== null) {
      const cost = respecCost(PROGRESSION, m);
      add(new Button(this, infoX, 470, infoW, 26, `Reset role & masteries (₽${cost})`, () =>
        this.act(() => session.update(respecMember(CONTENT, PROGRESSION, session.game, m.uid)), `${s.name} forgot its role and masteries.`))
        .setEnabled(session.game.money >= cost));
    }
  }

  /** Healing items, then the held item: what it holds now and every held item in the bag with its exact effect. */
  private renderEquipment(m: PartyMember, y: number, add: <T extends Phaser.GameObjects.GameObject>(o: T) => T): void {
    const s = CONTENT.species[m.speciesId]!;
    const potions = Object.entries(session.game.inventory.items).filter(([id, n]) => n > 0 && PROGRESSION.items[id]?.kind === "potion");
    const max = memberMaxHp(CONTENT, PROGRESSION, m);
    y += add(new RichText(this, DETAIL_X, y, DETAIL_W, 13)).setMarkup(`${tag("title", "Healing")}  HP ${m.hp}/${max}`) + 4;
    if (!potions.length) y += add(new RichText(this, DETAIL_X, y, DETAIL_W, 12)).setMarkup(tag("dim", "No potions. Resting at camp restores all HP.")) + 8;
    potions.forEach(([id, n], i) => {
      const item = PROGRESSION.items[id]!;
      add(new Button(this, DETAIL_X + i * 236, y, 230, 26, `Use ${item.name} (+${item.heal} HP) ×${n}`, () =>
        this.act(() => session.update(usePotion(CONTENT, PROGRESSION, session.game, m.uid, id)), `${s.name} recovered HP.`)).setEnabled(m.hp > 0 && m.hp < max));
    });
    if (potions.length) y += 36;
    // Knockout marks: only remedies (or Pokémon Center treatment) remove them.
    const remedies = Object.entries(session.game.inventory.items).filter(([id, n]) => n > 0 && PROGRESSION.items[id]?.kind === "remedy");
    if (m.knockouts > 0) {
      y += add(new RichText(this, DETAIL_X, y, DETAIL_W, 12)).setMarkup(`${tag("ko", `Knockout marks ${m.knockouts}/3`)} ${tag("dim", remedies.length ? "" : "· a Revival Herb or Pokémon Center treatment removes them")}`) + 4;
      remedies.forEach(([id, n], i) => {
        const item = PROGRESSION.items[id]!;
        add(new Button(this, DETAIL_X + i * 236, y, 230, 26, `Use ${item.name} (−${item.clearsKnockouts} mark) ×${n}`, () =>
          this.act(() => session.update(useRemedy(PROGRESSION, session.game, m.uid, id)), `A knockout mark faded from ${s.name}.`)));
      });
      if (remedies.length) y += 36;
    }

    const held = m.heldItem ? PROGRESSION.items[m.heldItem] : null;
    y += add(new RichText(this, DETAIL_X, y, DETAIL_W, 13)).setMarkup(
      `${tag("title", "Holding")}: ${held ? `${tag("num", held.name)} · ${describeItem(CONTENT, held).join(" · ")}` : tag("dim", "nothing (one held item per Pokémon)")}`) + 6;
    if (held) {
      add(new Button(this, DETAIL_X, y, 160, 24, "Take off", () => this.act(() => session.update(equipItem(PROGRESSION, session.game, m.uid, null)), `${held.name} returned to the bag.`)));
      y += 32;
    }
    const bagItems = Object.entries(session.game.inventory.items).filter(([id, n]) => n > 0 && PROGRESSION.items[id]?.kind === "held");
    y += add(new RichText(this, DETAIL_X, y, DETAIL_W, 13)).setMarkup(tag("title", "In the bag")) + 4;
    if (!bagItems.length) {
      add(new RichText(this, DETAIL_X, y, DETAIL_W, 12)).setMarkup(tag("dim", "No held items. The Poké Mart in towns sells them."));
      return;
    }
    for (const [id, n] of bagItems) {
      const item = PROGRESSION.items[id]!;
      add(this.add.rectangle(DETAIL_X, y, DETAIL_W, 40, 0x1c2130).setOrigin(0).setStrokeStyle(1, 0x3a4560));
      add(new RichText(this, DETAIL_X + 8, y + 4, DETAIL_W - 120, 12)).setMarkup(`${tag("num", item.name)} ×${n}\n${describeItem(CONTENT, item).join(" · ")}`);
      add(new Button(this, DETAIL_X + DETAIL_W - 100, y + 8, 92, 24, held ? "Swap" : "Equip", () =>
        this.act(() => session.update(equipItem(PROGRESSION, session.game, m.uid, id)), `${s.name} now holds ${item.name}.`)));
      y += 46;
    }
  }
}

export type Tab = "stats" | "talents" | "moves" | "equipment";
