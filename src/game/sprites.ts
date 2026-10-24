import Phaser from "phaser";
import spriteMeta from "../content/sprites.json";

/** PMDCollab sprite sheets: 8 rows of directions, frames left to right. Durations are in 1/60 s ticks. */
interface AnimMeta {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly durations: readonly number[];
}
interface SpeciesSprites {
  readonly dex: number;
  readonly idle: AnimMeta;
  readonly walk: AnimMeta;
  readonly hurt: AnimMeta;
}

const META = spriteMeta as Record<string, SpeciesSprites>;
const FILES = import.meta.glob("../assets/sprites/*.png", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const url = (dex: number, kind: string) => FILES[`../assets/sprites/${String(dex).padStart(4, "0")}-${kind}.png`];

export type SpriteAnim = "idle" | "walk" | "hurt";
/** Sheet rows: down, down-right, right, up-right, up, up-left, left, down-left. */
export type Facing = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const FACE_RIGHT: Facing = 2;
export const FACE_LEFT: Facing = 6;

export const hasSprite = (speciesId: string): boolean => Boolean(META[speciesId] && url(META[speciesId]!.dex, "idle"));
export const portraitKey = (speciesId: string) => `${speciesId}-portrait`;
export const animKey = (speciesId: string, anim: SpriteAnim, facing: Facing) => `${speciesId}-${anim}-${facing}`;

export function preloadSprites(scene: Phaser.Scene): void {
  for (const [id, m] of Object.entries(META)) {
    for (const anim of ["idle", "walk", "hurt"] as const) {
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
    for (const anim of ["idle", "walk", "hurt"] as const) {
      const tex = `${id}-${anim}`;
      if (!scene.textures.exists(tex)) continue;
      const cols = m[anim].durations.length;
      const rows = Math.max(1, Math.floor(scene.textures.get(tex).getSourceImage().height / m[anim].frameHeight));
      for (let facing = 0; facing < 8; facing++) {
        const row = Math.min(facing, rows - 1);
        const key = animKey(id, anim, facing as Facing);
        if (scene.anims.exists(key)) continue;
        scene.anims.create({
          key,
          frames: m[anim].durations.map((d, i) => ({ key: tex, frame: row * cols + i, duration: (d * 1000) / 60 })),
          repeat: anim === "hurt" ? 0 : -1,
        });
      }
    }
  }
}

/** Facing that best matches a movement or attack direction. */
export function facingFor(dx: number, dy: number): Facing {
  if (dx === 0 && dy === 0) return 0;
  const angle = Math.atan2(dy, dx); // 0 = right, π/2 = down
  const octant = Math.round(angle / (Math.PI / 4)); // -4..4
  const byOctant: Record<number, Facing> = { 0: 2, 1: 1, 2: 0, 3: 7, 4: 6, [-4]: 6, [-3]: 5, [-2]: 4, [-1]: 3 };
  return byOctant[octant]!;
}
