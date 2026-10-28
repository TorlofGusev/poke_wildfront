import Phaser from "phaser";
import { preloadCries } from "../audio";
import { createSpriteAnims, preloadSprites } from "../sprites";
import { FONT } from "../ui/theme";

const TIPS = [
  "Only travelling tires your team. Camp anywhere to rest.",
  "A Pokémon knocked out three times is gone for good.",
  "Capture needs the target below half HP, and the ball is always used up.",
  "Push foes into rocks or other Pokémon for extra damage.",
  "Tall grass hides a Pokémon from attacks unless you stand next to it.",
  "Choose a focus at level 3, then one mastery in each row that opens.",
];

/** Loads the Pokémon sprites with a progress bar, then shows the title screen. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super("Boot");
  }

  preload(): void {
    performance.mark("wildfront:boot-start");
    // The game is running: the HTML loading screen can go.
    document.getElementById("loading")?.remove();

    const { width, height } = this.scale;
    this.add.text(width / 2, height / 2 - 70, "Pokémon Wildfront", { fontFamily: FONT, fontSize: "40px", color: "#f5d76e" }).setOrigin(0.5);
    const barW = 360;
    this.add.rectangle(width / 2, height / 2, barW + 6, 20, 0x10141c).setStrokeStyle(2, 0x5a6785);
    const bar = this.add.rectangle(width / 2 - barW / 2, height / 2, 0, 14, 0xf5d76e).setOrigin(0, 0.5);
    const label = this.add.text(width / 2, height / 2 + 26, "Loading Pokémon… 0%", { fontFamily: FONT, fontSize: "14px", color: "#c8d0e0" }).setOrigin(0.5);
    const tip = TIPS[Math.floor(Date.now() / 1000) % TIPS.length]!;
    this.add.text(width / 2, height / 2 + 80, `Tip: ${tip}`, {
      fontFamily: FONT, fontSize: "13px", color: "#8a93a6", align: "center", wordWrap: { width: 600 },
    }).setOrigin(0.5);
    this.load.on("progress", (p: number) => {
      bar.width = barW * p;
      label.setText(`Loading Pokémon… ${Math.round(p * 100)}%`);
    });
    preloadSprites(this);
    preloadCries(this);
  }

  create(): void {
    performance.mark("wildfront:assets-loaded");
    createSpriteAnims(this);
    performance.mark("wildfront:anims-ready");
    this.scene.start("Title");
  }
}
