import Phaser from "phaser";
import type { LookId } from "./trainerLook";

/**
 * Trainers on the map as small pixel people drawn at boot: one body, dressed per trainer class
 * (cap, straw hat, backpack, robe…), so a trainer reads as a person and not as their lead Pokémon.
 */

/** Pixel rows, 12 wide. o outline · s skin · h hair · H hat · S shirt · P legs · k shoes · B extra (bag, belt, logo). */
const BODY: Record<string, readonly string[]> = {
  cap: [
    "...oooooo...",
    "..oHHHHHHo..",
    ".oHHHHHHHHHo",
    "..ohssssho..",
    "..osossoso..",
    "..ossssss o.",
    "...oossoo...",
    "..oSSSSSSo..",
    ".oSSSSSSSSo.",
    ".osSSSSSSso.",
    ".osSSSSSSso.",
    "..oBBBBBBo..",
    "..oPPPPPPo..",
    "..oPPooPPo..",
    "..oPPooPPo..",
    "..okkookko..",
  ],
  hair: [
    "...oooooo...",
    "..ohhhhhho..",
    ".ohhhhhhhho.",
    ".ohssssssho.",
    ".ohsossosho.",
    ".ohssssssho.",
    ".ohhossohho.",
    "..oSSSSSSo..",
    ".oSSSSSSSSo.",
    ".osSSSSSSso.",
    ".osSSSSSSso.",
    ".oPPPPPPPPo.",
    "oPPPPPPPPPPo",
    "..oo.ss.oo..",
    "...os..so...",
    "...ok..ko...",
  ],
  wide: [
    "....oooo....",
    "..ooHHHHoo..",
    "ooHHHHHHHHoo",
    "..ohssssho..",
    "..osossoso..",
    "..ossssss o.",
    "...oossoo...",
    "..oSSSSSSo..",
    ".oSSSSSSSSo.",
    ".osSSSSSSso.",
    ".osSSSSSSso.",
    "..oBBBBBBo..",
    "..oPPPPPPo..",
    "..oPPooPPo..",
    "..oPPooPPo..",
    "..okkookko..",
  ],
  robe: [
    "...oooooo...",
    "..ohhhhhho..",
    ".ohhhhhhhho.",
    ".ohssssssho.",
    ".ohsossosho.",
    ".ohssssssho.",
    "..oossssoo..",
    "..oSSSSSSo..",
    ".oSSSSSSSSo.",
    ".oSSSBBSSSo.",
    ".osSSSSSSso.",
    ".oSSSSSSSSo.",
    "oSSSSSSSSSSo",
    "oSSSSSSSSSSo",
    ".oSSSSSSSSo.",
    "..okkookko..",
  ],
};

interface Look {
  readonly body: keyof typeof BODY;
  readonly H?: number;
  readonly h: number;
  readonly S: number;
  readonly P: number;
  readonly B?: number;
  readonly k?: number;
  /** Something carried beside the body: a backpack or a bug net. */
  readonly gear?: "pack" | "net";
}

