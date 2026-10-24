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
  usePotion,
  useRemedy,
  withMember,
  type PartyMember,
} from "../../core/party";
import {
  basicMoveOf,
  chooseRole,
  chooseTalent,
  memberStats,
  nodeState,
  nodeTalent,
  pendingChoice,
  talentPointsAt,
  type TreeNode,
  roleOptions,
  setActiveMoves,
  talentOptions,
  xpToNext,
} from "../../core/progression";
import { STAT_NAMES, type StatName } from "../../core/battle";
import { session } from "../session";
import { portraitKey } from "../sprites";
import { Button } from "../ui/Button";
import { describeItem, describeTalent } from "../ui/describeEffects";
import { tag } from "../ui/markup";
import { RichText } from "../ui/RichText";
import { COLORS, FONT, TYPE_COLORS, px } from "../ui/theme";

const LIST_X = 16;
const DETAIL_X = 16;
const DETAIL_W = 928;

/** One Pokémon: level-ups (stat points and talent tree), moves, equipment. */
export class PokemonScene extends Phaser.Scene {
  private root!: Phaser.GameObjects.Container;
  private selected: string | null = null;
  private message = "";
  private tab: Tab = "levelup";
  private selectedTalent: string | null = null;
  private selectedNodeLevel = 0;
  private previewRole: string | null = null;

  constructor() {
    super("Pokemon");
  }

  init(data: { uid: string; tab?: Tab }): void {
    this.message = "";
    this.selected = data.uid;
    this.tab = data.tab ?? "levelup";
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
    const pending = pendingChoice(PROGRESSION, m) ?? (m.unspentPoints > 0 ? "points" : null);
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
      `HP ${tag(m.hp > 0 ? "heal" : "ko", `${m.hp}/${maxHp}`)}  Atk ${stats.attack}  Def ${stats.defense}  Spe ${stats.speed}  KO ${tag(m.knockouts ? "ko" : "dim", `${m.knockouts}/${KNOCKOUTS_TO_DEATH}`)}`,
      ...(s.ability && CONTENT.abilities[s.ability] ? [`Ability: ${tag("special", CONTENT.abilities[s.ability]!.name)} ${tag("dim", CONTENT.abilities[s.ability]!.description)}`] : []),
      `Role: ${role ? tag("special", role.name) : tag("dim", m.level < PROGRESSION.rules.roleLevel ? `chosen at Lv ${PROGRESSION.rules.roleLevel}` : "not chosen")}  Held: ${held ? tag("num", held.name) : tag("dim", "nothing")}`,
    ];
    let y = 48;
    if (this.textures.exists(portraitKey(m.speciesId))) add(this.add.image(DETAIL_X + DETAIL_W - 32, 12 + 32, portraitKey(m.speciesId)).setDisplaySize(64, 64));
    y += add(new RichText(this, DETAIL_X, y, DETAIL_W - 76, 13)).setMarkup(header.join("\n")) + 8;

