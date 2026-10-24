import Phaser from "phaser";
import { parseMarkup } from "./markup";
import { FONT, markupColor } from "./theme";

/** Multi-colour, word-wrapped text built from `{key|text}` markup. */
export class RichText extends Phaser.GameObjects.Container {
  private readonly measure: Phaser.GameObjects.Text;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    private readonly wrapWidth: number,
    private readonly fontSize = 12,
    private readonly baseColor = "#e8ecf4",
    private readonly lineHeight = fontSize + 4,
  ) {
    super(scene, x, y);
    this.measure = scene.make.text({ text: "", style: this.style("#000") }, false);
    scene.add.existing(this);
  }

  private style(color: string): Phaser.Types.GameObjects.Text.TextStyle {
    return { fontFamily: FONT, fontSize: `${this.fontSize}px`, color };
  }

  private textWidth(s: string): number {
    return this.measure.setText(s).width;
  }

  /** Replaces the content. Returns the rendered height in pixels. */
  setMarkup(markup: string): number {
    this.removeAll(true);
    let cx = 0;
    let cy = 0;
    for (const [i, line] of markup.split("\n").entries()) {
      if (i > 0) {
        cx = 0;
        cy += this.lineHeight;
      }
      for (const seg of parseMarkup(line)) {
        const color = seg.key ? markupColor(seg.key) : this.baseColor;
        // Split into words (keeping spaces) so long segments wrap.
        for (const word of seg.text.split(/(?<= )/)) {
          const w = this.textWidth(word);
          if (cx > 0 && cx + w > this.wrapWidth && word.trim()) {
            cx = 0;
            cy += this.lineHeight;
          }
          const t = this.scene.add.text(cx, cy, cx === 0 ? word.trimStart() : word, this.style(color));
          this.add(t);
          cx += cx === 0 ? this.textWidth(word.trimStart()) : w;
        }
      }
    }
    return markup ? cy + this.lineHeight : 0;
  }

  override destroy(fromScene?: boolean): void {
    this.measure.destroy();
    super.destroy(fromScene);
  }
}
