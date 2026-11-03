import Phaser from "phaser";

/**
 * The player on the map: a small pixel trainer in the style of the NPC trainers (trainerSprites.ts), drawn at
 * boot from pixel rows, but walking: front, back and side views (left is the side mirrored), each with a
 * standing frame and stepping frames. A handful of ready-made looks to pick from at the start (and at camp).
 */

/** o outline · s skin · h hair · H hat · S shirt · B belt · P legs · k shoes. Every row 12 wide. */
type Rows = readonly string[];
type View = "front" | "back" | "side";
type Style = "cap" | "short" | "long";

const HEAD: Record<Style, Record<View, Rows>> = {
  cap: {
    front: ["...oooooo...", "..oHHHHHHo..", ".oHHHHHHHHHo", "..ohssssho..", "..osossoso..", "..osssssso..", "...oossoo..."],
    back: ["...oooooo...", "..oHHHHHHo..", ".oHHHHHHHHo.", "..ohhhhhho..", "..ohhhhhho..", "..ohhhhhho..", "...oossoo..."],
    side: ["...oooooo...", "..oHHHHHHo..", "..oHHHHHHHHo", "..ohhsssso..", "..ohhssosso.", "..ohhsssso..", "...oossoo..."],
  },
  short: {
    front: ["...oooooo...", "..ohhhhhho..", ".ohhhhhhhho.", "..ohssssho..", "..osossoso..", "..osssssso..", "...oossoo..."],
    back: ["...oooooo...", "..ohhhhhho..", ".ohhhhhhhho.", "..ohhhhhho..", "..ohhhhhho..", "..ohhhhhho..", "...oossoo..."],
    side: ["...oooooo...", "..ohhhhhho..", ".ohhhhhhhho.", "..ohhsssso..", "..ohhssosso.", "..ohhsssso..", "...oossoo..."],
  },
  long: {
    front: ["...oooooo...", "..ohhhhhho..", ".ohhhhhhhho.", ".ohssssssho.", ".ohsossosho.", ".ohssssssho.", ".ohhossohho."],
    back: ["...oooooo...", "..ohhhhhho..", ".ohhhhhhhho.", ".ohhhhhhhho.", ".ohhhhhhhho.", ".ohhhhhhhho.", ".ohhhhhhhho."],
    side: ["...oooooo...", "..ohhhhhho..", ".ohhhhhhhho.", ".ohhhsssso..", ".ohhhssosso.", ".ohhhsssso..", ".ohhhossoo.."],
  },
};

const BODY: Record<View, Rows> = {
  front: ["..oSSSSSSo..", ".oSSSSSSSSo.", ".osSSSSSSso.", ".osSSSSSSso.", "..oBBBBBBo.."],
  back: ["..oSSSSSSo..", ".oSSSSSSSSo.", ".osSSSSSSso.", ".osSSSSSSso.", "..oBBBBBBo.."],
  side: ["...oSSSSo...", "..oSSSSSSo..", "..oSSsSSSo..", "..oSSsSSSo..", "...oBBBBo..."],
};

/** Legs per view: a standing frame, then the steps (front/back step with either foot; the side strides). */
const LEGS: Record<View, readonly Rows[]> = {
  front: [
    ["..oPPPPPPo..", "..oPPooPPo..", "..oPPooPPo..", "..okkookko.."],
    ["..oPPPPPPo..", "..oPPooPPo..", "..okkooPPo..", "......okko.."],
    ["..oPPPPPPo..", "..oPPooPPo..", "..oPPookko..", "..okko......"],
  ],
  back: [
    ["..oPPPPPPo..", "..oPPooPPo..", "..oPPooPPo..", "..okkookko.."],
    ["..oPPPPPPo..", "..oPPooPPo..", "..oPPookko..", "..okko......"],
    ["..oPPPPPPo..", "..oPPooPPo..", "..okkooPPo..", "......okko.."],
  ],
  side: [
    ["...oPPPPo...", "...oPPPPo...", "...oPPPPo...", "...okkkko..."],
    ["...oPPPPo...", "..oPPooPPo..", "..oPo..oPo..", ".okko..okko."],
  ],
};

interface Avatar {
  readonly style: Style;
  readonly s: number;
  readonly h: number;
  readonly H?: number;
  readonly S: number;
  readonly P: number;
  readonly B?: number;
  readonly k?: number;
}

