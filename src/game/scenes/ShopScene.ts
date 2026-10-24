import Phaser from "phaser";
import { CONTENT, PROGRESSION } from "../../content";
import { buy } from "../../core/party";
import { session } from "../session";
import { Button } from "../ui/Button";
import { tag } from "../ui/markup";
import { RichText } from "../ui/RichText";
import { COLORS, FONT, px } from "../ui/theme";

interface Ware {
  readonly id: string;
  readonly name: string;
  readonly price: number;
  readonly description: string;
  readonly owned: number;
}

/** Poké Mart: buy balls, potions and held items with Pokédollars. */
export class ShopScene extends Phaser.Scene {
  private root!: Phaser.GameObjects.Container;
  private message = "";

  constructor() {
    super("Shop");
  }

  create(): void {
    this.message = "";
    this.root = this.add.container(0, 0);
    this.render();
  }

  private wares(): Ware[] {
    const { balls, items } = session.game.inventory;
    return [
      ...Object.values(CONTENT.balls).filter((b) => b.price).map((b) => ({
        id: b.id, name: b.name, price: b.price!, owned: balls[b.id] ?? 0, description: `Catch rate ×${b.multiplier}`,
      })),
      ...Object.values(PROGRESSION.items).map((i) => ({ id: i.id, name: i.name, price: i.price, owned: items[i.id] ?? 0, description: i.description })),
    ];
  }

  private render(): void {
    this.root.removeAll(true);
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => (this.root.add(o), o);
    add(this.add.text(16, 14, "Poké Mart", { fontFamily: FONT, fontSize: "20px", color: "#f5d76e" }));
    add(this.add.text(160, 20, `You have ₽${session.game.money}`, { fontFamily: FONT, fontSize: px(14), color: "#f5d76e" }));
    add(new Button(this, 794, 12, 150, 26, "➜ Leave", () => this.scene.start("Overworld", {})));
    this.wares().forEach((w, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = 16 + col * 468;
      const y = 52 + row * 62;
      add(this.add.rectangle(x, y, 460, 56, 0x1c2130).setOrigin(0).setStrokeStyle(1, 0x3a4560));
      add(new RichText(this, x + 10, y + 6, 300, 13)).setMarkup(`${tag("title", w.name)}  ${tag("num", `₽${w.price}`)}  ${tag("dim", `own ${w.owned}`)}\n${tag("dim", w.description)}`);
      const affordable = session.game.money >= w.price;
      add(new Button(this, x + 370, y + 14, 80, 28, "Buy", () => {
        try {
          session.update(buy(CONTENT, PROGRESSION, session.game, w.id));
          this.message = tag("good", `Bought ${w.name}.`);
        } catch (e) {
          this.message = tag("bad", e instanceof Error ? e.message : "Cannot buy that.");
        }
        this.render();
      }).setEnabled(affordable));
    });
    if (this.message) add(new RichText(this, 16, 512, 900, 13)).setMarkup(this.message);
    add(this.add.text(16, 490, "Held items are given to Pokémon in the Party screen. Potions are used there too.", { fontFamily: FONT, fontSize: px(11), color: COLORS.dim }));
  }
}
