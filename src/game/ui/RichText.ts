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

  private lastMarkup: string | null = null;
  private lastHeight = 0;

  /**
   * Replaces the content. Returns the rendered height in pixels. Markup tokens must not span lines.
   * Each same-coloured run on a line is one Text object (every Text is its own GPU texture, so fewer
   * is much faster on phones), and unchanged markup is not rebuilt at all.
   */
  setMarkup(markup: string): number {
    if (markup === this.lastMarkup) return this.lastHeight;
    this.lastMarkup = markup;
    this.removeAll(true);
    let cx = 0;
    let cy = 0;
    // The run being collected: words of one colour on the current line.
    let run = "";
    let runX = 0;
    let runColor = this.baseColor;
    const flush = () => {
      if (run) this.add(this.scene.add.text(runX, cy, run, this.style(runColor)));
      run = "";
    };
    const newline = () => {
      flush();
      cx = 0;
      cy += this.lineHeight;
    };
    for (const [i, line] of markup.split("\n").entries()) {
      if (i > 0) newline();
      for (const seg of parseMarkup(line)) {
        const { color, background } = seg.key ? markupStyle(seg.key) : { color: this.baseColor, background: undefined };
        if (background) {
          // Chips never wrap internally; leave a small gap around them.
          flush();
          const chip = this.scene.add.text(0, cy, seg.text, this.style(color, background));
          if (cx > 0 && cx + chip.width > this.wrapWidth) newline();
          chip.setPosition(cx, cy);
          this.add(chip);
          cx += chip.width + 1;
          continue;
        }
        if (color !== runColor) flush();
        runColor = color;
        // Split into words (keeping spaces) so long segments wrap.
        for (const word of seg.text.split(/(?<= )/)) {
          const w = this.textWidth(word);
          if (cx > 0 && cx + w > this.wrapWidth && word.trim()) newline();
          const piece = cx === 0 ? word.trimStart() : word;
          if (!run) runX = cx;
          run += piece;
          cx += cx === 0 ? this.textWidth(piece) : w;
        }
      }
    }
    flush();
    this.lastHeight = markup ? cy + this.lineHeight : 0;
    return this.lastHeight;
  }

  override destroy(fromScene?: boolean): void {
    this.measure.destroy();
    super.destroy(fromScene);
  }
}
