import Phaser from "phaser";
import { Button } from "./Button";
import { screenTitle } from "./frames";
import { tag } from "./markup";
import { pixText } from "./pixelFont";
import { RichText } from "./RichText";
import { scrollArea } from "./scrollArea";
import { t } from "../i18n";

/** One section of a text page: a pixel heading (and a dim note beside it) over its paragraphs. */
export interface TextSection {
  readonly heading?: string;
  readonly note?: string;
  /** Paragraphs in markup; bulleted ones hang from a dot. */
  readonly paragraphs: readonly string[];
  readonly bullets?: boolean;
  /** The gap after each paragraph (a list of short rows sits tighter than prose). */
  readonly gap?: number;
}

/** The reading column: narrow enough that a line can be followed across. */
const COLUMN_W = 620;
const BAR_H = 52;

/**
 * A screen of reading (What's new, Credits): the title and a Back button on a fixed bar, the sections in one centred
 * column that scrolls with the wheel, by dragging and by its bar.
 */
export function textPage(scene: Phaser.Scene, title: string, sections: readonly TextSection[], back: () => void): void {
  const { width, height } = scene.scale;
  const x = Math.round((width - COLUMN_W) / 2);
  scrollArea(scene, 0, BAR_H + 1, width, height - BAR_H - 1, () => {
    let y = BAR_H + 18;
    for (const s of sections) {
      if (s.heading) {
        const head = pixText(scene, x, y, s.heading, 0xf5d76e, 2);
        if (s.note) new RichText(scene, x + head.width + 12, y + 1, COLUMN_W - head.width - 12, 12).setMarkup(tag("dim", s.note));
        y += 28;
      }
      for (const p of s.paragraphs) {
        if (s.bullets) scene.add.rectangle(x + 4, y + 9, 4, 4, 0xf5d76e);
        y += new RichText(scene, s.bullets ? x + 16 : x, y, s.bullets ? COLUMN_W - 16 : COLUMN_W, 13).setMarkup(p) + (s.gap ?? 10);
      }
      y += 20;
    }
    return y;
  });
  scene.add.rectangle(0, 0, width, BAR_H, 0x10141c).setOrigin(0);
  scene.add.rectangle(0, BAR_H, width, 1, 0x2a3245).setOrigin(0);
  screenTitle(scene, 24, 16, title);
  new Button(scene, width - 174, 12, 150, 28, t("← Back"), back).centerLabel();
}
