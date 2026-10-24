import Phaser from "phaser";
import { CONTENT, SCENARIOS } from "../../content";
import { maxHpOf } from "../../core/battle";
import { KNOCKOUTS_TO_DEATH, MAX_PARTY_SIZE, moveBetweenPartyAndStorage, restAll, type PartyMember } from "../../core/party";
import { session } from "../session";
import { Button } from "../ui/Button";
import { COLORS, FONT, TYPE_COLORS } from "../ui/theme";

/** Prototype hub: manage party/storage, rest, and pick a battle. */
export class CampScene extends Phaser.Scene {
  private root!: Phaser.GameObjects.Container;
  private message = "";

  constructor() {
    super("Camp");
  }

  create(): void {
    this.message = "";
    this.root = this.add.container(0, 0);
    this.render();
  }

  private render(): void {
    this.root.removeAll(true);
    const { roster, inventory } = session.game;
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => {
      this.root.add(o);
      return o;
    };
    const label = (x: number, y: number, s: string, color: string = COLORS.text, size = 13) =>
      add(this.add.text(x, y, s, { fontFamily: FONT, fontSize: `${size}px`, color }));

    label(16, 16, "Camp", "#f5d76e", 20);
    label(16, 44, "Click a Pokémon to move it between party and storage.", COLORS.dim, 12);

    label(16, 72, `Party ${roster.party.length}/${MAX_PARTY_SIZE}`, COLORS.text, 14);
    roster.party.forEach((m, i) => add(this.memberCard(16, 96 + i * 44, m, () => this.swap(m.uid))));

    label(336, 72, `Storage (${roster.storage.length})`, COLORS.text, 14);
    roster.storage.slice(0, 8).forEach((m, i) => add(this.memberCard(336, 96 + i * 44, m, () => this.swap(m.uid))));
    if (roster.storage.length > 8) label(336, 96 + 8 * 44, `+${roster.storage.length - 8} more`, COLORS.dim, 12);

    label(656, 72, "Bag", COLORS.text, 14);
    Object.entries(inventory.balls).forEach(([id, n], i) => label(656, 96 + i * 18, `${CONTENT.balls[id]?.name ?? id} ×${n}`, COLORS.dim, 12));

    let y = 170;
    add(new Button(this, 656, y, 288, 28, "⛺ Rest (restore all HP)", () => {
      session.update({ ...session.game, roster: restAll(CONTENT, session.game.roster) });
      this.message = "Your team rests. HP restored. Knockout counters do not heal.";
      this.render();
    }));
    y += 36;
    for (const sc of Object.values(SCENARIOS)) {
      const ready = roster.party.some((m) => m.hp > 0);
      add(new Button(this, 656, y, 288, 28, `⚔ ${sc.name}`, () => this.scene.start("Battle", { scenarioId: sc.id })).setEnabled(ready));
      y += 36;
    }
    add(new Button(this, 656, y, 288, 28, "⌂ Title", () => this.scene.start("Title")));
    y += 44;
    if (this.message) add(this.add.text(656, y, this.message, { fontFamily: FONT, fontSize: "12px", color: COLORS.good, wordWrap: { width: 288 } }));

    if (roster.fallen.length) {
      label(656, 400, "Fallen", COLORS.bad, 14);
      label(656, 422, roster.fallen.map((m) => CONTENT.species[m.speciesId]!.name).join(", "), COLORS.dim, 12)
        .setWordWrapWidth(288);
    }
  }

  private memberCard(x: number, y: number, m: PartyMember, onClick: () => void): Phaser.GameObjects.Container {
    const s = CONTENT.species[m.speciesId]!;
    const max = maxHpOf(CONTENT, m.speciesId);
    const pips = "●".repeat(m.knockouts) + "○".repeat(KNOCKOUTS_TO_DEATH - m.knockouts);
    const bg = this.add.rectangle(0, 0, 300, 38, 0x1c2130).setOrigin(0).setStrokeStyle(1, m.knockouts === 2 ? 0xd0021b : 0x3a4560);
    bg.setInteractive({ useHandCursor: true }).on("pointerdown", onClick);
    const dot = this.add.circle(19, 19, 12, TYPE_COLORS[s.types[0]!] ?? 0x888888);
    const name = this.add.text(38, 4, s.name, { fontFamily: FONT, fontSize: "13px", color: COLORS.text });
    const hp = this.add.text(38, 21, m.hp > 0 ? `HP ${m.hp}/${max}` : "fainted", { fontFamily: FONT, fontSize: "11px", color: m.hp > 0 ? COLORS.dim : COLORS.bad });
    const ko = this.add.text(292, 19, `KO ${pips}`, { fontFamily: FONT, fontSize: "12px", color: m.knockouts === 2 ? COLORS.bad : COLORS.dim }).setOrigin(1, 0.5);
    return this.add.container(x, y, [bg, dot, name, hp, ko]);
  }

  private swap(uid: string): void {
    try {
      session.update({ ...session.game, roster: moveBetweenPartyAndStorage(session.game.roster, uid) });
      this.message = "";
    } catch (e) {
      this.message = e instanceof Error ? `Cannot move: ${e.message}.` : "Cannot move.";
    }
    this.render();
  }
}