    // Tabs. A ★ marks where a decision is waiting.
    const pending = pendingChoice(PROGRESSION, m);
    const tabs: [Tab, string][] = [
      ["levelup", `${pending || m.unspentPoints > 0 ? "★ " : ""}Level up`],
      ["moves", "Moves"],
      ["equipment", "Equipment"],
    ];
    const tw = Math.floor((DETAIL_W - 12) / 3);
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
    else this.renderTalents(m, this.renderPoints(m, y, add), add);
  }

  /** Stat points block (only when points are waiting). Returns the y below it. */
  private renderPoints(m: PartyMember, y: number, add: <T extends Phaser.GameObjects.GameObject>(o: T) => T): number {
    // Stat points: +1 per level into any stat, +2 when a Candy is spent with it.
    if (m.unspentPoints > 0) {
      const candies = session.game.inventory.items[CANDY] ?? 0;
      y += add(new RichText(this, DETAIL_X, y, DETAIL_W, 13)).setMarkup(
        `${tag("num", `★ ${m.unspentPoints} stat point${m.unspentPoints > 1 ? "s" : ""} to spend`)}  ${tag("dim", `Candy ×${candies}: a point with a Candy gives +2`)}`) + 4;
      const labels: Record<StatName, string> = { hp: "HP", attack: "Atk", defense: "Def", speed: "Spe" };
      const w = Math.floor((DETAIL_W - 18) / 4);
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
        `HP: +${CONTENT.rules.hpPerPoint} max HP per point · Attack/Defense: about +7% / −7% damage per point · Speed: +1 movement every ${CONTENT.rules.speedPerMove} points, acts earlier`)) + 6;
    }
    return y;
  }

  private renderMoves(m: PartyMember, y: number, add: <T extends Phaser.GameObjects.GameObject>(o: T) => T): void {
    const s = CONTENT.species[m.speciesId]!;
    // Moves: the basic attack is fixed; toggle up to 3 others.
    const basic = basicMoveOf(CONTENT, s);
    y += add(new RichText(this, DETAIL_X, y, DETAIL_W, 13)).setMarkup(
      `${tag("title", "Moves")} ${tag("dim", `(${m.activeMoves.length}/${PROGRESSION.rules.maxActiveMoves} active + ${CONTENT.moves[basic]!.name}; tap to toggle)`)}`) + 4;
    const known = m.knownMoves.filter((mv) => mv !== basic);
    const colW = Math.floor((DETAIL_W - 8) / 2);
    known.forEach((mv, i) => {
      const def = CONTENT.moves[mv]!;
      const active = m.activeMoves.includes(mv);
      const label = `${active ? "■" : "□"} ${def.name} · ${def.kind}${def.power ? ` · Power ${def.power}` : ""}`;
      add(new Button(this, DETAIL_X + (i % 2) * (colW + 8), y + Math.floor(i / 2) * 28, colW, 24, label, () => {
        const next = active ? m.activeMoves.filter((x) => x !== mv) : [...m.activeMoves, mv];
        this.act(() => this.updateMember(m, (x) => setActiveMoves(CONTENT, PROGRESSION, x, next)));
      }).setHighlighted(active));
    });
    y += Math.ceil(known.length / 2) * 28 + 6;

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
   * Talent tree: role buttons on top (preview / choose), then the tree by level rows with
   * lines to prerequisites (left), and the exact rules of the selected talent (right).
   */
  private renderTalents(m: PartyMember, y: number, add: <T extends Phaser.GameObjects.GameObject>(o: T) => T): void {
    const s = CONTENT.species[m.speciesId]!;
    const pending = pendingChoice(PROGRESSION, m);
    const canChooseRole = !m.role && m.level >= PROGRESSION.rules.roleLevel;
    const roles = m.role ? [m.role] : roleOptions(CONTENT, m);
    const shown = m.role ?? (this.previewRole && roles.includes(this.previewRole) ? this.previewRole : roles[0]!);

    // Top row: which tree is shown, and the role choice.
    let x = DETAIL_X;
    if (!m.role) {
      for (const r of roles) {
        add(new Button(this, x, y, 140, 26, `Preview ${PROGRESSION.roles[r]!.name}`, () => {
          this.previewRole = r;
          this.selectedTalent = null;
          this.render();
        }).setHighlighted(r === shown));
        x += 146;
      }
      if (canChooseRole) {
        const def = PROGRESSION.roles[shown]!;
        add(new Button(this, x + 8, y, 200, 26, `★ Become ${def.name}`, () =>
          this.act(() => this.updateMember(m, (x2) => chooseRole(CONTENT, PROGRESSION, x2, shown)), `${s.name} is now a ${def.name}.`)).setHighlighted(true));
      }
      const note = canChooseRole ? "Role choice is permanent." : `Roles unlock at Lv ${PROGRESSION.rules.roleLevel}.`;
      add(new RichText(this, x + (canChooseRole ? 216 : 8), y + 6, 300, 11)).setMarkup(tag("dim", note));
    } else {
      const free = talentPointsAt(PROGRESSION, m.level) - m.talents.length;
      const next = PROGRESSION.rules.talentLevels.find((l) => l > m.level);
      add(new RichText(this, x, y + 5, 520, 12)).setMarkup(
        `${tag("special", PROGRESSION.roles[shown]!.name)} tree · ${free > 0 ? tag("num", `★ ${free} talent point${free > 1 ? "s" : ""}`) : tag("dim", next ? `next talent point at Lv ${next}` : "all talent points used")}`);
    }
    y += 34;

    // The tree: one row per level, label once per row, up to 3 columns, lines to prerequisites.
    const tree = PROGRESSION.roles[shown]!.tree;
    const rows = [...new Set(tree.map((n) => n.level))].sort((a, b) => a - b);
    const labelW = 46;
    const colW = 158;
    const rowH = 32;
    const pos = (n: TreeNode) => ({ x: DETAIL_X + labelW + n.col * (colW + 8), y: y + rows.indexOf(n.level) * rowH });
    const types = s.types;
    const lines = add(this.add.graphics());
    for (const n of tree) {
      for (const r of n.requires ?? []) {
        const parent = tree.find((p2) => nodeTalent(PROGRESSION, p2, types) === r);
        if (!parent) continue;
        const a = pos(parent);
        const b = pos(n);
        const learned = m.talents.includes(r);
        // Elbow connector: down from the parent, across, down into the child.
        const ax = a.x + colW / 2;
        const bx = b.x + colW / 2;
        const midY = b.y - 4;
        lines.lineStyle(2, learned ? 0x7ed321 : 0x4a5675, 1);
        lines.lineBetween(ax, a.y + 24, ax, midY);
        lines.lineBetween(ax, midY, bx, midY);
        lines.lineBetween(bx, midY, bx, b.y);
      }
    }
    rows.forEach((lv, i) => add(new RichText(this, DETAIL_X, y + i * rowH + 5, labelW, 12)).setMarkup(m.level >= lv ? tag("num", `Lv ${lv}`) : tag("dim", `Lv ${lv}`)));
    const canLearn = new Set(m.role === shown ? talentOptions(PROGRESSION, m, types) : []);
    for (const n of tree) {
      const id = nodeTalent(PROGRESSION, n, types);
      if (!id) continue;
      const t = PROGRESSION.talents[id]!;
      const state = m.role === shown ? nodeState(PROGRESSION, m, n, types) : "locked-path";
      const mark = state === "learned" ? "✓ " : canLearn.has(id) ? "★ " : "";
      const p2 = pos(n);
      const b = new Button(this, p2.x, p2.y, colW, 24, `${mark}${t.name}`, () => {
        this.selectedTalent = id;
        this.selectedNodeLevel = n.level;
        this.render();
      }).setHighlighted(this.selectedTalent === id);
      if (state === "locked-level" || state === "locked-path") b.setAlpha(0.6);
      add(b);
    }

    // Detail panel.
    const infoX = DETAIL_X + labelW + 3 * (colW + 8) + 16;
    const infoW = DETAIL_X + DETAIL_W - infoX;
    const id = this.selectedTalent;
    if (!id || !PROGRESSION.talents[id]) {
      add(new RichText(this, infoX, y, infoW, 12)).setMarkup(
        `${tag("dim", "Tap a talent to see its exact effect.")}\n\n${tag("dim", "✓ learned · ★ can learn now")}\n${tag("dim", "A talent needs its level and one")}\n${tag("dim", "learned talent it is connected to.")}`);
      return;
    }
    const t = PROGRESSION.talents[id]!;
    const node = tree.find((n) => nodeTalent(PROGRESSION, n, types) === id);
    const kind = t.grantsMove ? "Skill talent" : t.requiresType ? `${t.requiresType} type talent` : t.stats && !t.mods ? "Stat talent" : "Talent";
    const reqs = (node?.requires ?? []).map((r) => PROGRESSION.talents[r]?.name ?? r);
    const textLines = [
      tag("title", t.name),
      tag("dim", `${kind} · Lv ${node?.level ?? this.selectedNodeLevel}${reqs.length ? ` · after ${reqs.join(" or ")}` : ""}`),
      ...describeTalent(CONTENT, PROGRESSION, t),
    ];
    const h = add(new RichText(this, infoX, y, infoW, 12)).setMarkup(textLines.join("\n"));
    if (canLearn.has(id)) {
      add(new Button(this, infoX, Math.min(y + h + 8, 476), infoW, 28, `Learn ${t.name}`, () => {
        this.act(() => this.updateMember(m, (x2) => chooseTalent(PROGRESSION, x2, id, types)), `${s.name} learned ${t.name}.`);
        this.selectedTalent = null;
      }).setHighlighted(true));
    } else if (m.talents.includes(id)) {
      add(new RichText(this, infoX, y + h + 8, infoW, 12)).setMarkup(tag("good", "Learned."));
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

export type Tab = "levelup" | "moves" | "equipment";
