import Phaser from "phaser";
import { CONTENT } from "../../content";
import { playCry } from "../audio";
import { animKey, footOrigin, hasSprite, portraitKey } from "../sprites";
import { baked } from "./bake";
import { TYPE_COLORS } from "./theme";

/** Mixes colour `c` towards `to` by `k` (0–1). */
const mix = (c: number, to: number, k: number): number => {
  const ch = (sh: number) => Math.round(((c >> sh) & 255) * (1 - k) + ((to >> sh) & 255) * k);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};

/**
 * A Pokémon on its own little stage: a backdrop fading from its type's colour into the dark, a lit floor with its
 * shadow, and the Pokémon in its idle animation at a whole-number scale (tap it for its cry and a hop). Used by the
 * summary, the Pokédex and the starter choice. `add` puts each part where the caller keeps them.
 */
export function pokemonStage(scene: Phaser.Scene, x: number, y: number, w: number, h: number, speciesId: string,
  add: <T extends Phaser.GameObjects.GameObject>(o: T) => T = (o) => o, big = false): void {
  const s = CONTENT.species[speciesId]!;
  const base = TYPE_COLORS[s.types[0]!] ?? 0x888888;
  add(baked(scene, `stage:${base}:${w}x${h}`, w, h, (g) => {
    g.fillStyle(0x0b0e14, 1).fillRoundedRect(0, 0, w, h, 6);
    g.fillGradientStyle(mix(base, 0x10141c, 0.35), mix(base, 0x10141c, 0.35), mix(base, 0x10141c, 0.85), mix(base, 0x10141c, 0.85), 1);
    g.fillRect(2, 2, w - 4, h - 4);
    // The floor: a lit oval with a rim, the light falling on it from above.
    g.fillStyle(mix(base, 0xffffff, 0.25), 0.22).fillEllipse(w / 2, h - 16, w * 0.75, 22);
    g.lineStyle(2, mix(base, 0xffffff, 0.45), 0.5).strokeEllipse(w / 2, h - 16, w * 0.75, 22);
    g.fillStyle(0xffffff, 0.06).fillTriangle(w / 2 - 18, 2, w / 2 + 18, 2, w / 2 + w * 0.36, h - 16).fillTriangle(w / 2 - 18, 2, w / 2 - w * 0.36, h - 16, w / 2 + w * 0.36, h - 16);
    g.lineStyle(2, mix(base, 0x000000, 0.45), 1).strokeRoundedRect(1, 1, w - 2, h - 2, 6);
  }).setPosition(x, y));
  add(scene.add.ellipse(x + w / 2, y + h - 16, 54, 10, 0x000000, 0.4));
  let body: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image | null = null;
  if (hasSprite(speciesId)) {
    const spr = scene.add.sprite(x + w / 2, y + h - 15, `${speciesId}-idle`).play(animKey(speciesId, "idle", 0));
    const small = spr.frame.height <= 40;
    spr.setOrigin(0.5, footOrigin(scene, speciesId)).setScale(big ? (small ? 4 : 3) : small ? 3 : 2);
    body = add(spr);
  } else if (scene.textures.exists(portraitKey(speciesId))) {
    body = add(scene.add.image(x + w / 2, y + h / 2, portraitKey(speciesId)).setDisplaySize(64, 64));
  }
  if (!body) return;
  const at = body.y;
  const hit = add(scene.add.rectangle(x, y, w, h, 0xffffff, 0.001).setOrigin(0).setInteractive({ useHandCursor: true }));
  hit.on("pointerdown", () => {
    playCry(scene, speciesId);
    scene.tweens.add({ targets: body, y: at - 10, duration: 120, yoyo: true, ease: "Quad.easeOut" });
  });
}
