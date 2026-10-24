import Phaser from "phaser";
import { CONTENT, PROGRESSION } from "../../content";
import { KNOCKOUTS_TO_DEATH, MAX_PARTY_SIZE, memberMaxHp, type PartyMember } from "../../core/party";
import { pendingChoice } from "../../core/progression";
import { session } from "../session";
import { portraitKey } from "../sprites";
import { Button } from "../ui/Button";
import { tag } from "../ui/markup";
import { RichText } from "../ui/RichText";
import { COLORS, FONT, TYPE_COLORS, px } from "../ui/theme";

const CARD_W = 300;
const CARD_H = 112;

/** Party overview: who is in the team and what needs attention. Details open per Pokémon. */
export class PartyScene extends Phaser.Scene {
  private camped = false;

  constructor() {
    super("Party");
  }

  init(data: { camped?: boolean }): void {
    this.camped = data?.camped ?? false;
  }

  create(): void {
    const { roster, money, inventory } = session.game;
    this.add.text(16, 14, this.camped ? "Camp" : "Party", { fontFamily: FONT, fontSize: "20px", color: "#f5d76e" });
    new RichText(this, 120, 19, 400, 14).setMarkup(`${tag("num", `₽${money}`)}   Candy ${tag("num", inventory.items.candy ?? 0)}`);
    new Button(this, 794, 12, 150, 26, "➜ Back to map", () => this.scene.start("Overworld"));
    if (this.camped) {
      new RichText(this, 16, 44, 928, 12).setMarkup(tag("good", "You made camp: HP and fatigue restored, wild Pokémon have moved. Defeat brings you back here."));
    }

    this.add.text(16, 64, `Party ${roster.party.length}/${MAX_PARTY_SIZE} · tap a Pokémon for level-ups, moves and equipment`, {
      fontFamily: FONT, fontSize: px(12), color: COLORS.dim,
    });
    roster.party.forEach((m, i) => this.card(16 + (i % 3) * (CARD_W + 14), 84 + Math.floor(i / 3) * (CARD_H + 10), m));

    const sy = 84 + 2 * (CARD_H + 10) + 6;
    this.add.text(16, sy, `Storage (${roster.storage.length})`, { fontFamily: FONT, fontSize: px(12), color: COLORS.dim });
    roster.storage.slice(0, 6).forEach((m, i) => this.mini(16 + i * 154, sy + 18, m));
    if (roster.storage.length > 6) this.add.text(16, sy + 62, `+${roster.storage.length - 6} more`, { fontFamily: FONT, fontSize: px(11), color: COLORS.dim });
    if (roster.fallen.length) {
      new RichText(this, 16, 512, 928, 12).setMarkup(`${tag("ko", "Fallen")}: ${roster.fallen.map((m) => CONTENT.species[m.speciesId]!.name).join(", ")}`);
    }
  }

  private open(m: PartyMember): void {
    this.scene.start("Pokemon", { uid: m.uid });
  }

  private portrait(x: number, y: number, size: number, speciesId: string): void {
    if (this.textures.exists(portraitKey(speciesId))) this.add.image(x, y, portraitKey(speciesId)).setOrigin(0).setDisplaySize(size, size);
    else this.add.circle(x + size / 2, y + size / 2, size / 2 - 2, TYPE_COLORS[CONTENT.species[speciesId]!.types[0]!] ?? 0x888888);
  }

  /** A party card: portrait, name, level, HP bar, knockouts, role, held item, and what is waiting. */
  private card(x: number, y: number, m: PartyMember): void {
    const s = CONTENT.species[m.speciesId]!;
    const pending = pendingChoice(PROGRESSION, m);
    const waiting = [pending === "role" ? "choose a role" : pending === "talent" ? "learn a talent" : "", m.unspentPoints ? `${m.unspentPoints} stat point${m.unspentPoints > 1 ? "s" : ""}` : ""].filter(Boolean);
    const bg = this.add.rectangle(x, y, CARD_W, CARD_H, 0x1c2130).setOrigin(0)
      .setStrokeStyle(waiting.length ? 2 : 1, waiting.length ? 0xf5d76e : m.knockouts === 2 ? 0xd0021b : 0x3a4560);
    bg.setInteractive({ useHandCursor: true }).on("pointerdown", () => this.open(m));
    this.portrait(x + 8, y + 8, 56, m.speciesId);

    const max = memberMaxHp(CONTENT, PROGRESSION, m);
    const frac = m.hp / max;
    const role = m.role ? PROGRESSION.roles[m.role]!.name : "no role yet";
    const held = m.heldItem ? PROGRESSION.items[m.heldItem]!.name : "no item";
    const pips = "●".repeat(m.knockouts) + "○".repeat(KNOCKOUTS_TO_DEATH - m.knockouts);
    new RichText(this, x + 74, y + 8, CARD_W - 82, 13).setMarkup([
      `${tag("title", s.name)}  Lv ${tag("num", m.level)}`,
      `${s.types.map((t) => tag(t, t)).join("/")}  ${tag("dim", role)}`,
      `${tag("dim", held)}`,
    ].join("\n"));
    // HP bar and knockouts.
    this.add.rectangle(x + 8, y + 72, CARD_W - 16, 6, 0x000000).setOrigin(0, 0.5);
    this.add.rectangle(x + 8, y + 72, (CARD_W - 16) * frac, 6, frac > 0.5 ? 0x7ed321 : frac > 0.25 ? 0xf5a623 : 0xd0021b).setOrigin(0, 0.5);
    new RichText(this, x + 8, y + 80, CARD_W - 16, 12).setMarkup(
      `${m.hp > 0 ? `HP ${m.hp}/${max}` : tag("ko", "fainted")}   KO ${tag(m.knockouts ? "ko" : "dim", pips)}${waiting.length ? `   ${tag("num", `★ ${waiting.join(", ")}`)}` : ""}`);
  }

  private mini(x: number, y: number, m: PartyMember): void {
    const s = CONTENT.species[m.speciesId]!;
    const bg = this.add.rectangle(x, y, 148, 40, 0x1c2130).setOrigin(0).setStrokeStyle(1, 0x3a4560);
    bg.setInteractive({ useHandCursor: true }).on("pointerdown", () => this.open(m));
    this.portrait(x + 4, y + 4, 32, m.speciesId);
    this.add.text(x + 42, y + 4, `${s.name}`, { fontFamily: FONT, fontSize: px(12), color: COLORS.text });
    this.add.text(x + 42, y + 21, `Lv ${m.level}`, { fontFamily: FONT, fontSize: px(11), color: COLORS.dim });
  }
}
