import Phaser from "phaser";
import { setupAudio } from "./audio";
import { setupRotation } from "./rotation";
import { BattleScene } from "./scenes/BattleScene";
import { BootScene } from "./scenes/BootScene";
import { CreditsScene } from "./scenes/CreditsScene";
import { InventoryScene } from "./scenes/InventoryScene";
import { PartyScene } from "./scenes/PartyScene";
import { PokemonScene } from "./scenes/PokemonScene";
import { ShopScene } from "./scenes/ShopScene";
import { StarterScene } from "./scenes/StarterScene";
import { OverworldScene } from "./scenes/OverworldScene";
import { TitleScene } from "./scenes/TitleScene";
import { HexLabScene } from "./scenes/HexLabScene";

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
  scene: [BootScene, TitleScene, StarterScene, OverworldScene, PartyScene, PokemonScene, ShopScene, InventoryScene, BattleScene, CreditsScene, HexLabScene],
});
setupRotation(game);
setupAudio(game);
// For e2e scripts: lets them read scene state (e.g. enemy positions).
(window as unknown as { __game: Phaser.Game }).__game = game;