const LOOKS: Record<LookId, Look> = {
  youngster: { body: "cap", H: 0x3a6fd8, h: 0x6b4226, S: 0xf2f2f2, P: 0x3a6fd8, B: 0x3a6fd8 },
  bug: { body: "wide", H: 0xe8c66a, h: 0x6b4226, S: 0x7ed321, P: 0xd9b36c, B: 0x8a6a3a, gear: "net" },
  hiker: { body: "wide", H: 0x8a5a2b, h: 0x3a2a1a, S: 0xc8732f, P: 0x6b4c2a, B: 0x6b4c2a, gear: "pack" },
  camper: { body: "cap", H: 0x4a8a3a, h: 0x6b4226, S: 0x6aa84f, P: 0x8a6a3a, B: 0x8a6a3a, gear: "pack" },
  lass: { body: "hair", h: 0xe8a04a, S: 0xf5f5f5, P: 0x3a6fd8 },
  picnicker: { body: "hair", h: 0x6b4226, S: 0xf2e06a, P: 0x6aa84f },
  beauty: { body: "hair", h: 0xf5d76e, S: 0xd05090, P: 0xd05090 },
  swimmer: { body: "cap", H: 0xf2f2f2, h: 0x3a2a1a, S: 0xf4d8b8, P: 0x2a7fd0, B: 0x2a7fd0 },
  sailor: { body: "cap", H: 0xf2f2f2, h: 0x3a2a1a, S: 0x2a4f9a, P: 0xf2f2f2, B: 0xf2f2f2 },
  fisherman: { body: "wide", H: 0x5a7a3a, h: 0x5a5a5a, S: 0x5a8ab0, P: 0x4a4a6a, B: 0x6b4c2a },
  biker: { body: "cap", H: 0x2a2a2a, h: 0x2a2a2a, S: 0x3a3a3a, P: 0x2a2a3a, B: 0xb0b0b0 },
  blackbelt: { body: "cap", H: 0xd0021b, h: 0x2a2a2a, S: 0xf2f2f2, P: 0xf2f2f2, B: 0x1a1a1a },
  channeler: { body: "robe", h: 0x8a8a8a, S: 0x9a6ac0, P: 0x9a6ac0, B: 0xf5d76e },
  psychic: { body: "robe", h: 0x3a2a5a, S: 0xd070c0, P: 0xd070c0, B: 0xf5d76e },
  scientist: { body: "robe", h: 0x5a5a5a, S: 0xf2f2f2, P: 0xf2f2f2, B: 0x5aa0d0 },
  gentleman: { body: "cap", H: 0x2a2a2a, h: 0x8a8a8a, S: 0x2a2a3a, P: 0x2a2a3a, B: 0xd0021b },
  rocket: { body: "cap", H: 0x2a2a2a, h: 0x2a2a2a, S: 0x2a2a2a, P: 0x2a2a2a, B: 0xd0021b },
  cooltrainer: { body: "cap", H: 0xd0021b, h: 0x3a5a2a, S: 0x3a8a3a, P: 0x2a2a3a, B: 0xf5d76e },
  leader: { body: "cap", H: 0xf5d76e, h: 0x3a2a1a, S: 0xc8732f, P: 0x4a4a6a, B: 0xf5d76e },
  elite: { body: "robe", h: 0x3a2a1a, S: 0x6a3ab0, P: 0x6a3ab0, B: 0xf5d76e },
  rival: { body: "hair", h: 0xb07a3a, S: 0x5a3ab0, P: 0x3a3a5a },
  trainer: { body: "cap", H: 0xd0021b, h: 0x3a2a1a, S: 0x3a6fd8, P: 0x3a3a5a, B: 0x3a3a5a },
};

const SKIN = 0xf4d8b8;
const OUTLINE = 0x10141c;

/** Texture key of a look, drawn once on first use. */
export function trainerTexture(scene: Phaser.Scene, look: string): string {
  const key = `trainer-${look}`;
  if (scene.textures.exists(key)) return key;
  const l = LOOKS[look as LookId] ?? LOOKS.trainer;
  const g = scene.make.graphics({}, false);
  const colors: Record<string, number> = { o: OUTLINE, s: SKIN, h: l.h, H: l.H ?? l.h, S: l.S, P: l.P, k: l.k ?? 0x2a2a2a, B: l.B ?? l.P };
  const rows = BODY[l.body]!;
  const ox = 2;
  rows.forEach((row, y) => [...row].forEach((c, x) => {
    const color = colors[c];
    if (color === undefined) return;
    g.fillStyle(color, 1);
    g.fillRect(ox + x, y, 1, 1);
  }));
  if (l.gear === "pack") {
    g.fillStyle(OUTLINE, 1).fillRect(ox + 11, 7, 3, 6);
    g.fillStyle(0x8a5a2b, 1).fillRect(ox + 11, 8, 2, 4);
  } else if (l.gear === "net") {
    g.fillStyle(0x8a6a3a, 1).fillRect(ox + 12, 4, 1, 9);
    g.fillStyle(0xf2f2f2, 1).fillRect(ox + 11, 1, 3, 3);
    g.fillStyle(OUTLINE, 1).fillRect(ox + 11, 4, 3, 1);
  }
  g.generateTexture(key, 16, rows.length);
  g.destroy();
  scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
  return key;
}
