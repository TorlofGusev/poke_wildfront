import Phaser from "phaser";
import credits from "../../../CREDITS.md?raw";
import { DISCLAIMER } from "../../core/version";
import { Button } from "../ui/Button";
import { COLORS, FONT, px } from "../ui/theme";

/** Shows CREDITS.md (sprite artists, as the CC BY-NC licence requires) with wheel/drag scrolling. */
export class CreditsScene extends Phaser.Scene {
  constructor() {
    super("Credits");
  }

  create(): void {
    const { width, height } = this.scale;
    // Markdown table rows → "Artist — Pokémon" lines; prose lines are kept as they are.
    const lines = credits.split("\n").slice(1).flatMap((l) => {
      if (l.startsWith("|---") || l.startsWith("| Artist")) return [];
      if (l.startsWith("|")) {
        const [artist, contact, mons] = l.split("|").slice(1, 4).map((c) => c.trim());
        return [`${artist}${contact ? ` (${contact})` : ""}: ${mons}`];
      }
      return [l.replace(/^#+ /, "").replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)").replace(/[*`]/g, "")];
    });
    const body = this.add.text(24, 60, [...lines, "", DISCLAIMER].join("\n"), {
      fontFamily: FONT, fontSize: px(12), color: COLORS.text, wordWrap: { width: width - 48 }, lineSpacing: 3,
    });
    this.add.rectangle(0, 0, width, 52, 0x10141c).setOrigin(0).setDepth(1);
    this.add.text(24, 16, "Credits", { fontFamily: FONT, fontSize: "20px", color: "#f5d76e" }).setDepth(2);
    new Button(this, width - 174, 12, 150, 28, "← Back", () => this.scene.start("Title")).setDepth(2);

    const minY = Math.min(60, height - 20 - body.height);
    const scrollBy = (dy: number) => body.setY(Phaser.Math.Clamp(body.y - dy, minY, 60));
    this.input.on("wheel", (_p: unknown, _o: unknown, _dx: number, dy: number) => scrollBy(dy));
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => p.isDown && scrollBy(p.prevPosition.y - p.y));
  }
}
