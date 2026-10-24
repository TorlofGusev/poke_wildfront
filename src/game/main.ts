import Phaser from "phaser";
import { BattleScene } from "./scenes/BattleScene";
import { CampScene } from "./scenes/CampScene";
import { OverworldScene } from "./scenes/OverworldScene";
import { TitleScene } from "./scenes/TitleScene";

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  backgroundColor: "#10141c",
  pixelArt: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 960,
    height: 540,
  },
  scene: [TitleScene, OverworldScene, CampScene, BattleScene],
});