/** The ready-made looks, in the order the picker shows them. */
export const AVATARS = {
  "cap-red": { style: "cap", s: 0xf4d8b8, H: 0xd0021b, h: 0x3a2a1a, S: 0x3a6fd8, P: 0x3a3a5a, B: 0x2a2a3a },
  "cap-teal": { style: "cap", s: 0xd8a878, H: 0x1a9a9a, h: 0x2a2a2a, S: 0xf2f2f2, P: 0x2a4f9a, B: 0x1a9a9a },
  "cap-green": { style: "cap", s: 0xf4d8b8, H: 0x3a8a3a, h: 0xe8c66a, S: 0x6aa84f, P: 0x8a6a3a, B: 0x6b4c2a },
  "long-brown": { style: "long", s: 0xf4d8b8, h: 0x6b4226, S: 0xf2e06a, P: 0x3a6fd8, B: 0x3a6fd8 },
  "long-blonde": { style: "long", s: 0xf4d8b8, h: 0xf5d76e, S: 0xd05090, P: 0x2a2a3a, B: 0x2a2a3a },
  "long-black": { style: "long", s: 0x9a6a44, h: 0x1e1a24, S: 0x3ab0a0, P: 0xf2f2f2, B: 0xf2f2f2 },
  "short-black": { style: "short", s: 0x9a6a44, h: 0x2a2a2a, S: 0xe8601a, P: 0x3a3a5a, B: 0x2a2a2a },
  "short-ginger": { style: "short", s: 0xf4d8b8, h: 0xc8732f, S: 0x7a4ab0, P: 0x2a2a3a, B: 0xf5d76e },
} as const satisfies Record<string, Avatar>;
export type AvatarId = keyof typeof AVATARS;
export const AVATAR_IDS = Object.keys(AVATARS) as AvatarId[];
export const DEFAULT_AVATAR: AvatarId = "cap-red";

export const isAvatar = (id: string | undefined): id is AvatarId => !!id && id in AVATARS;

const OUTLINE = 0x10141c;
const W = 12, H = 16;
/** Frames in the sheet, left to right. */
const FRAMES: readonly [View, number][] = [["front", 0], ["front", 1], ["front", 2], ["back", 0], ["back", 1], ["back", 2], ["side", 0], ["side", 1]];

/** The sheet of one look (drawn once), with its walk and stand animations. Returns the texture key. */
export function avatarTexture(scene: Phaser.Scene, id: string): string {
  const look: Avatar = AVATARS[isAvatar(id) ? id : DEFAULT_AVATAR];
  const key = `avatar-${isAvatar(id) ? id : DEFAULT_AVATAR}`;
  if (scene.textures.exists(key)) return key;
  const colors: Record<string, number> = { o: OUTLINE, s: look.s, h: look.h, H: look.H ?? look.h, S: look.S, P: look.P, B: look.B ?? look.P, k: look.k ?? 0x2a2a2a };
  const g = scene.make.graphics({}, false);
  FRAMES.forEach(([view, leg], f) => {
    const rows = [...HEAD[look.style][view], ...BODY[view], ...LEGS[view][leg]!];
    // A step lifts the body a pixel.
    const lift = leg === 0 ? 0 : 1;
    rows.forEach((row, y) => [...row].forEach((c, x) => {
      const color = colors[c];
      if (color === undefined) return;
      g.fillStyle(color, 1).fillRect(f * W + x, y - (y < 12 ? lift : 0), 1, 1);
    }));
  });
  g.generateTexture(key, W * FRAMES.length, H);
  g.destroy();
  const tex = scene.textures.get(key);
  tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
  FRAMES.forEach((_, f) => tex.add(f, 0, f * W, 0, W, H));
  const anim = (name: string, frames: number[], rate: number) =>
    scene.anims.exists(`${key}-${name}`) || scene.anims.create({ key: `${key}-${name}`, frames: frames.map((frame) => ({ key, frame })), frameRate: rate, repeat: -1 });
  anim("walk-front", [1, 0, 2, 0], 8);
  anim("walk-back", [4, 3, 5, 3], 8);
  anim("walk-side", [7, 6], 6);
  return key;
}

/** Facing as in sprites.ts: 0 down, 1 right, 2 up, 3 left. */
const VIEW: readonly View[] = ["front", "side", "back", "side"];
const STAND: readonly number[] = [0, 6, 3, 6];

/** Shows the look standing or walking towards `facing`. */
export function poseAvatar(sprite: Phaser.GameObjects.Sprite, walking: boolean, facing: number): void {
  const key = sprite.texture.key;
  sprite.setFlipX(facing === 3);
  if (walking) sprite.play(`${key}-walk-${VIEW[facing]}`, true);
  else sprite.stop().setFrame(STAND[facing]!);
}
