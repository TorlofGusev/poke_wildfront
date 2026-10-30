import Phaser from "phaser";
import { playMusic } from "../music";
import { WHATS_NEW } from "../../content";
import { Button } from "../ui/Button";
import { RichText } from "../ui/RichText";
import { tag } from "../ui/markup";
import { FONT } from "../ui/theme";
import { t } from "../i18n";
import { screenTitle } from "../ui/frames";

/** The player-facing changelog (content/whatsNew.json), newest first, with wheel/drag scrolling. */
export class WhatsNewScene extends Phaser.Scene {
  constructor() {
    super("WhatsNew");
  }

  create(): void {
    // Screens fade in from the background colour instead of cutting.
    this.cameras.main.fadeIn(160, 16, 20, 28);
    playMusic(this, "title");
    const { width, height } = this.scale;
    const markup = WHATS_NEW.map((v) => [`${tag("title", `v${v.version}`)}  ${tag("dim", v.date)}`, ...v.items.map((i) => `• ${i}`)].join("\n")).join("\n\n");
    const body = new RichText(this, 24, 60, width - 48, 13);
    const bodyHeight = body.setMarkup(markup);
    this.add.rectangle(0, 0, width, 52, 0x10141c).setOrigin(0).setDepth(1);
    screenTitle(this, 24, 16, t("What's new")).setDepth(2);
    new Button(this, width - 174, 12, 150, 28, t("← Back"), () => this.scene.start("Title")).setDepth(2);

    const minY = Math.min(60, height - 20 - bodyHeight);
    const scrollBy = (dy: number) => body.setY(Phaser.Math.Clamp(body.y - dy, minY, 60));
    this.input.on("wheel", (_p: unknown, _o: unknown, _dx: number, dy: number) => scrollBy(dy));
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => p.isDown && scrollBy(p.prevPosition.y - p.y));
  }
}
