import Phaser from "phaser";

/**
 * Draws a shape once into a cached texture and shows it as an Image. A Graphics object re-tessellates every
 * path (rounded rectangles, polygons, slices) on every frame it is visible; an Image costs one quad. The canvas
 * renders at its logical 960×540, so a texture drawn at 1× is pixel-identical on screen.
 *
 * `draw` paints inside 0..w × 0..h; the key must name everything that changes the picture.
 */
export function baked(scene: Phaser.Scene, key: string, w: number, h: number, draw: (g: Phaser.GameObjects.Graphics) => void): Phaser.GameObjects.Image {
  const k = `baked:${key}`;
  if (!scene.textures.exists(k)) {
    const g = scene.make.graphics({}, false);
    draw(g);
    g.generateTexture(k, Math.ceil(w), Math.ceil(h));
    g.destroy();
  }
  return scene.add.image(0, 0, k).setOrigin(0);
}
