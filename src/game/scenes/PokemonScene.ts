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
  withMember,
  type PartyMember,
} from "../../core/party";
import {
  basicMoveOf,
  chooseRole,
  chooseTalent,
  memberStats,
  pendingChoice,
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
const DETAIL_X = 336;
const DETAIL_W = 608;

/** One Pokémon: level-ups (stat points and talent tree), moves, equipment. */
export class PokemonScene extends Phaser.Scene {
  private root!: Phaser.GameObjects.Container;
  private selected: string | null = null;
  private message = "";
  private tab: Tab = "levelup";
  private selectedTalent: string | null = null;

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

    add(new Button(this, LIST_X, 12, 150, 26, "← Party", () => this.scene.start("Party")));
    text(LIST_X + 170, 18, `₽${money}`, "#f5d76e", 14);

    // Quick switch between Pokémon of the same list (party, or storage when viewing a stored one).
    const list = roster.party.some((m) => m.uid === this.selected) ? roster.party : roster.storage;
    text(LIST_X, 48, list === roster.party ? `Party ${roster.party.length}/${MAX_PARTY_SIZE}` : "Storage", COLORS.dim, 12);
    list.slice(0, 10).forEach((m, i) => add(this.card(LIST_X, 66 + i * 40, m)));

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
    if (this.textures.exists(portraitKey(m.speciesId))) add(this.add.image(DETAIL_X + DETAIL_W - 32, 72, portraitKey(m.speciesId)).setDisplaySize(64, 64));
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
    for (const [id, n] of Object.entries(session.game.inventory.items)) {
      const item = PROGRESSION.items[id];
      if (item?.kind === "potion" && n > 0)
        chip(`Use ${item.name} (+${item.heal} HP, ${n} left)`, () => this.act(() => session.update(usePotion(CONTENT, PROGRESSION, session.game, m.uid, id)), `${s.name} recovered HP.`));
    }
    const inParty = session.game.roster.party.some((x) => x.uid === m.uid);
    chip(inParty ? "Send to storage" : "Move to party", () => this.act(() => session.update({ ...session.game, roster: moveBetweenPartyAndStorage(session.game.roster, m.uid) })));
  }

  /**
   * Talent tree: the role's talents and the Pokémon's type talents by unlock level (left),
   * and the exact rules of the selected talent with a Learn button (right).
   */
  private renderTalents(m: PartyMember, y: number, add: <T extends Phaser.GameObjects.GameObject>(o: T) => T): void {
    const s = CONTENT.species[m.speciesId]!;
    const pending = pendingChoice(PROGRESSION, m);
    const treeW = 300;
    const infoX = DETAIL_X + treeW + 12;
    const infoW = DETAIL_W - treeW - 12;

    // Before the role is chosen, compare both roles; the role is picked on the right.
    const roleIds = m.role ? [m.role] : roleOptions(CONTENT, m);
    const intro = m.role
      ? `${tag("special", PROGRESSION.roles[m.role]!.name)} tree · ${pending === "talent" ? tag("num", "★ 1 talent to learn") : tag("dim", `next pick at Lv ${m.level + 1}`)}`
      : m.level >= PROGRESSION.rules.roleLevel
        ? tag("num", "★ Choose a role first. Tap a talent to see exactly what it does.")
        : tag("dim", `A role is chosen at Lv ${PROGRESSION.rules.roleLevel}. Preview its talents here.`);
    y += add(new RichText(this, DETAIL_X, y, DETAIL_W, 12)).setMarkup(intro) + 6;

    const typeTalents = Object.values(PROGRESSION.talents).filter((t) => t.requiresType && s.types.includes(t.requiresType)).map((t) => t.id);
    const available = new Set(pending === "talent" ? talentOptions(PROGRESSION, m, s.types) : []);
    const node = (x: number, ny: number, w: number, id: string) => {
      const t = PROGRESSION.talents[id]!;
      const taken = m.talents.filter((x2) => x2 === id).length;
      const locked = (t.minLevel ?? 0) > m.level;
      const state = t.stackable ? "" : taken ? "✓ " : available.has(id) ? "★ " : locked ? `Lv${t.minLevel} ` : "";
      const label = `${state}${t.name}${t.stackable && taken ? ` ×${taken}` : ""}`;
      const b = new Button(this, x, ny, w, 24, label, () => {
        this.selectedTalent = id;
        this.render();
      }).setHighlighted(this.selectedTalent === id);
      if (locked && !taken) b.setAlpha(0.55);
      add(b);
    };

    // Two columns: both roles side by side before the choice, or one role's tree in rows of two.
    const colW = Math.floor((treeW - 6) / 2);
    let bottom = y;
    if (roleIds.length > 1) {
      roleIds.forEach((roleId, col) => {
        const x = DETAIL_X + col * (colW + 6);
        let ry = y;
        add(new RichText(this, x, ry, colW, 12)).setMarkup(tag("special", PROGRESSION.roles[roleId]!.name));
        ry += 18;
        const ids = [...PROGRESSION.roles[roleId]!.talents].sort((a, b) => (PROGRESSION.talents[a]!.minLevel ?? 0) - (PROGRESSION.talents[b]!.minLevel ?? 0));
        for (const id of ids) {
          node(x, ry, colW, id);
          ry += 27;
        }
        if (!m.role && m.level >= PROGRESSION.rules.roleLevel) {
          const def = PROGRESSION.roles[roleId]!;
          add(new Button(this, x, ry + 4, colW, 26, `Become ${def.name}`, () =>
            this.act(() => this.updateMember(m, (x2) => chooseRole(CONTENT, PROGRESSION, x2, roleId)), `${s.name} is now a ${def.name}.`)).setHighlighted(true));
          ry += 34;
        }
        bottom = Math.max(bottom, ry);
      });
    } else {
      const ids = [...PROGRESSION.roles[roleIds[0]!]!.talents, ...typeTalents]
        .sort((a, b) => (PROGRESSION.talents[a]!.minLevel ?? 0) - (PROGRESSION.talents[b]!.minLevel ?? 0));
      ids.forEach((id, i) => node(DETAIL_X + (i % 2) * (colW + 6), y + Math.floor(i / 2) * 27, colW, id));
      bottom = y + Math.ceil(ids.length / 2) * 27;
    }

    // Repeatable stat talents.
    const statY = bottom + 22;
    add(new RichText(this, DETAIL_X, statY - 17, treeW, 11)).setMarkup(tag("dim", "Repeatable stat talents"));
    const stats = Object.values(PROGRESSION.talents).filter((t) => t.stackable).map((t) => t.id);
    const sw = Math.floor((treeW - 6 * (stats.length - 1)) / stats.length);
    stats.forEach((id, i) => node(DETAIL_X + i * (sw + 6), statY, sw, id));

    // Detail panel.
    const id = this.selectedTalent;
    if (!id) {
      add(new RichText(this, infoX, y, infoW, 12)).setMarkup(`${tag("dim", "Tap a talent to see its exact effect.")}\n\n${tag("dim", "✓ learned · ★ can be learned now · LvN unlocks at that level")}`);
      return;
    }
    const t = PROGRESSION.talents[id]!;
    const kind = t.stackable ? "Stat talent" : t.grantsMove ? "Skill talent" : t.requiresType ? `${t.requiresType} type talent` : "Role talent";
    const lines = [
      tag("title", t.name),
      tag("dim", `${kind}${t.minLevel ? ` · from Lv ${t.minLevel}` : ""}`),
      ...describeTalent(CONTENT, PROGRESSION, t),
    ];
    const h = add(new RichText(this, infoX, y, infoW, 12)).setMarkup(lines.join("\n"));
    if (available.has(id)) {
      add(new Button(this, infoX, Math.min(y + h + 8, 476), infoW, 28, `Learn ${t.name}`, () => {
        this.act(() => this.updateMember(m, (x2) => chooseTalent(PROGRESSION, x2, id, s.types)), `${s.name} learned ${t.name}.`);
        this.selectedTalent = null;
      }).setHighlighted(true));
    } else if (m.talents.includes(id) && !t.stackable) {
      add(new RichText(this, infoX, y + h + 8, infoW, 12)).setMarkup(tag("good", "Learned."));
    }
  }

  /** Held item: what it holds now, and every held item in the bag with its exact effect. */
  private renderEquipment(m: PartyMember, y: number, add: <T extends Phaser.GameObjects.GameObject>(o: T) => T): void {
    const s = CONTENT.species[m.speciesId]!;
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
