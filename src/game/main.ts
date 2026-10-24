import Phaser from "phaser";
import { setupRotation } from "./rotation";
import { BattleScene } from "./scenes/BattleScene";
import { BootScene } from "./scenes/BootScene";
import { CreditsScene } from "./scenes/CreditsScene";
import { PartyScene } from "./scenes/PartyScene";
import { PokemonScene } from "./scenes/PokemonScene";
import { ShopScene } from "./scenes/ShopScene";
import { OverworldScene } from "./scenes/OverworldScene";
import { TitleScene } from "./scenes/TitleScene";

const game = new Phaser.Game({
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
  scene: [BootScene, TitleScene, OverworldScene, PartyScene, PokemonScene, ShopScene, BattleScene, CreditsScene],
});
setupRotation(game);
