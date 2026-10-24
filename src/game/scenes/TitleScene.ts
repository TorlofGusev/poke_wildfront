import Phaser from "phaser";
import { DISCLAIMER, GAME_VERSION } from "../../core/version";

export class TitleScene extends Phaser.Scene {
  constructor() {
    super("Title");
  }

  create(): void {
    const { width, height } = this.scale;
    this.add
      .text(width / 2, height / 2 - 40, "Pokémon Wildfront", {
        fontFamily: "monospace",
        fontSize: "48px",
        color: "#f5d76e",
      })
      .setOrigin(0.5);
    this.add
      .text(width / 2, height / 2 + 20, "Tactical prototype — coming soon", {
        fontFamily: "monospace",
        fontSize: "20px",
        color: "#c8d0e0",
      })
      .setOrigin(0.5);
    this.add
      .text(width / 2, height - 30, `v${GAME_VERSION} · ${DISCLAIMER}`, {
        fontFamily: "monospace",
        fontSize: "11px",
        color: "#7a8499",
        align: "center",
        wordWrap: { width: width - 40 },
      })
      .setOrigin(0.5);
  }
}
