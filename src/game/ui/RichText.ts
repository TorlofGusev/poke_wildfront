import Phaser from "phaser";
import { parseMarkup } from "./markup";
import { FONT, fs, markupStyle } from "./theme";

/** Multi-colour, word-wrapped text built from `{key|text}` markup. */
export class RichText extends Phaser.GameObjects.Container {
  private readonly fontSize: number;
  private readonly lineHeight: number;
  private readonly measure: Phaser.GameObjects.Text;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    private readonly wrapWidth: number,
    fontSize = 12,
    private readonly baseColor = "#e8ecf4",
    lineHeight = fontSize + 4,
  ) {
    super(scene, x, y);
    this.fontSize = fs(fontSize);
    this.lineHeight = lineHeight + (this.fontSize - fontSize);
    this.measure = scene.make.text({ text: "", style: this.style("#000") }, false);
    scene.add.existing(this);
  }

  private style(color: string, background?: string): Phaser.Types.GameObjects.Text.TextStyle {
    return {
      fontFamily: FONT, fontSize: `${this.fontSize}px`, color,
      ...(background && { backgroundColor: background, padding: { x: 3, y: 0 } }),
    };
  }

  private textWidth(s: string): number {
    return this.measure.setText(s).width;
  }

  /** Replaces the content. Returns the rendered height in pixels. Markup tokens must not span lines. */
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
        const { color, background } = seg.key ? markupStyle(seg.key) : { color: this.baseColor, background: undefined };
        if (background) {
          // Chips never wrap internally; leave a small gap around them.
          const chip = this.scene.add.text(0, cy, seg.text, this.style(color, background));
          if (cx > 0 && cx + chip.width > this.wrapWidth) {
            cx = 0;
            cy += this.lineHeight;
            chip.y = cy;
          }
          chip.x = cx;
          this.add(chip);
          cx += chip.width + 1;
          continue;
        }
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
