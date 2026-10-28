import { CONTENT } from "../content";
import { planTurn } from "../core/ai";
import type { BattleState } from "../core/battle";
import Phaser from "phaser";
import { setupAudio } from "./audio";
import { setupRotation } from "./rotation";
import { BattleScene } from "./scenes/BattleScene";
import { BootScene } from "./scenes/BootScene";
import { CreditsScene } from "./scenes/CreditsScene";
import { InventoryScene } from "./scenes/InventoryScene";
import { PartyScene } from "./scenes/PartyScene";
import { PokedexScene } from "./scenes/PokedexScene";
import { PokemonScene } from "./scenes/PokemonScene";
import { ShopScene } from "./scenes/ShopScene";
import { StarterScene } from "./scenes/StarterScene";
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
  scene: [BootScene, TitleScene, StarterScene, OverworldScene, PartyScene, PokemonScene, PokedexScene, ShopScene, InventoryScene, BattleScene, CreditsScene],
});
setupRotation(game);
setupAudio(game);
// For e2e scripts: lets them read scene state (e.g. enemy positions).
(window as unknown as { __game: Phaser.Game }).__game = game;
// For promo recordings: the AI can plan the player's turns, which the script then shows being aimed.
(window as unknown as { __ai: object }).__ai = { planTurn: (state: BattleState) => planTurn(state, CONTENT) };
