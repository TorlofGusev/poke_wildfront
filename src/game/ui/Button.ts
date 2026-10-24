import Phaser from "phaser";
import { FONT } from "./theme";

/** Minimal text button with enabled/disabled state. */
export class Button extends Phaser.GameObjects.Container {
  private readonly bg: Phaser.GameObjects.Rectangle;
  private readonly label: Phaser.GameObjects.Text;
  private enabled = true;

  constructor(scene: Phaser.Scene, x: number, y: number, w: number, h: number, text: string, onClick: () => void) {
    super(scene, x, y);
    this.bg = scene.add.rectangle(0, 0, w, h, 0x2a3245).setOrigin(0).setStrokeStyle(1, 0x5a6785);
    this.label = scene.add.text(8, h / 2, text, { fontFamily: FONT, fontSize: "14px", color: "#e8ecf4" }).setOrigin(0, 0.5);
    this.add([this.bg, this.label]);
    this.setSize(w, h);
    this.bg.setInteractive({ useHandCursor: true });
    this.bg.on("pointerover", () => this.enabled && this.bg.setFillStyle(0x3a4560));
    this.bg.on("pointerout", () => this.bg.setFillStyle(this.enabled ? 0x2a3245 : 0x1c2130));
    this.bg.on("pointerdown", () => this.enabled && onClick());
    scene.add.existing(this);
  }

  /** Called with true on hover and false when the pointer leaves. */
  onHover(cb: (over: boolean) => void): this {
    this.bg.on("pointerover", () => cb(true));
    this.bg.on("pointerout", () => cb(false));
    return this;
  }

  setText(text: string): this {
    this.label.setText(text);
    return this;
  }

  setEnabled(enabled: boolean): this {
    this.enabled = enabled;
    this.bg.setFillStyle(enabled ? 0x2a3245 : 0x1c2130);
    this.label.setColor(enabled ? "#e8ecf4" : "#5a6378");
    return this;
  }

  setHighlighted(on: boolean): this {
    this.bg.setStrokeStyle(on ? 2 : 1, on ? 0xf5d76e : 0x5a6785);
    return this;
  }
}
