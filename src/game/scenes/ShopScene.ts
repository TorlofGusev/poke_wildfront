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
  readonly category: string;
  readonly name: string;
  readonly price: number;
  readonly description: string;
  readonly owned: number;
}

const CATEGORY: Record<string, string> = { potion: "Healing", food: "Food", candy: "Candy", held: "Held items" };
const TABS = ["Balls", "Healing", "Food", "Held items", "Candy"];
const LIST_TOP = 86;
const LIST_BOTTOM = 480;

/** Poké Mart: buy balls, potions and held items with Pokédollars. */
export class ShopScene extends Phaser.Scene {
  private root!: Phaser.GameObjects.Container;
  private message = "";
  private tab = TABS[0]!;
  private scroll = 0;

  constructor() {
    super("Shop");
  }

  create(): void {
    this.message = "";
    this.scroll = 0;
    this.root = this.add.container(0, 0);
    this.input.on("wheel", (_p: unknown, _o: unknown, _dx: number, dy: number) => this.scrollBy(dy));
    this.render();
  }

  private wares(): Ware[] {
    const { balls, items } = session.game.inventory;
    return [
      ...Object.values(CONTENT.balls).filter((b) => b.price).map((b) => ({
        id: b.id, category: "Balls", name: b.name, price: b.price!, owned: balls[b.id] ?? 0, description: `Catch rate ×${b.multiplier}`,
      })),
      ...Object.values(PROGRESSION.items).map((i) => ({ id: i.id, category: CATEGORY[i.kind] ?? "Other", name: i.name, price: i.price, owned: items[i.id] ?? 0, description: i.description })),
    ];
  }

  private scrollBy(dy: number): void {
    this.scroll = Math.max(0, this.scroll + dy);
    this.render();
  }

  private render(): void {
    this.root.removeAll(true);
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => (this.root.add(o), o);
    add(this.add.text(16, 14, "Poké Mart", { fontFamily: FONT, fontSize: "20px", color: "#f5d76e" }));
    add(this.add.text(160, 20, `You have ₽${session.game.money}`, { fontFamily: FONT, fontSize: px(14), color: "#f5d76e" }));
    add(new Button(this, 794, 12, 150, 26, "➜ Leave", () => this.scene.start("Overworld", {})));
    TABS.forEach((t, i) => add(new Button(this, 16 + i * 128, 50, 120, 26, t, () => {
      this.tab = t;
      this.scroll = 0;
      this.render();
    }).setHighlighted(this.tab === t)));
    const wares = this.wares().filter((w) => w.category === this.tab);
    const rows = Math.ceil(wares.length / 2);
    const maxScroll = Math.max(0, rows * 62 - (LIST_BOTTOM - LIST_TOP));
    this.scroll = Math.min(this.scroll, maxScroll);
    const list = add(this.add.container(0, -this.scroll));
    const mask = this.make.graphics({}).fillRect(0, LIST_TOP, 960, LIST_BOTTOM - LIST_TOP).createGeometryMask();
    list.setMask(mask);
    wares.forEach((w, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = 16 + col * 468;
      const y = LIST_TOP + row * 62;
      list.add(this.add.rectangle(x, y, 460, 56, 0x1c2130).setOrigin(0).setStrokeStyle(1, 0x3a4560));
      const info = new RichText(this, x + 10, y + 6, 340, 13);
      list.add(info);
      info.setMarkup(`${tag("title", w.name)}  ${tag("num", `₽${w.price}`)}  ${tag("dim", `own ${w.owned}`)}\n${tag("dim", w.description)}`);
      const affordable = session.game.money >= w.price;
      list.add(new Button(this, x + 370, y + 14, 80, 28, "Buy", () => {
        try {
          session.update(buy(CONTENT, PROGRESSION, session.game, w.id));
          this.message = tag("good", `Bought ${w.name}.`);
        } catch (e) {
          this.message = tag("bad", e instanceof Error ? e.message : "Cannot buy that.");
        }
        this.render();
      }).setEnabled(affordable));
    });
    if (maxScroll > 0) {
      add(new Button(this, 900, LIST_TOP, 44, 28, "▲", () => this.scrollBy(-124)).setEnabled(this.scroll > 0));
      add(new Button(this, 900, LIST_BOTTOM - 28, 44, 28, "▼", () => this.scrollBy(124)).setEnabled(this.scroll < maxScroll));
    }
    if (this.message) add(new RichText(this, 16, 512, 900, 13)).setMarkup(this.message);
    add(this.add.text(16, 490, "Held items are given to Pokémon in the Party screen. Potions are used there too.", { fontFamily: FONT, fontSize: px(11), color: COLORS.dim }));
  }
}
