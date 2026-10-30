import Phaser from "phaser";
import { CONTENT, PROGRESSION } from "../../content";
import { knownSpecies } from "../../core/party";
import { focusOptions, masteryGrid, startingMoves } from "../../core/progression";
import { session } from "../session";
import { hasSprite, portraitKey } from "../sprites";
import { pixText } from "../ui/pixelFont";
import { pokemonStage } from "../ui/stage";
import { ballIcon } from "../ui/ballIcon";
import { Button } from "../ui/Button";
import { describeTalent, focusLabel, STAT_LABEL, statLine } from "../ui/describeEffects";
import { describeMove } from "../ui/describeMove";
import { tag } from "../ui/markup";
import { t } from "../i18n";
import { RichText } from "../ui/RichText";
import { COLORS, FONT, TYPE_COLORS, px } from "../ui/theme";
import { typeTag } from "../ui/typeName";
import { screenTitle } from "../ui/frames";

const LIST_X = 16;
const LIST_W = 200;
const ROWS = 19;
const DETAIL_X = LIST_X + LIST_W + 16;
const DETAIL_W = 944 - DETAIL_X;
const INFO_W = 250;

/** Every species in Pokédex order. */
const ALL = Object.values(CONTENT.species).sort((a, b) => (a.dex ?? 999) - (b.dex ?? 999));

/** The whole evolution line a species belongs to, first form first (branches side by side). */
function evolutionLine(id: string): string[] {
  const from = (x: string) => ALL.find((s) => s.evolution && (s.evolution.into === x || s.evolution.choices?.includes(x)))?.id;
  let root = id;
  for (let p = from(root); p; p = from(root)) root = p;
  const out: string[] = [];
  const walk = (x: string) => {
    out.push(x);
    const e = CONTENT.species[x]?.evolution;
    for (const next of e ? e.choices ?? [e.into] : []) walk(next);
  };
  walk(root);
  return out;
}

/**
 * The Pokédex: every species the player has met or owned, read straight from the game's content (stats,
 * role, ability, evolution line, starting moves and the whole mastery tree); tap a move or mastery for its rules.
 */
export class PokedexScene extends Phaser.Scene {
  private root!: Phaser.GameObjects.Container;
  private selected: string | null = null;
  private top = 0;
  private detail: string | null = null;
  private from = "Party";

  constructor() {
    super("Pokedex");
  }

  init(data: { from?: string }): void {
    this.from = data.from ?? "Party";
  }

