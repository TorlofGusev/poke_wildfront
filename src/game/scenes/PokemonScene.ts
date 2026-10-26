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
  chooseEvolution,
  evolutionChoices,
  memberGrid,
  pathName,
  pathOf,
  pathOptions,
  pathStartSkill,
  resolvePath,
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
import { t } from "../i18n";
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

    add(new Button(this, LIST_X, 12, 120, 26, t("← Camp"), () => this.scene.start("Party", { rested: false, choosingMeal: false })));
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
    text(LIST_X + 180, 17, list === roster.storage ? t("{i}/{n} in storage", { i: idx + 1, n: list.length }) : `${idx + 1}/${list.length}`, COLORS.dim, 13);
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
    const hp = this.add.text(36, 19, m.hp > 0 ? `HP ${m.hp}/${max}` : t("fainted"), { fontFamily: FONT, fontSize: px(11), color: m.hp > 0 ? COLORS.dim : COLORS.bad });
    const pips = "●".repeat(m.knockouts) + "○".repeat(KNOCKOUTS_TO_DEATH - m.knockouts);
    const ko = this.add.text(296, 18, `${pending ? "★ " : ""}KO ${pips}`, { fontFamily: FONT, fontSize: px(12), color: pending ? "#f5d76e" : m.knockouts === 2 ? COLORS.bad : COLORS.dim }).setOrigin(1, 0.5);
    return this.add.container(x, y, [bg, dot, name, hp, ko]);
  }

  private renderDetail(m: PartyMember, add: <T extends Phaser.GameObjects.GameObject>(o: T) => T): void {
    const s = CONTENT.species[m.speciesId]!;
    const { stats, maxHp } = memberStats(CONTENT, PROGRESSION, m);
    const role = m.role ? PROGRESSION.roles[m.role] : null;
    const held = m.heldItem ? PROGRESSION.items[m.heldItem] : null;
    const evo = s.evolution ? t(" · evolves at Lv {lv}", { lv: s.evolution.level }) : "";
    const header = [
      `${tag("title", s.name)}  ${s.types.map((t) => tag(t, t)).join("/")}  Lv ${tag("num", m.level)}  XP ${m.xp}/${xpToNext(PROGRESSION, m.level)}${tag("dim", evo)}`,
      `HP ${tag(m.hp > 0 ? "heal" : "ko", `${m.hp}/${maxHp}`)}  ${statLine(stats)}  KO ${tag(m.knockouts ? "ko" : "dim", `${m.knockouts}/${KNOCKOUTS_TO_DEATH}`)}`,
      ...(s.ability && CONTENT.abilities[s.ability] ? [`${t("Ability:")} ${tag("special", CONTENT.abilities[s.ability]!.name)} ${tag("dim", CONTENT.abilities[s.ability]!.description)}`] : []),
      `${t("Role:")} ${role ? `${tag("special", role.name)}` : tag("dim", m.level < PROGRESSION.rules.roleLevel ? t("chosen at Lv {lv}", { lv: PROGRESSION.rules.roleLevel }) : t("not chosen"))}  ${t("Held:")} ${held ? tag("num", held.name) : tag("dim", t("nothing"))}`,
    ];
    let y = 48;
    if (this.textures.exists(portraitKey(m.speciesId))) add(this.add.image(DETAIL_X + DETAIL_W - 32, 12 + 32, portraitKey(m.speciesId)).setDisplaySize(64, 64));
    y += add(new RichText(this, DETAIL_X, y, DETAIL_W - 76, 13)).setMarkup(header.join("\n")) + 8;

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

  /** Where every stat comes from (species, role growth, points, talents), then the stat points to spend. */
  private renderStats(m: PartyMember, y: number, add: <T extends Phaser.GameObjects.GameObject>(o: T) => T): void {
    const s = CONTENT.species[m.speciesId]!;
    const { stats, maxHp } = memberStats(CONTENT, PROGRESSION, m);
    const growth = roleGrowth(PROGRESSION, m.role, m.level);
    const fromTalents = (st: StatName) => m.talents.reduce((sum, t) => sum + (PROGRESSION.talents[t]?.stats?.[st] ?? 0), 0);
    const cols = [0, 150, 260, 380, 490, 600];
    const head = [t("Stat"), t("Species"), t("Role growth"), t("Points"), t("Masteries"), t("Total")];
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
      t("Max HP {max} = {base} + {perPoint} × HP + Lv growth ({perLevel} + {perDef} × species Def per level)", { max: tag("num", maxHp), base: r.hpBase, perPoint: r.hpPerPoint, perLevel: r.hpPerLevel, perDef: r.hpPerLevelPerDefense }),
      role ? t("{role} growth per level: {growth}", { role: tag("special", role.name), growth: describeGrowth(role) }) : tag("dim", t("No role yet: role growth starts when a role is chosen (Lv {lv}+), counted from Lv 1.", { lv: PROGRESSION.rules.roleLevel })),
    ].join("\n")) + 10;
    this.renderPoints(m, y, add);
  }

  /** Stat points block (only when points are waiting). Returns the y below it. */
  private renderPoints(m: PartyMember, y: number, add: <T extends Phaser.GameObjects.GameObject>(o: T) => T): number {
    // Stat points: +1 per level into any stat, +2 when a Candy is spent with it.
    if (m.unspentPoints > 0) {
      const candies = session.game.inventory.items[CANDY] ?? 0;
      y += add(new RichText(this, DETAIL_X, y, DETAIL_W, 13)).setMarkup(
        `${tag("num", m.unspentPoints > 1 ? t("★ {n} stat points to spend", { n: m.unspentPoints }) : t("★ {n} stat point to spend", { n: m.unspentPoints }))}  ${tag("dim", t("Candy ×{n}: a point with a Candy gives +2", { n: candies }))}`) + 4;
      const labels = STAT_SHORT;
      const w = Math.floor((DETAIL_W - 6 * (STAT_NAMES.length - 1)) / STAT_NAMES.length);
      STAT_NAMES.forEach((stat, i) => {
        add(new Button(this, DETAIL_X + i * (w + 6), y, w, 24, `+1 ${labels[stat]}`, () =>
          this.act(() => session.update(allocatePoint(PROGRESSION, session.game, m.uid, stat)))));
        if (candies > 0) {
          add(new Button(this, DETAIL_X + i * (w + 6), y + 27, w, 22, t("+2 {stat} (Candy)", { stat: labels[stat] }), () =>
            this.act(() => session.update(allocatePoint(PROGRESSION, session.game, m.uid, stat, true)), t("Candy used: +2 {stat}.", { stat: labels[stat] }))));
        }
      });
      y += candies > 0 ? 56 : 30;
      y += add(new RichText(this, DETAIL_X, y, DETAIL_W, 11)).setMarkup(tag("dim",
        t("HP: +{hp} max HP per point · Atk/Def: physical damage dealt/taken · SpA/SpD: special damage ({types} moves) · Speed: +1 movement every {speed} points, acts earlier", { hp: CONTENT.rules.hpPerPoint, types: CONTENT.rules.specialTypes.join(", "), speed: CONTENT.rules.speedPerMove }))) + 6;
    }
    return y;
  }

  /** Moves: the basic attack, then the toggleable moves (left); the selected move's exact rules (right). */
  private renderMoves(m: PartyMember, y: number, add: <T extends Phaser.GameObjects.GameObject>(o: T) => T): void {
    const s = CONTENT.species[m.speciesId]!;
    const basic = basicMoveOf(CONTENT, s);
    y += add(new RichText(this, DETAIL_X, y, DETAIL_W, 13)).setMarkup(
      `${tag("title", t("Moves"))} ${tag("dim", t("({n}/{max} active besides the basic attack; tap to inspect, toggle on the right)", { n: m.activeMoves.length, max: PROGRESSION.rules.maxActiveMoves }))}`) + 4;
    const listW = 440;
    const kindLabel = (id: string) => {
      const d = CONTENT.moves[id]!;
      const kind = d.kind === "bond" ? CONTENT.terms.bond : d.kind;
      const r = d.range.min === d.range.max ? `${d.range.max}` : `${d.range.min}-${d.range.max}`;
      return `${d.type} · ${kind} · ${t("range {r}", { r })}${d.power ? ` · ${t("Power {n}", { n: d.power })}` : ""}`;
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
      add(new RichText(this, infoX, y + h + 8, infoW, 12)).setMarkup(tag("dim", t("Basic attack: always available, once per turn.")));
    } else {
      const active = m.activeMoves.includes(shown);
      add(new Button(this, infoX, y + h + 8, infoW, 26, active ? t("Remove from active moves") : t("Make active"), () => {
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
    chip(inParty ? t("Send to storage") : t("Move to party"), () => this.act(() => session.update({ ...session.game, roster: moveBetweenPartyAndStorage(session.game.roster, m.uid) })));
  }

  /**
   * The mastery grid on one page (as in Wartales): the role row, then one row per level whose
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
    // The path chosen at the role level: a type for dual types, else a role. Before choosing, preview one.
    const roles = pathOptions(CONTENT, PROGRESSION, m);
    const chosen = pathOf(CONTENT, m);
    const role = chosen ?? (this.previewRole && roles.includes(this.previewRole) ? this.previewRole : roles[0] ?? null);
    // The member's own grid once it has a path (it may include an evolution's gift row), else a preview.
    const grid = chosen ? memberGrid(CONTENT, PROGRESSION, m) : masteryGrid(CONTENT, PROGRESSION, m.speciesId, role);
    const pathLabel = (p: string) => pathName(PROGRESSION, p);
    // Skills take the names of the path's type (a Poison Tank's guard move is the Poison version).
    const pathTypes = role ? [resolvePath(CONTENT, m.speciesId, role).type] : s.types;
    const open = new Set(talentOptions(CONTENT, PROGRESSION, m));
    const waiting = grid.filter((r) => r.level <= m.level && !rowPick(r, m)).length;

    const status = m.level < PROGRESSION.rules.roleLevel
      ? t("The path is chosen at Lv {lv}; until then you can look around.", { lv: PROGRESSION.rules.roleLevel })
      : pending === "role"
        ? t("★ Choose a path first: it decides the rows below.")
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
        if (key.startsWith("role:") && m.role === null) this.previewRole = key.slice(5);
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

    // The role row.
    let cy = y;
    rowLabel(cy, PROGRESSION.rules.roleLevel);
    const roleW = Math.min(180, Math.floor((gridW - 6 * (roles.length - 1)) / Math.max(1, roles.length)));
    // Rows are centred in the grid area, so 2-option rows sit under the middle of the 4 roles.
    const rowX = (n: number, w: number) => DETAIL_X + labelW + (gridW - (n * w + 6 * (n - 1))) / 2;
    roles.forEach((r, i) => {
      const state = chosen === r ? "picked" : chosen ? "excluded" : pending === "role" ? "open" : "locked";
      cell(rowX(roles.length, roleW) + i * (roleW + 6), cy, roleW, pathLabel(r), `role:${r}`, state, TYPE_COLORS[resolvePath(CONTENT, m.speciesId, r).type]);
    });
    cy += rowH;

    // Mastery rows.
    for (const row of grid) {
      lines.lineStyle(1, 0x2a3245, 1).lineBetween(DETAIL_X, cy - 3, DETAIL_X + labelW + gridW, cy - 3);
      rowLabel(cy, row.level);
      const pick = chosen === role ? rowPick(row, m) : null;
      const w = Math.min(180, Math.floor((gridW - 6 * (row.options.length - 1)) / row.options.length));
      row.options.forEach((id, i) => {
        const state = pick === id ? "picked" : pick ? "excluded" : open.has(id) ? "open" : "locked";
        const tal = talentFor(CONTENT, PROGRESSION, id, pathTypes);
        const moveType = tal.grantsMove ? CONTENT.moves[tal.grantsMove]?.type : undefined;
        cell(rowX(row.options.length, w) + i * (w + 6), cy, w, tal.name, id, state, moveType ? TYPE_COLORS[moveType] : undefined);
      });
      cy += rowH;
    }

    // Detail panel.
    const infoX = DETAIL_X + DETAIL_W - infoW;
    const key = this.selectedTalent;
    let iy = y;
    if (key?.startsWith("role:")) {
      const r = key.slice(5);
      const { role: roleId, type } = resolvePath(CONTENT, m.speciesId, r);
      const def = PROGRESSION.roles[roleId]!;
      iy += add(new RichText(this, infoX, iy, infoW, 12)).setMarkup([
        tag("title", pathLabel(r)),
        tag("dim", t("Path · Lv {lv}", { lv: PROGRESSION.rules.roleLevel })),
        def.description,
        ...(pathStartSkill(PROGRESSION, r, m.speciesId) ? [t("Starts with: {skill}", { skill: tag("special", talentFor(CONTENT, PROGRESSION, pathStartSkill(PROGRESSION, r, m.speciesId)!, s.types).name) })] : []),
        tag("dim", t("Its {type} masteries and skills fill the tree.", { type: type.charAt(0).toUpperCase() + type.slice(1) })),
        t("Grows every level: {growth}", { growth: tag("good", describeGrowth(def)) }),
      ].join("\n")) + 8;
      if (pending === "role")
        add(new Button(this, infoX, iy, infoW, 28, t("Choose {path}", { path: pathLabel(r) }), () =>
          this.act(() => this.updateMember(m, (x2) => chooseRole(CONTENT, PROGRESSION, x2, r)), t("{name} chose {path}.", { name: s.name, path: pathLabel(r) }))).setHighlighted(true));
    } else if (key && PROGRESSION.talents[key]) {
      const tal = talentFor(CONTENT, PROGRESSION, key, pathTypes);
      const row = grid.find((r) => r.options.includes(key));
      const kind = tal.grantsMove ? t("Skill") : tal.requiresType ? t("{type} type mastery", { type: tal.requiresType }) : tal.stats && !tal.mods ? t("Stat mastery") : t("Mastery");
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
    if (m.role !== null) {
      const cost = respecCost(PROGRESSION, m);
      add(new Button(this, infoX, 470, infoW, 26, t("Reset role & masteries (₽{cost})", { cost }), () =>
        this.act(() => session.update(respecMember(CONTENT, PROGRESSION, session.game, m.uid)), t("{name} forgot its role and masteries.", { name: s.name })))
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
