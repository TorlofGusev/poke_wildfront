import Phaser from "phaser";
import { sfx } from "../audio";
import { hasPixGlyph, pixText } from "./pixelFont";
import { FONT } from "./theme";

const EDGE = 0x0b0e14;
const GOLD = 0xf5d76e;
const LABEL = "#e8ecf4";
const LABEL_OFF = "#5a6378";
const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;

/**
 * A text button drawn like the handhelds' menus: a dark edge, a lit top rim and a shaded foot over a soft drop
 * shadow. It rises a pixel on hover and sinks when pressed. A leading symbol (📖, ★, ◀ …) is drawn as a pixel icon,
 * so it looks the same on every system; a label too long for the button (a longer translation) steps down in size.
 */
export class Button extends Phaser.GameObjects.Container {
  private readonly face: Phaser.GameObjects.Container;
  private readonly bg: Phaser.GameObjects.Rectangle;
  private readonly shine: Phaser.GameObjects.Rectangle;
  private readonly shade: Phaser.GameObjects.Rectangle;
  private readonly label: Phaser.GameObjects.Text;
  private icon: Phaser.GameObjects.BitmapText | null = null;
  private enabled = true;
  private centered = false;
  /** Fill when enabled and on hover (a type colour can replace the default slate). */
  private fill = 0x2a3245;
  private hoverFill = 0x3a4560;
  private labelColor = LABEL;

  constructor(scene: Phaser.Scene, x: number, y: number, w: number, h: number, text: string, onClick: () => void) {
    super(scene, x, y);
    const shadow = scene.add.rectangle(0, 2, w, h, 0x000000, 0.35).setOrigin(0);
    this.bg = scene.add.rectangle(0, 0, w, h, this.fill).setOrigin(0).setStrokeStyle(1, EDGE);
    this.shine = scene.add.rectangle(1, 1, w - 2, 1, 0xffffff, 0.14).setOrigin(0);
    this.shade = scene.add.rectangle(1, h - 3, w - 2, 2, 0x000000, 0.28).setOrigin(0);
    this.label = scene.add.text(8, h / 2, "", { fontFamily: FONT, fontSize: "14px", color: LABEL }).setOrigin(0, 0.5);
    this.face = scene.add.container(0, 0, [this.bg, this.shine, this.shade, this.label]);
    this.add([shadow, this.face]);
    this.setSize(w, h);
    this.setText(text);
    this.bg.setInteractive({ useHandCursor: true });
    const rest = () => this.face.setY(0);
    this.bg.on("pointerover", () => {
      if (!this.enabled) return;
      this.bg.setFillStyle(this.hoverFill);
      this.face.setY(-1);
    });
    this.bg.on("pointerout", () => {
      this.bg.setFillStyle(this.enabled ? this.fill : 0x1c2130);
      rest();
    });
    this.bg.on("pointerup", () => this.enabled && this.face.setY(-1));
    this.bg.on("pointerdown", () => {
      if (!this.enabled) return;
      this.face.setY(1);
      sfx(scene, "select");
      onClick();
    });
    scene.add.existing(this);
  }

  /** Called with true on hover and false when the pointer leaves. */
  onHover(cb: (over: boolean) => void): this {
    this.bg.on("pointerover", () => cb(true));
    this.bg.on("pointerout", () => cb(false));
    return this;
  }

  /** Marks the button with a colour: a stripe on the left and a tinted label (e.g. a move's type). */
  setAccent(color: number): this {
    this.face.addAt(this.scene.add.rectangle(0, 0, 4, this.height, color).setOrigin(0), 1);
    this.labelColor = hex(color);
    return this.paintLabel();
  }

  /** Fills the button with a dark shade of a colour (e.g. a move's type), lighter on hover. */
  setFill(color: number): this {
    const shade = (k: number) => Phaser.Display.Color.GetColor(((color >> 16) & 255) * k, ((color >> 8) & 255) * k, (color & 255) * k);
    this.fill = shade(0.38);
    this.hoverFill = shade(0.55);
    if (this.enabled) this.bg.setFillStyle(this.fill);
    return this;
  }

  /** Centres the label (and its icon) in the button. */
  centerLabel(): this {
    this.centered = true;
    this.place();
    return this;
  }

  setText(text: string): this {
    // A leading symbol the pixel font draws becomes the icon; the words stay text.
    const [first = "", ...rest] = [...text.replace(/️/g, "")];
    const iconChar = hasPixGlyph(first) ? first : "";
    const words = iconChar ? rest.join("").trimStart() : text;
    this.icon?.destroy();
    this.icon = iconChar ? pixText(this.scene, 0, this.height / 2, iconChar, 0xffffff, 2).setOrigin(0, 0.5) : null;
    if (this.icon) this.face.add(this.icon);
    this.label.setText(words);
    this.fit();
    this.paintLabel();
    return this.place();
  }

  setEnabled(enabled: boolean): this {
    this.enabled = enabled;
    this.bg.setFillStyle(enabled ? this.fill : 0x1c2130);
    this.shine.setVisible(enabled);
    if (!enabled) this.face.setY(0);
    return this.paintLabel();
  }

  /** A bright, solid fill with a bold white label: the call to action. */
  setSolid(color: number): this {
    const lift = (k: number) => Phaser.Display.Color.GetColor(
      Math.min(255, ((color >> 16) & 255) * k), Math.min(255, ((color >> 8) & 255) * k), Math.min(255, (color & 255) * k));
    this.fill = color;
    this.hoverFill = lift(1.2);
    this.label.setFontStyle("bold").setStroke("#10141c", 3);
    this.labelColor = "#ffffff";
    this.shine.setFillStyle(0xffffff, 0.35);
    if (this.enabled) this.bg.setFillStyle(this.fill).setStrokeStyle(2, 0xffffff);
    this.fit();
    this.place();
    return this.paintLabel();
  }

  /** A gold frame: the chosen tab, option or the one to take. */
  setHighlighted(on: boolean): this {
    this.bg.setStrokeStyle(on ? 2 : 1, on ? GOLD : EDGE);
    return this;
  }

  private paintLabel(): this {
    const color = this.enabled ? this.labelColor : LABEL_OFF;
    this.label.setColor(color);
    this.icon?.setTint(Phaser.Display.Color.HexStringToColor(color).color);
    return this;
  }

  /** Icon then words, at the left (8 px in) or centred. */
  private place(): this {
    const gap = this.icon && this.label.text ? 6 : 0;
    const iconW = this.icon ? this.icon.width : 0;
    const total = iconW + gap + this.label.displayWidth;
    const x0 = this.centered ? Math.round((this.width - total) / 2) : 8;
    this.icon?.setX(x0);
    this.label.setX(x0 + iconW + gap);
    return this;
  }

  /** A label too long for the button steps its size down, then is cut at the edge. */
  private fit(): void {
    const room = this.width - 12 - (this.icon ? this.icon.width + 6 : 0);
    for (let size = 14; size >= 11; size--) {
      this.label.setFontSize(size);
      if (this.label.width <= room) return void this.label.setCrop();
    }
    this.label.setCrop(0, 0, room, this.height);
  }
}
