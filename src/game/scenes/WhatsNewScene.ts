import Phaser from "phaser";
import { playMusic } from "../music";
import { WHATS_NEW } from "../../content";
import { textPage } from "../ui/textPage";
import { t } from "../i18n";

/** The player-facing changelog (content/whatsNew.json), newest first, in one scrolling reading column. */
export class WhatsNewScene extends Phaser.Scene {
  constructor() {
    super("WhatsNew");
  }

  create(): void {
    // Screens fade in from the background colour instead of cutting.
    this.cameras.main.fadeIn(160, 16, 20, 28);
    playMusic(this, "title");
    textPage(this, t("What's new"), WHATS_NEW.map((v) => ({ heading: `v${v.version}`, note: v.date, paragraphs: v.items, bullets: true })),
      () => this.scene.start("Title"));
  }
}
