import Phaser from "phaser";
import { px } from "../ui/theme";
import { DISCLAIMER, GAME_VERSION } from "../../core/version";
import { session } from "../session";
import { Button } from "../ui/Button";
import { addFullscreenButton } from "../ui/fullscreen";

export class TitleScene extends Phaser.Scene {
  private confirmNew = false;

  constructor() {
    super("Title");
  }

  create(): void {
    this.confirmNew = false;
    const { width, height } = this.scale;
    this.add
      .text(width / 2, height / 2 - 110, "Pokémon Wildfront", { fontFamily: "monospace", fontSize: "48px", color: "#f5d76e" })
      .setOrigin(0.5);
    this.add
      .text(width / 2, height / 2 - 60, "Tactical prototype", { fontFamily: "monospace", fontSize: "18px", color: "#c8d0e0" })
      .setOrigin(0.5);

    const hasSave = session.hasSave() && session.load();
    let y = height / 2 - 10;
    if (hasSave) {
      new Button(this, width / 2 - 140, y, 280, 32, "▶ Continue", () => this.scene.start("Overworld"));
      y += 42;
    }
    const newButton = new Button(this, width / 2 - 140, y, 280, 32, "✦ New game", () => {
      if (hasSave && !this.confirmNew) {
        this.confirmNew = true;
        newButton.setText("✦ New game: click again to overwrite");
        return;
      }
      session.start();
      this.scene.start("Overworld");
    });
    y += 42;
    if (addFullscreenButton(this, width / 2 - 140, y, 280)) y += 42;
    if (session.loadError) {
      this.add
        .text(width / 2, y + 10, `Your save could not be loaded (${session.loadError}).`, {
          fontFamily: "monospace", fontSize: px(12), color: "#ff6b6b",
        })
        .setOrigin(0.5);
    }

    this.add
      .text(width / 2, height - 30, `v${GAME_VERSION} · ${DISCLAIMER}`, {
        fontFamily: "monospace", fontSize: px(11), color: "#7a8499", align: "center", wordWrap: { width: width - 40 },
      })
      .setOrigin(0.5);
  }
}
