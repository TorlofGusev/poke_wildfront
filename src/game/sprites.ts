import Phaser from "phaser";
import spriteMeta from "../content/sprites.json";

/**
 * PMDCollab sprite sheets, packed by tools/pack-sprites.py to 4 rows (down, right, up, left),
 * frames left to right. Durations are in 1/60 s ticks.
 */
interface AnimMeta {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly durations: readonly number[];
}
interface SpeciesSprites {
  readonly dex: number;
  readonly idle: AnimMeta;
  readonly walk: AnimMeta;
}

const META = spriteMeta as Record<string, SpeciesSprites>;
const FILES = import.meta.glob("../assets/sprites/*.png", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const url = (dex: number, kind: string) => FILES[`../assets/sprites/${String(dex).padStart(4, "0")}-${kind}.png`];

export type SpriteAnim = "idle" | "walk";
/** Sheet rows: down, right, up, left. */
export type Facing = 0 | 1 | 2 | 3;
export const FACE_RIGHT: Facing = 1;
export const FACE_LEFT: Facing = 3;

export const hasSprite = (speciesId: string): boolean => Boolean(META[speciesId] && url(META[speciesId]!.dex, "idle"));
export const portraitKey = (speciesId: string) => `${speciesId}-portrait`;
export const animKey = (speciesId: string, anim: SpriteAnim, facing: Facing) => `${speciesId}-${anim}-${facing}`;

export function preloadSprites(scene: Phaser.Scene): void {
  for (const [id, m] of Object.entries(META)) {
    for (const anim of ["idle", "walk"] as const) {
      const file = url(m.dex, anim);
      if (file) scene.load.spritesheet(`${id}-${anim}`, file, { frameWidth: m[anim].frameWidth, frameHeight: m[anim].frameHeight });
    }
    const portrait = url(m.dex, "portrait");
    if (portrait) scene.load.image(portraitKey(id), portrait);
  }
}

/** Registers one animation per species, animation and facing. Call once after loading. */
export function createSpriteAnims(scene: Phaser.Scene): void {
  for (const [id, m] of Object.entries(META)) {
    for (const anim of ["idle", "walk"] as const) {
      const tex = `${id}-${anim}`;
      if (!scene.textures.exists(tex)) continue;
      const cols = m[anim].durations.length;
      const rows = Math.max(1, Math.floor(scene.textures.get(tex).getSourceImage().height / m[anim].frameHeight));
      for (let facing = 0; facing < 4; facing++) {
        const row = Math.min(facing, rows - 1);
        const key = animKey(id, anim, facing as Facing);
        if (scene.anims.exists(key)) continue;
        scene.anims.create({
          key,
          frames: m[anim].durations.map((d, i) => ({ key: tex, frame: row * cols + i, duration: (d * 1000) / 60 })),
          repeat: -1,
        });
      }
    }
  }
}

/** Facing that best matches a movement or attack direction (the grid is orthogonal). */
export function facingFor(dx: number, dy: number): Facing {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 1 : 3;
  return dy > 0 ? 0 : 2;
}
