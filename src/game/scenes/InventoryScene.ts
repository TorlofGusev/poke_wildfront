import Phaser from "phaser";
import { playMusic } from "../music";
import { CONTENT, PROGRESSION } from "../../content";
import { session } from "../session";
import { Button } from "../ui/Button";
import { ballIcon } from "../ui/ballIcon";
import { describeItem } from "../ui/describeEffects";
import { tag } from "../ui/markup";
import { RichText } from "../ui/RichText";
import { FONT } from "../ui/theme";
import { t } from "../i18n";

/** The bag: everything carried, grouped by use, with exact effects. Opened from the map or camp. */
export class InventoryScene extends Phaser.Scene {
  private returnTo = "Overworld";

  constructor() {
    super("Inventory");
  }

  init(data: { from?: string }): void {
    this.returnTo = data?.from ?? "Overworld";
  }

  create(): void {
    playMusic(this, "overworld");
    const { inventory, money, roster } = session.game;
    this.add.text(16, 14, t("Bag"), { fontFamily: FONT, fontSize: "20px", color: "#f5d76e" });
    new RichText(this, 90, 19, 400, 14).setMarkup(`${tag("num", `₽${money}`)}`);
    new Button(this, 794, 12, 150, 26, t("← Back"), () => this.scene.start(this.returnTo, this.returnTo === "Party" ? { rested: false, choosingMeal: false } : {}));

    // Who holds an item, a repeated species counted once ("Charizard ×2").
    const heldBy = (id: string) => {
      const names = roster.party.concat(roster.storage).filter((m) => m.heldItem === id).map((m) => CONTENT.species[m.speciesId]!.name);
      return [...new Set(names)].map((n) => (names.filter((x) => x === n).length > 1 ? `${n} ×${names.filter((x) => x === n).length}` : n));
    };
    const groups: [string, string[]][] = [
      [t("Poké Balls"), Object.keys(CONTENT.balls)],
      [CONTENT.terms.food, Object.values(PROGRESSION.items).filter((i) => i.kind === "food").map((i) => i.id)],
      [t("Healing and Rare Candy"), Object.values(PROGRESSION.items).filter((i) => i.kind === "potion" || i.kind === "candy" || i.kind === "remedy").map((i) => i.id)],
      [t("Held items"), Object.values(PROGRESSION.items).filter((i) => i.kind === "held").map((i) => i.id)],
    ];
    let y = 52;
    const col = { x: 16 };
    for (const [title, ids] of groups) {
      const rows = ids
        .map((id) => {
          const ball = CONTENT.balls[id];
          const count = ball ? inventory.balls[id] ?? 0 : inventory.items[id] ?? 0;
          const holders = ball ? [] : heldBy(id);
          if (count <= 0 && holders.length === 0) return null;
          const name = ball?.name ?? PROGRESSION.items[id]!.name;
          const effect = ball ? t("catch chance ×{x}", { x: ball.multiplier }) : describeItem(CONTENT, PROGRESSION.items[id]!).join(" · ");
          // Every one of them held: no "0×" in front, the holders say where they are.
          return { id, text: `${count > 0 ? `${tag("num", `${count}×`)} ` : ""}${tag("title", name)} ${tag("dim", "—")} ${effect}${holders.length ? tag("dim", t(" (held by {names})", { names: holders.join(", ") })) : ""}` };
        })
        .filter((r): r is { id: string; text: string } => r !== null);
      y += new RichText(this, col.x, y, 450, 12).setMarkup(tag("special", title));
      if (!rows.length) y += new RichText(this, col.x, y, 450, 12).setMarkup(tag("dim", t("none")));
      // One text per row, so a ball can carry its icon in front.
      for (const row of rows) {
        const icon = CONTENT.balls[row.id] ? 20 : 0;
        if (icon) this.add.image(col.x + 8, y + 8, ballIcon(this, row.id)).setDisplaySize(14, 14);
        y += new RichText(this, col.x + icon, y, 450 - icon, 12).setMarkup(row.text);
      }
      y += 14;
      // Two columns: move to the right when the left fills up.
      if (y > 420 && col.x === 16) {
        col.x = 490;
        y = 52;
      }
    }
    const keyItems = (session.game.keyItems ?? []).map((k) => PROGRESSION.keyItems?.[k]).filter((k) => k !== undefined);
    const keyRows = keyItems.map((k) => `${tag("title", k.name)} ${tag("dim", "—")} ${k.description}`);
    new RichText(this, col.x, y, 450, 12).setMarkup([tag("special", t("Key items")), ...(keyRows.length ? keyRows : [tag("dim", t("none"))])].join("\n"));
  }
}
