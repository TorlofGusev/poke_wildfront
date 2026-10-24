import Phaser from "phaser";
import { CONTENT, PROGRESSION } from "../../content";
import {
  allocatePoint,
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
import { tag } from "../ui/markup";
import { RichText } from "../ui/RichText";
import { COLORS, FONT, TYPE_COLORS, px } from "../ui/theme";

const LIST_X = 16;
const DETAIL_X = 336;
const DETAIL_W = 608;

/** Party management: details, role and talent choices, moves, items, potions, storage. */
export class PartyScene extends Phaser.Scene {
  private root!: Phaser.GameObjects.Container;
  private selected: string | null = null;
  private message = "";
  private camped = false;

  constructor() {
    super("Party");
  }

  init(data: { camped?: boolean }): void {
    this.camped = data?.camped ?? false;
    this.message = this.camped ? tag("good", "You made camp: HP and fatigue restored, wild Pokémon have moved. Defeat brings you back here.") : "";
    this.selected = session.game.roster.party.find((m) => pendingChoice(PROGRESSION, m) || m.unspentPoints > 0)?.uid ?? session.game.roster.party[0]?.uid ?? null;
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

    text(LIST_X, 14, this.camped ? "Camp" : "Party", "#f5d76e", 20);
    text(LIST_X + 120, 20, `₽${money}`, "#f5d76e", 14);
    add(new Button(this, DETAIL_X + DETAIL_W - 150, 12, 150, 26, "➜ Back to map", () => this.scene.start("Overworld")));

    text(LIST_X, 48, `Party ${roster.party.length}/${MAX_PARTY_SIZE}`, COLORS.dim, 12);
    roster.party.forEach((m, i) => add(this.card(LIST_X, 66 + i * 40, m)));
    const sy = 66 + MAX_PARTY_SIZE * 40 + 6;
    text(LIST_X, sy, `Storage (${roster.storage.length})`, COLORS.dim, 12);
    roster.storage.slice(0, 4).forEach((m, i) => add(this.card(LIST_X, sy + 18 + i * 40, m)));
    if (roster.storage.length > 4) text(LIST_X, sy + 18 + 4 * 40, `+${roster.storage.length - 4} more`, COLORS.dim, 11);

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
    const evo = s.evolution ? ` · evolves at Lv ${s.evolution.level}` : "";
    const header = [
      `${tag("title", s.name)}  ${s.types.map((t) => tag(t, t)).join("/")}  Lv ${tag("num", m.level)}  XP ${m.xp}/${xpToNext(PROGRESSION, m.level)}${tag("dim", evo)}`,
      `HP ${tag(m.hp > 0 ? "heal" : "ko", `${m.hp}/${maxHp}`)}  Atk ${stats.attack}  Def ${stats.defense}  Spe ${stats.speed}  KO ${tag(m.knockouts ? "ko" : "dim", `${m.knockouts}/${KNOCKOUTS_TO_DEATH}`)}`,
      ...(s.ability && CONTENT.abilities[s.ability] ? [`Ability: ${tag("special", CONTENT.abilities[s.ability]!.name)} ${tag("dim", CONTENT.abilities[s.ability]!.description)}`] : []),
      `Role: ${role ? tag("special", role.name) : tag("dim", m.level < PROGRESSION.rules.roleLevel ? `chosen at Lv ${PROGRESSION.rules.roleLevel}` : "not chosen")}` +
        (m.talents.length ? `  Talents: ${m.talents.map((t) => tag("num", PROGRESSION.talents[t]?.name ?? t)).join(", ")}` : ""),
    ];
    let y = 48;
    if (this.textures.exists(portraitKey(m.speciesId))) add(this.add.image(DETAIL_X + DETAIL_W - 32, 72, portraitKey(m.speciesId)).setDisplaySize(64, 64));
    y += add(new RichText(this, DETAIL_X, y, DETAIL_W - 76, 13)).setMarkup(header.join("\n")) + 6;

    // Stat points: +1 per level, +2 with the matching vitamin.
    if (m.unspentPoints > 0) {
      y += add(new RichText(this, DETAIL_X, y, DETAIL_W, 13)).setMarkup(tag("num", `★ ${m.unspentPoints} stat point${m.unspentPoints > 1 ? "s" : ""} to spend:`)) + 4;
      const labels: Record<StatName, string> = { hp: "HP", attack: "Atk", defense: "Def", speed: "Spe" };
      const w = Math.floor((DETAIL_W - 18) / 4);
      STAT_NAMES.forEach((stat, i) => {
        add(new Button(this, DETAIL_X + i * (w + 6), y, w, 24, `+1 ${labels[stat]}`, () =>
          this.act(() => session.update(allocatePoint(PROGRESSION, session.game, m.uid, stat)))));
        const vit = Object.values(PROGRESSION.items).find((it) => it.kind === "vitamin" && it.stat === stat);
        const owned = vit ? session.game.inventory.items[vit.id] ?? 0 : 0;
        if (vit && owned > 0) {
          add(new Button(this, DETAIL_X + i * (w + 6), y + 27, w, 22, `+2 (${vit.name} ×${owned})`, () =>
            this.act(() => session.update(allocatePoint(PROGRESSION, session.game, m.uid, stat, vit.id)), `${vit.name} used: +2 ${labels[stat]}.`)));
        }
      });
      const anyVit = STAT_NAMES.some((stat) => Object.values(PROGRESSION.items).some((it) => it.kind === "vitamin" && it.stat === stat && (session.game.inventory.items[it.id] ?? 0) > 0));
      y += anyVit ? 56 : 30;
    }

    const pending = pendingChoice(PROGRESSION, m);
    if (pending === "role") {
      y += add(new RichText(this, DETAIL_X, y, DETAIL_W, 13)).setMarkup(tag("num", "★ Choose a role (permanent):")) + 4;
      for (const r of roleOptions(CONTENT, m)) {
        const def = PROGRESSION.roles[r]!;
        add(new Button(this, DETAIL_X, y, DETAIL_W, 26, `${def.name}: ${def.description}`, () =>
          this.act(() => this.updateMember(m, (x) => chooseRole(CONTENT, PROGRESSION, x, r)), `${s.name} is now a ${def.name}.`)));
        y += 30;
      }
    } else if (pending === "talent") {
      y += add(new RichText(this, DETAIL_X, y, DETAIL_W, 13)).setMarkup(tag("num", "★ Choose a talent:")) + 4;
      const options = talentOptions(PROGRESSION, m, s.types);
      // Role, skill and type talents get a full row each; stat talents share one row.
      for (const t of options.filter((id) => !PROGRESSION.talents[id]!.stackable)) {
        const def = PROGRESSION.talents[t]!;
        const kind = def.grantsMove ? "skill" : def.requiresType ? def.requiresType : "role";
        add(new Button(this, DETAIL_X, y, DETAIL_W, 24, `[${kind}] ${def.name}: ${def.description}`, () =>
          this.act(() => this.updateMember(m, (x) => chooseTalent(PROGRESSION, x, t, s.types)), `${s.name} learned ${def.name}.`)));
        y += 27;
      }
      const stats = options.filter((id) => PROGRESSION.talents[id]!.stackable);
      const w = Math.floor((DETAIL_W - 6 * (stats.length - 1)) / Math.max(1, stats.length));
      stats.forEach((t, i) => {
        const def = PROGRESSION.talents[t]!;
        add(new Button(this, DETAIL_X + i * (w + 6), y, w, 24, `${def.name} (${def.description.replace(" point.", "")})`, () =>
          this.act(() => this.updateMember(m, (x) => chooseTalent(PROGRESSION, x, t, s.types)), `${s.name} learned ${def.name}.`)));
      });
      if (stats.length) y += 27;
    }

    // Moves: the basic attack is fixed; toggle up to 3 others.
    const basic = basicMoveOf(CONTENT, s);
    y += 4;
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

    // Held item and bag.
    const bag = session.game.inventory.items;
    const held = m.heldItem ? PROGRESSION.items[m.heldItem] : null;
    y += add(new RichText(this, DETAIL_X, y, DETAIL_W, 13)).setMarkup(
      `${tag("title", "Held item")}: ${held ? `${tag("num", held.name)} ${tag("dim", held.description)}` : tag("dim", "none")}`) + 4;
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
    if (held) chip("Take off", () => this.act(() => session.update(equipItem(PROGRESSION, session.game, m.uid, null))));
    for (const [id, n] of Object.entries(bag)) {
      const item = PROGRESSION.items[id];
      if (!item || n <= 0) continue;
      if (item.kind === "held") chip(`Give ${item.name} (${n})`, () => this.act(() => session.update(equipItem(PROGRESSION, session.game, m.uid, id)), `${s.name} now holds ${item.name}.`));
      else chip(`Use ${item.name} (${n})`, () => this.act(() => session.update(usePotion(CONTENT, PROGRESSION, session.game, m.uid, id)), `${s.name} recovered HP.`));
    }
    const inParty = session.game.roster.party.some((x) => x.uid === m.uid);
    chip(inParty ? "Send to storage" : "Move to party", () => this.act(() => session.update({ ...session.game, roster: moveBetweenPartyAndStorage(session.game.roster, m.uid) })));
  }
}
