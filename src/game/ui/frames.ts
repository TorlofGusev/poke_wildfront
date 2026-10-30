import Phaser from "phaser";
import { pixText } from "./pixelFont";

/** A screen's title in the pixel font, gold, at 3× (the menus' counterpart of the battle's banners). */
export function screenTitle(scene: Phaser.Scene, x: number, y: number, text: string): Phaser.GameObjects.BitmapText {
  return pixText(scene, x, y - 4, text, 0xf5d76e, 3);
}

export interface PanelLook {
  /** Body colour. */
  readonly fill?: number;
  /** Outline: the default dark edge, or a colour (gold for "waiting", red for danger). */
  readonly edge?: number;
  readonly edgeWidth?: number;
}

/**
 * A framed panel like the battle's cards: a soft drop shadow, a dark edge, a lit top rim and a shaded foot. Plain
 * rectangles (cheap to draw and to rebuild); returned as a container at (x, y) with the body as its first child.
 */
export function panel(scene: Phaser.Scene, x: number, y: number, w: number, h: number, look: PanelLook = {}): Phaser.GameObjects.Container {
  const body = scene.add.rectangle(0, 0, w, h, look.fill ?? 0x1c2130).setOrigin(0).setStrokeStyle(look.edgeWidth ?? 1, look.edge ?? 0x0b0e14);
  return scene.add.container(x, y, [
    scene.add.rectangle(0, 3, w, h, 0x000000, 0.3).setOrigin(0),
    body,
    scene.add.rectangle(2, 2, w - 4, 1, 0xffffff, 0.08).setOrigin(0),
    scene.add.rectangle(2, h - 4, w - 4, 2, 0x000000, 0.22).setOrigin(0),
  ]);
}
