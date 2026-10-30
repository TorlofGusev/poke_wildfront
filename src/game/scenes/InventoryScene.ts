import Phaser from "phaser";
import { playMusic } from "../music";
import { CONTENT, PROGRESSION } from "../../content";
import { session } from "../session";
import { Button } from "../ui/Button";
import { ballIcon } from "../ui/ballIcon";
import { itemIcon } from "../ui/itemIcon";
import { describeItem } from "../ui/describeEffects";
import { tag } from "../ui/markup";
import { RichText } from "../ui/RichText";
import { FONT } from "../ui/theme";
import { t } from "../i18n";
import { panel, screenTitle } from "../ui/frames";
import { scrollArea } from "../ui/scrollArea";
import { pixText } from "../ui/pixelFont";

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
    // Screens fade in from the background colour instead of cutting.
    this.cameras.main.fadeIn(160, 16, 20, 28);
    playMusic(this, "overworld");
    const { inventory, money, roster } = session.game;
    const title = screenTitle(this, 16, 14, t("Bag"));
    new RichText(this, 16 + title.width + 18, 19, 400, 14).setMarkup(`${tag("num", `₽${money}`)}`);
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
    // Pockets: framed panels in two columns, each pocket going where there is more room.
    const colX = [16, 488], colY = [54, 54], pocketW = 450;
    const pocket = (title: string, rows: readonly { id: string; text: string }[]) => {
      const c = colY[0]! <= colY[1]! ? 0 : 1;
      const x = colX[c]!, top = colY[c]!;
      const frame = panel(this, x, top, pocketW, 40).setDepth(-1);
      let y = top + 10;
      pixText(this, x + 12, y, title.toUpperCase(), 0xf5d76e, 2);
      y += 24;
      if (!rows.length) y += new RichText(this, x + 12, y, pocketW - 24, 12).setMarkup(tag("dim", t("none")));
      for (const row of rows) y += this.iconRow(x + 12, y, row.id, row.text) + 4;
      frame.destroy();
      panel(this, x, top, pocketW, y - top + 6).setDepth(-1);
      colY[c] = y + 18;
    };
    // The pockets scroll (wheel, drag or the bar) once there is more than a screen of them.
    scrollArea(this, 0, 48, 960, 492, () => {
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
        pocket(title, rows);
      }
      const keyItems = (session.game.keyItems ?? []).map((k) => PROGRESSION.keyItems?.[k]).filter((k) => k !== undefined);
      pocket(t("Key items"), keyItems.map((k) => ({ id: k.id, text: `${tag("title", k.name)} ${tag("dim", "—")} ${k.description}` })));
      return Math.max(...colY);
    });
  }

  /** One line of the bag with the thing's icon in front (a ball's, else the item's). Returns its height. */
  private iconRow(x: number, y: number, id: string, text: string): number {
    this.add.image(x + 12, y + 11, CONTENT.balls[id] ? ballIcon(this, id) : itemIcon(this, id)).setDisplaySize(24, 24);
    return Math.max(24, new RichText(this, x + 32, y + 3, 400, 12).setMarkup(text));
  }
}
