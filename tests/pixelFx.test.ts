import { afterEach, describe, expect, it, vi } from "vitest";

// pixelFx only touches Phaser at play time; a stand-in scene records what it is asked to draw.
vi.mock("phaser", () => ({ default: { Textures: { FilterMode: { NEAREST: 0 } } } }));

import { critFx, groundFlame, hasTypeImpact, signatureFx, typeImpactFx } from "../src/game/pixelFx";
import { TYPES } from "../src/content";

/** A scene stand-in: textures, images and the update loop, with every frame of every effect stepped through. */
function fakeScene() {
  const updates = new Set<(t: number, d: number) => void>();
  const images: { x: number; y: number; scaleX: number; rotation: number; crop?: number[]; destroyed: boolean }[] = [];
  const textures = new Set<string>();
  const image = (x: number, y: number) => {
    const im = { x, y, scaleX: 1, rotation: 0, crop: undefined as number[] | undefined, destroyed: false, visible: true };
    images.push(im);
    const api = {
      setOrigin: () => api, setDepth: () => api,
      setScale: (sx: number) => ((im.scaleX = sx), api),
      setRotation: (r: number) => ((im.rotation = r), api),
      setCrop: (...c: number[]) => ((im.crop = c), api),
      setVisible: (v: boolean) => ((im.visible = v), api),
      destroy: () => void (im.destroyed = true),
    };
    return api;
  };
  const scene = {
    time: { timeScale: 1, delayedCall: (_ms: number, f: () => void) => f() },
    tweens: { add: (cfg: { onComplete?: () => void }) => cfg.onComplete?.() },
    events: {
      on: (_e: string, f: (t: number, d: number) => void) => updates.add(f),
      off: (_e: string, f: (t: number, d: number) => void) => updates.delete(f),
      once: () => undefined,
    },
    add: { image },
    textures: {
      createCanvas: (key: string, w: number, h: number) => {
        textures.add(key);
        return {
          setFilter: () => undefined,
          refresh: () => undefined,
          getContext: () => ({ createImageData: () => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData: () => undefined }),
        };
      },
      exists: (key: string) => textures.has(key),
      remove: (key: string) => textures.delete(key),
    },
  };
  /** Steps every live effect at 30 fps until all are done (or `max` seconds pass). */
  const run = (max = 8) => {
    for (let i = 0; i < max * 30 && updates.size; i++) for (const f of [...updates]) f(0, 1000 / 30);
  };
  return { scene: scene as never, images, textures, updates, run };
}

const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
afterEach(() => errors.mockClear());

const SET_PIECES = [
  "earthquake", "fire-spin", "twister", "hurricane", "flamethrower", "blast-burn", "heat-wave", "dragon-breath", "water-gun",
  "hydro-pump", "surf", "ice-beam", "ice-shard", "thunder", "thunderbolt", "discharge", "psychic", "psystrike", "hyper-beam",
  "dragon-pulse", "aura-sphere", "shadow-ball", "ember", "fire-blast", "stone-edge", "rock-slide", "rock-throw", "blizzard",
];

describe("pixelfx effects", () => {
  it.each(SET_PIECES)("plays %s's set piece to the end without failing, and cleans up", (id) => {
    const f = fakeScene();
    const piece = signatureFx(f.scene, id, { x: 100, y: 100 }, [{ x: 220, y: 60 }, { x: 140, y: 150 }]);
    expect(piece).not.toBeNull();
    f.run();
    expect(errors).not.toHaveBeenCalled();
    expect(f.updates.size).toBe(0);
    expect(f.textures.size).toBe(0);
    expect(f.images.every((im) => im.destroyed)).toBe(true);
  });

  it("lands every type with an impact that plays through", () => {
    for (const type of Object.keys(TYPES)) {
      expect(hasTypeImpact(type)).toBe(true);
      const f = fakeScene();
      typeImpactFx(f.scene, type, { x: 50, y: 50 });
      f.run();
      expect(errors, type).not.toHaveBeenCalled();
      expect(f.textures.size, type).toBe(0);
    }
  });

  it("plays critical hits and ground flames", () => {
    const f = fakeScene();
    void critFx(f.scene, { x: 0, y: 0 }, { x: 40, y: 10 });
    void groundFlame(f.scene, { x: 10, y: 10 }, 0.3, 1.2, 0);
    f.run();
    expect(errors).not.toHaveBeenCalled();
    expect(f.textures.size).toBe(0);
  });

  it("has no set piece for moves pixelfx does not cover", () => {
    expect(signatureFx(fakeScene().scene, "tackle", { x: 0, y: 0 }, [{ x: 10, y: 0 }])).toBeNull();
  });

  it("aims leftward pieces mirrored, so their up stays up", () => {
    const f = fakeScene();
    signatureFx(f.scene, "flamethrower", { x: 200, y: 100 }, [{ x: 100, y: 100 }]);
    const im = f.images[0]!;
    expect(im.scaleX).toBeLessThan(0);
    expect(Math.abs(im.rotation) % Math.PI).toBeCloseTo(0);
  });

  it("crops fixed beams at the target instead of shooting past it", () => {
    const f = fakeScene();
    signatureFx(f.scene, "psychic", { x: 100, y: 100 }, [{ x: 160, y: 100 }]);
    expect(f.images[0]!.crop).toBeDefined();
  });

  it("logs and skips an effect that fails instead of throwing into the battle", () => {
    const f = fakeScene();
    (f.scene as unknown as { textures: { createCanvas: () => never } }).textures.createCanvas = () => {
      throw new Error("no canvas");
    };
    expect(() => signatureFx(f.scene, "thunder", { x: 0, y: 0 }, [{ x: 50, y: 0 }])).not.toThrow();
    expect(errors).toHaveBeenCalled();
  });
});