  create(): void {
    // Screens fade in from the background colour instead of cutting.
    this.cameras.main.fadeIn(160, 16, 20, 28);
    this.root = this.add.container(0, 0);
    const known = knownSpecies(session.game);
    this.selected ??= ALL.find((s) => known.has(s.id))?.id ?? null;
    this.input.on("wheel", (_p: unknown, _o: unknown, _dx: number, dy: number) => this.scroll(Math.sign(dy) * 3));
    // On a phone the list scrolls by dragging it: a row per row's height dragged.
    let dragged = 0;
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!p.isDown || p.downX > LIST_X + LIST_W) return;
      dragged += p.prevPosition.y - p.y;
      const rows = Math.trunc(dragged / 24);
      if (rows) {
        dragged -= rows * 24;
        this.scroll(rows);
      }
    });
    this.input.on("pointerup", () => (dragged = 0));
    this.render();
  }

  private scroll(d: number): void {
    this.top = Phaser.Math.Clamp(this.top + d, 0, Math.max(0, ALL.length - ROWS));
    this.render();
  }

  private render(): void {
    this.root.removeAll(true);
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => (this.root.add(o), o);
    const known = knownSpecies(session.game);
    add(screenTitle(this, LIST_X, 14, t("Pokédex")));
    // Caught: every species that has been in the team (party, storage or fallen).
    const { party, storage, fallen } = session.game.roster;
    const caught = new Set([...party, ...storage, ...fallen].map((m) => m.speciesId));
    add(this.add.text(LIST_X + 140, 20, t("Seen {n}/{total} · caught {c}", { n: known.size, total: ALL.length, c: caught.size }), { fontFamily: FONT, fontSize: px(13), color: COLORS.dim }));
    add(new Button(this, 794, 12, 150, 26, t("← Back"), () => this.scene.start(this.from, { rested: false, choosingMeal: false })));

    // The list: met species by name, the rest as "???".
    add(new Button(this, LIST_X, 48, LIST_W / 2 - 3, 22, "▲", () => this.scroll(-ROWS)).centerLabel().setEnabled(this.top > 0));
    add(new Button(this, LIST_X + LIST_W / 2 + 3, 48, LIST_W / 2 - 3, 22, "▼", () => this.scroll(ROWS)).centerLabel().setEnabled(this.top + ROWS < ALL.length));
    ALL.slice(this.top, this.top + ROWS).forEach((s, i) => {
      const met = known.has(s.id);
      const label = `${String(s.dex ?? "").padStart(3, "0")} ${met ? s.name : "???"}`;
      const b = add(new Button(this, LIST_X, 76 + i * 24, LIST_W, 22, label, () => {
        this.selected = s.id;
        this.detail = null;
        this.render();
      }).setHighlighted(s.id === this.selected));
      if (met) b.setAccent(TYPE_COLORS[s.types[0]!] ?? 0x888888);
      else b.setMuted();
      // A Poké Ball at the right of the ones caught.
      if (caught.has(s.id)) add(this.add.image(LIST_X + LIST_W - 12, 76 + i * 24 + 11, ballIcon(this, "poke-ball")).setDisplaySize(14, 14));
    });

    if (this.selected && known.has(this.selected)) this.renderSpecies(this.selected, add);
    else if (this.selected) this.renderUnknown(this.selected, add);
    else add(new RichText(this, DETAIL_X, 52, DETAIL_W, 13)).setMarkup(tag("dim", t("Meet a Pokémon in battle to add it to the Pokédex.")));
  }

  /** A Pokémon not met yet: only its shape, black, on a light burst (who's that Pokémon?). */
  private renderUnknown(id: string, add: <T extends Phaser.GameObjects.GameObject>(o: T) => T): void {
    const s = CONTENT.species[id]!;
    const cx = DETAIL_X + DETAIL_W / 2, cy = 250;
    const rays = add(this.add.graphics({ x: cx, y: cy }));
    for (let i = 0; i < 16; i++) rays.fillStyle(i % 2 ? 0x2a5aa8 : 0x3d7dca, 0.5).slice(0, 0, 190, (i / 16) * Math.PI * 2, ((i + 1) / 16) * Math.PI * 2, false).fillPath();
    this.tweens.add({ targets: rays, angle: 360, duration: 30_000, repeat: -1 });
    if (hasSprite(id)) {
      const shape = add(this.add.image(cx, cy + 40, `${id}-idle`, 0).setOrigin(0.5, 1));
      shape.setScale(shape.frame.height > 64 ? 2 : 4).setTint(0x0b0e14).setTintMode(Phaser.TintModes.FILL);
    }
    add(pixText(this, cx, cy + 90, `No.${String(s.dex ?? "").padStart(3, "0")}  ???`, 0xffffff, 3).setOrigin(0.5));
    add(new RichText(this, cx - 200, cy + 120, 400, 13)).setMarkup(tag("dim", t("Meet a Pokémon in battle to add it to the Pokédex.")));
  }

  private renderSpecies(id: string, add: <T extends Phaser.GameObjects.GameObject>(o: T) => T): void {
    const s = CONTENT.species[id]!;
    const known = knownSpecies(session.game);
    const role = s.role ? `  ${tag("special", s.role === "melee" ? t("Melee") : t("Ranged"))}` : "";
    const line = evolutionLine(id).map((x) => {
      const name = known.has(x) ? CONTENT.species[x]!.name : "???";
      const lv = CONTENT.species[x]!.evolution ? tag("dim", ` (Lv ${CONTENT.species[x]!.evolution!.level})`) : "";
      return `${x === id ? tag("title", name) : name}${lv}`;
    }).join(" → ");
    const ability = s.ability ? CONTENT.abilities[s.ability] : undefined;
    const header = [
      `${s.types.map((ty) => typeTag(ty)).join("/")}${role}`,
      `${t("Lv 1:")} ${STAT_LABEL.hp} ${tag("num", s.stats.hp)}  ${statLine(s.stats)}`,
      ...(ability ? [`${t("Ability:")} ${tag("special", ability.name)} ${tag("dim", ability.description)}`] : []),
      `${t("Evolution:")} ${line}`,
    ];
    // The Pokémon itself on its stage at the right (tap it for its cry), its number and name over the facts.
    pokemonStage(this, DETAIL_X + DETAIL_W - 170, 46, 170, 104, id, add, true);
    const no = add(pixText(this, DETAIL_X, 46, `No.${String(s.dex ?? "").padStart(3, "0")}`, 0x8a93a6, 2));
    add(pixText(this, no.x + no.width + 10, 46, s.name, 0xffffff, 2));
    let y = 74 + add(new RichText(this, DETAIL_X, 74, DETAIL_W - 186, 12)).setMarkup(header.slice(1).join("\n"));
    y = Math.max(y, 150) + 8;

    const gridW = DETAIL_W - INFO_W - 12;
    const infoX = DETAIL_X + gridW + 12;
    const cell = (x: number, cy: number, w: number, label: string, key: string, type?: string) => {
      const b = add(new Button(this, x, cy, w, 22, label, () => {
        this.detail = key;
        this.render();
      }).setHighlighted(this.detail === key).centerLabel());
      if (type && TYPE_COLORS[type] !== undefined) b.setAccent(TYPE_COLORS[type]!);
    };
    const rowX = (n: number, w: number) => DETAIL_X + 44 + (gridW - 44 - (n * w + 6 * (n - 1))) / 2;
    const width = (n: number) => Math.min(170, Math.floor((gridW - 44 - 6 * (n - 1)) / Math.max(1, n)));
    const label = (cy: number, s2: string) => add(new RichText(this, DETAIL_X, cy + 4, 44, 11)).setMarkup(tag("dim", s2));

    // Starting moves.
    const moves = startingMoves(s);
    label(y, t("Start"));
    moves.forEach((mv, i) => cell(rowX(moves.length, width(moves.length)) + i * (width(moves.length) + 6), y, width(moves.length), CONTENT.moves[mv]?.name ?? mv, `move:${mv}`, CONTENT.moves[mv]?.type));
    y += 30;

    // The mastery tree: focus row, then one row per level.
    const moveType = (talent: string) => {
      const mv = PROGRESSION.talents[talent]?.grantsMove;
      return mv ? CONTENT.moves[mv]?.type : undefined;
    };
    const focuses = focusOptions(PROGRESSION, id);
    if (focuses.length) {
      label(y, `Lv ${PROGRESSION.rules.focusLevel}`);
      const w = width(focuses.length);
      focuses.forEach((f, i) => cell(rowX(focuses.length, w) + i * (w + 6), y, w, PROGRESSION.talents[f.skill]?.name ?? f.skill, `focus:${f.skill}`, moveType(f.skill)));
      y += 28;
    }
    for (const row of masteryGrid(PROGRESSION, id)) {
      label(y, `Lv ${row.level}`);
      const w = width(row.options.length);
      row.options.forEach((o, i) => cell(rowX(row.options.length, w) + i * (w + 6), y, w, PROGRESSION.talents[o]?.name ?? o, o, moveType(o)));
      y += 28;
    }

    // The selected move or mastery, with its exact rules.
    const key = this.detail;
    let text: string;
    if (key?.startsWith("move:")) text = describeMove(CONTENT, CONTENT.moves[key.slice(5)]!);
    else if (key?.startsWith("focus:")) {
      const f = focuses.find((x) => `focus:${x.skill}` === key)!;
      const skill = PROGRESSION.talents[f.skill]!;
      text = [tag("title", skill.name), tag("dim", t("Focus · Lv {lv}", { lv: PROGRESSION.rules.focusLevel })), focusLabel(f.stat), ...describeTalent(CONTENT, PROGRESSION, skill)].join("\n");
    } else if (key && PROGRESSION.talents[key]) {
      const tal = PROGRESSION.talents[key]!;
      text = [tag("title", tal.name), tag("dim", tal.grantsMove ? t("Skill") : t("Passive")), ...describeTalent(CONTENT, PROGRESSION, tal)].join("\n");
    } else text = tag("dim", t("Tap a move or mastery to see its exact effect."));
    add(new RichText(this, infoX, 52 + 110, INFO_W, 12)).setMarkup(text);
  }
}
