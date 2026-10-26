import type Phaser from "phaser";
import { t } from "../i18n";
import { lockLandscape } from "../rotation";
import { Button } from "./Button";

/** Adds a fullscreen toggle when the browser allows it (it may not inside embedded viewers). */
export function addFullscreenButton(scene: Phaser.Scene, x: number, y: number, w: number): Button | null {
  if (!scene.scale.fullscreen.available) return null;
  const short = w < 200;
  const label = () => (scene.scale.isFullscreen ? (short ? t("⛶ Exit") : t("⛶ Exit fullscreen")) : (short ? t("⛶ Full") : t("⛶ Fullscreen")));
  const button = new Button(scene, x, y, w, 28, label(), () => {
    try {
      if (scene.scale.isFullscreen) scene.scale.stopFullscreen();
      else {
        scene.scale.startFullscreen();
        lockLandscape();
      }
    } catch {
      // Refused by the browser or the embedding page: the game keeps running windowed.
    }
  });
  scene.scale.on("enterfullscreen", () => button.active && button.setText(label()));
  scene.scale.on("leavefullscreen", () => button.active && button.setText(label()));
  return button;
}
