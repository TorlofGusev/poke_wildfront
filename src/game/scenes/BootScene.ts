import Phaser from "phaser";
import { createSpriteAnims, preloadSprites } from "../sprites";
import { FONT } from "../ui/theme";

/** Loads the Pokémon sprites, then shows the title screen. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super("Boot");
  }

  preload(): void {
    const { width, height } = this.scale;
    const label = this.add.text(width / 2, height / 2, "Loading…", { fontFamily: FONT, fontSize: "18px", color: "#c8d0e0" }).setOrigin(0.5);
    this.load.on("progress", (p: number) => label.setText(`Loading… ${Math.round(p * 100)}%`));
    preloadSprites(this);
  }

  create(): void {
    createSpriteAnims(this);
    this.scene.start("Title");
  }
}
