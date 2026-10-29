import Phaser from "phaser";
import type { FreeField } from "../core/free";
import type { BoardTheme } from "./ui/boardDecor";

/**
 * The battle ground, painted per pixel on the GPU from code alone (no image files): the field's terrain
 * becomes soft masks, and a fragment shader turns them into ground with noise-varied grass, flowers and
 * pebbles; rocks with real relief (normals from the mask's slope, lit from the top left, casting
 * shadows); bushes as Worley-noise leaf clumps; water deepening to the middle with moving ripples,
 * caustics and foam at the shore; wet mud. Up to 8 lights (burning ground, attack flashes) colour it all.
 * Snapped to 2-px pixels and a limited palette, so it sits with the pixel-art sprites.
 */

const MAX_LIGHTS = 16;
const MAX_POOLS = 4;
/** Mask resolution: one texel per this many screen pixels. */
const CELL = 2;

const FRAG = `
precision highp float;
varying vec2 outTexCoord;
uniform sampler2D uMaskA; // r rock, g bush, b water
uniform sampler2D uMaskB; // r mud
uniform vec2 uSize;
uniform float uTime;
uniform vec3 uGround1;
uniform vec3 uGround2;
uniform vec3 uRock;
uniform float uAmbient;
uniform float uFlora;
uniform float uPass; // 0: the still ground, baked once; 1: the moving part over it
uniform sampler2D uBase;
uniform float uPoolCount;
uniform float uDebris; // how much loose stone lies about (caves most)
uniform vec4 uLights[${MAX_LIGHTS}];
uniform vec4 uLightColors[${MAX_LIGHTS}];
uniform vec4 uPools[${MAX_POOLS}]; // burning (w 1) or poisoned (w 2) ground: x, y, radius

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return v;
}
// Worley: distance to the nearest of jittered cell points (leaf clumps).
float worley(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float d = 1.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y));
    vec2 c = o + vec2(hash(i + o), hash(i + o + 7.7)) * 0.8 + 0.1;
    d = min(d, length(c - f));
  }
  return d;
}
// Canvas textures come in upside down relative to the board's pixels.
vec2 maskUv(vec2 px) { return vec2(px.x / uSize.x, 1.0 - px.y / uSize.y); }
vec4 maskA(vec2 px) { return texture2D(uMaskA, maskUv(px)); }
float mud(vec2 px) { return texture2D(uMaskB, maskUv(px)).r; }
// Edges wobble with noise, so no patch has straight sides.
float cover(float m, vec2 px, float k) { return smoothstep(0.46, 0.52, m + (fbm(px * k) - 0.5) * 0.12); }


float bushCover(float g, vec2 px, float w) { return cover(g, px, 0.07) * smoothstep(1.0, 0.75, w + (1.0 - smoothstep(0.4, 0.7, g)) * 0.6); }

// The moving part, every other frame: water, burning and poisoned ground and the lights, over the baked ground.
vec3 animated(vec2 px, vec4 m, vec3 col) {
  vec3 emit = vec3(0.0);
  // Water and hazards lie under rocks and bushes: only where neither covers the ground (worked out only where needed).
  float open = 1.0;
  bool near = m.b > 0.3 || uPoolCount > 0.5;
  if (near) open = (1.0 - cover(m.r, px, 0.05)) * (1.0 - bushCover(m.g, px, worley(px / 13.0)));
  if (m.b > 0.3) {
    // --- Water: shallow to deep, moving ripples, caustics, foam at the shore, glints.
    float wd = m.b;
    float wc = cover(wd, px, 0.06);
    if (wc > 0.0) {
      float depth = smoothstep(0.45, 0.95, wd);
      // The drawn water, set moving: ripples darken and lighten it, light plays on the shallows.
      vec3 water = col;
      vec2 q = px * 0.04 + vec2(uTime * 0.25, uTime * 0.1);
      float ripple = fbm(q + fbm(q * 1.3 - uTime * 0.2));
      water *= 0.85 + 0.3 * ripple;
      float caustic = pow(1.0 - abs(noise(px * 0.06 + uTime * 0.4) - noise(px * 0.06 - uTime * 0.3 + 5.0)), 8.0);
      water += vec3(0.25, 0.35, 0.4) * caustic * (1.0 - depth);
      float foam = smoothstep(0.62, 0.45, wd + (noise(px * 0.15 + uTime) - 0.5) * 0.12);
      water = mix(water, vec3(0.85, 0.95, 1.0), foam * 0.8);
      if (hash(floor(px / 4.0) + floor(uTime * 2.0)) > 0.996) water += 0.4;
      col = mix(col, water, wc * open);
    }


  }
  if (uPoolCount > 0.5) {
    // --- Burning and poisoned ground, drawn per pixel (no particles): flames licking upwards, bubbling sludge.
    for (int i = 0; i < ${MAX_POOLS}; i++) {
      vec4 P = uPools[i];
      if (P.w < 0.5) continue;
      float e = length(px - P.xy) / P.z + (fbm(px * 0.05 + float(i) * 9.1) - 0.5) * 0.35;
      if (e > 1.05) continue;
      if (P.w < 1.5) {
        col = mix(col, col * 0.35 + vec3(0.06, 0.02, 0.0), smoothstep(1.05, 0.7, e) * open);
        vec2 q = px * 0.035 + vec2(0.0, uTime * 1.6);
        float f = fbm(q + vec2(fbm(q * 1.7 + uTime * 0.7) * 1.5, 0.0)) * smoothstep(1.0, 0.25, e);
        float heat = clamp(f * 1.35, 0.0, 1.0);
        vec3 flame = mix(vec3(0.55, 0.07, 0.02), vec3(1.0, 0.45, 0.06), smoothstep(0.25, 0.55, heat));
        flame = mix(flame, vec3(1.0, 0.82, 0.38), smoothstep(0.62, 0.9, heat)); // the hottest core stays golden, never white
        float a = smoothstep(0.22, 0.42, heat);
        a *= open;
        col = mix(col, flame, a);
        emit += flame * a * 0.6;
      } else {
        float a = smoothstep(1.0, 0.82, e) * 0.9 * open;
        vec3 sludge = mix(vec3(0.3, 0.1, 0.4), vec3(0.5, 0.2, 0.62), noise(px * 0.06 + uTime * 0.15));
        float w2 = worley(px / 8.0 + vec2(float(i) * 3.3, -uTime * 0.25));
        float size = 0.2 + 0.1 * sin(uTime * 2.5 + noise(px * 0.03) * 12.0);
        float bubble = smoothstep(size + 0.04, size, w2);
        // Each bubble a lit dome with a darker rim, swelling and shrinking.
        float rim = smoothstep(size + 0.04, size, w2) - smoothstep(size - 0.02, size - 0.08, w2);
        sludge = mix(sludge, vec3(0.62, 0.32, 0.75), bubble * 0.7);
        sludge = mix(sludge, vec3(0.22, 0.06, 0.3), rim * 0.6);
        col = mix(col, sludge, a);
        emit += vec3(0.12, 0.02, 0.18) * a;
      }
    }


  }
  // --- Light: the scene's ambient, plus burning ground and attack flashes.
  vec3 lsum = vec3(uAmbient);
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    vec4 L = uLights[i];
    if (L.w <= 0.0) continue;
    float d = length(px - L.xy) / L.z;
    lsum += uLightColors[i].rgb * L.w * clamp(1.0 - d * d, 0.0, 1.0);
  }
  return col * lsum + emit;
}

void main() {
  vec2 uv = vec2(outTexCoord.x, 1.0 - outTexCoord.y);
  vec2 px = floor(uv * uSize / 2.0) * 2.0 + 1.0; // the animation in 2-px pixels, like the sprites
  gl_FragColor = vec4(animated(px, maskA(px), texture2D(uBase, outTexCoord).rgb), 1.0);
}
`;

const THEMES: Record<BoardTheme, { g1: number; g2: number; rock: number; ambient: number; flora: number; debris: number }> = {
  field: { g1: 0x3b5a36, g2: 0x4f6b3a, rock: 0x8a8e98, ambient: 1, flora: 1, debris: 0.05 },
  // Caves are dark: the Pokémon carry pools of warm light, crystals glow faintly (see BattleScene.caveLights).
  cave: { g1: 0x4a423c, g2: 0x5a5048, rock: 0x8c7f70, ambient: 0.55, flora: 0, debris: 0.25 },
  shore: { g1: 0x8a7f58, g2: 0xa39568, rock: 0x9c9280, ambient: 1, flora: 0, debris: 0.2 },
  indoor: { g1: 0x4a4d57, g2: 0x55586a, rock: 0x7d8290, ambient: 1, flora: 0, debris: 0.03 },
  gym: { g1: 0x6a6a70, g2: 0x7a7a80, rock: 0x9a948a, ambient: 1, flora: 0, debris: 0.02 },
};

const rgb = (c: number) => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];

export interface GroundLight {
  x: number;
  y: number;
  radius: number;
  intensity: number;
  color: number;
}

/** Burning or poisoned ground the shader paints. */
export interface GroundPool {
  x: number;
  y: number;
  radius: number;
  kind: "fire" | "poison";
}

/** Whether the GPU ground can be used (WebGL renderer). */
export const shaderGround = (scene: Phaser.Scene): boolean => scene.game.renderer.type === Phaser.WEBGL;

export class TerrainShader {
  /** Water, burning/poisoned ground and light over the baked ground. */
  private readonly moving: Phaser.GameObjects.Shader;
  private readonly baked: Phaser.GameObjects.RenderTexture;
  /** What is on screen: the moving pass, redrawn every other frame (30 fps is plenty for ripples and flames). */
  private readonly view: Phaser.GameObjects.RenderTexture;
  private readonly keyA: string;
  private readonly keyB: string;
  private lights: GroundLight[] = [];
  private pools: GroundPool[] = [];
  private frame = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly board: { x: number; y: number; w: number; h: number },
    theme: BoardTheme,
    /** Field units to board pixels. */
    private readonly toBoard: (p: { x: number; y: number }) => { x: number; y: number },
  ) {
    const id = Math.random().toString(36).slice(2, 8);
    this.keyA = `ground-mask-a-${id}`;
    this.keyB = `ground-mask-b-${id}`;
    const t = THEMES[theme];
    const mw = Math.ceil(board.w / CELL), mh = Math.ceil(board.h / CELL);
    scene.textures.addCanvas(this.keyA, Object.assign(document.createElement("canvas"), { width: mw, height: mh }));
    scene.textures.addCanvas(this.keyB, Object.assign(document.createElement("canvas"), { width: mw, height: mh }));
    const hw = board.w, hh = board.h;
    this.baked = scene.make.renderTexture({ x: 0, y: 0, width: hw, height: hh }, false).setOrigin(0);
    this.view = scene.add.renderTexture(board.x, board.y, hw, hh).setOrigin(0).setScale(board.w / hw, board.h / hh).setDepth(-1);
    const start = scene.time.now;
    const uniforms = (pass: number) => (set: (name: string, value: unknown) => void) => {
      set("uMaskA", 0);
      set("uMaskB", 1);
      set("uBase", 2);
      set("uPass", pass);
      set("uSize", [board.w, board.h]);
      set("uTime", (scene.time.now - start) / 1000);
      set("uGround1", rgb(t.g1));
      set("uGround2", rgb(t.g2));
      set("uRock", rgb(t.rock));
      set("uAmbient", t.ambient);
      set("uFlora", t.flora);
      set("uDebris", t.debris);
      const L = new Float32Array(MAX_LIGHTS * 4), C = new Float32Array(MAX_LIGHTS * 4);
      this.lights.slice(0, MAX_LIGHTS).forEach((l, i) => {
        L.set([l.x - board.x, l.y - board.y, l.radius, l.intensity], i * 4);
        C.set([...rgb(l.color), 1], i * 4);
      });
      set("uLights[0]", L);
      set("uLightColors[0]", C);
      const P = new Float32Array(MAX_POOLS * 4);
      this.pools.slice(0, MAX_POOLS).forEach((p, i) => P.set([p.x - board.x, p.y - board.y, p.radius, p.kind === "fire" ? 1 : 2], i * 4));
      set("uPools[0]", P);
      set("uPoolCount", Math.min(MAX_POOLS, this.pools.length));
    };
    const make = (pass: number, textures: (string | Phaser.Textures.Texture)[]) =>
      new Phaser.GameObjects.Shader(scene, { name: `ground-${pass}-${id}`, fragmentSource: FRAG, setupUniforms: uniforms(pass) }, 0, 0, hw, hh, textures as string[]).setOrigin(0);
    this.moving = make(1, [this.keyA, this.keyB, this.baked.texture]);
    scene.events.on("update", this.tick, this);
    scene.events.once("shutdown", () => scene.events.off("update", this.tick, this));
  }

  private tick(): void {
    if (this.frame++ % 2) return;
    this.view.clear().draw(this.moving).render();
  }

  setLights(lights: GroundLight[], pools: GroundPool[] = []): void {
    this.lights = lights;
    this.pools = pools;
  }

  /** Paints the terrain masks from the field (later zones cover earlier ones, as in the rules), softened. */
  update(field: FreeField, base: Phaser.GameObjects.Graphics): void {
    const masks = ["rock", "bush", "water", "mud"].map(() => {
      const c = document.createElement("canvas");
      c.width = Math.ceil(this.board.w / CELL);
      c.height = Math.ceil(this.board.h / CELL);
      const g = c.getContext("2d")!;
      g.fillStyle = "#000";
      g.fillRect(0, 0, c.width, c.height);
      return { c, g };
    });
    const order = ["rock", "bush", "water", "mud"];
    for (const z of field.zones) {
      for (let i = 0; i < 4; i++) {
        const { g } = masks[i]!;
        g.fillStyle = order[i] === z.terrain ? "#fff" : "#000";
        g.beginPath();
        z.poly.forEach((p, k) => {
          const b = this.toBoard(p);
          const x = (b.x - this.board.x) / CELL, y = (b.y - this.board.y) / CELL;
          if (k) g.lineTo(x, y);
          else g.moveTo(x, y);
        });
        g.closePath();
        g.fill();
      }
    }
    // Rocks stay sharp (they must match where they block); water and mud get rounder shores.
    const blurred = masks.map(({ g, c }, i) => blur(g.getImageData(0, 0, c.width, c.height), [1, 2, 3, 3][i]!));
    this.write(this.keyA, [blurred[0]!, blurred[1]!, blurred[2]!]);
    this.write(this.keyB, [blurred[3]!, blurred[3]!, blurred[3]!]);
    // The drawn board is the base the moving pass works on.
    this.baked.clear().draw(base, -this.board.x, -this.board.y).render();
    this.frame = 0;
    this.tick();
  }

  private write(key: string, channels: Float32Array[]): void {
    const tex = this.scene.textures.get(key) as Phaser.Textures.CanvasTexture;
    const ctx = tex.getContext();
    const img = ctx.createImageData(tex.width, tex.height);
    for (let i = 0; i < channels[0]!.length; i++) {
      img.data[i * 4] = channels[0]![i]! * 255;
      img.data[i * 4 + 1] = channels[1]![i]! * 255;
      img.data[i * 4 + 2] = channels[2]![i]! * 255;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    tex.refresh();
  }

  destroy(): void {
    this.scene.events.off("update", this.tick, this);
    this.moving.destroy();
    this.baked.destroy();
    this.view.destroy();
    this.scene.textures.remove(this.keyA);
    this.scene.textures.remove(this.keyB);
  }
}

/** A channel's 0..1 values softened by three box blurs (close to a Gaussian), so masks fall off smoothly. */
function blur(img: ImageData, r: number): Float32Array {
  const { width: w, height: h } = img;
  let a = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) a[i] = img.data[i * 4]! / 255;
  let b = new Float32Array(w * h);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      let s = 0;
      for (let x = -r; x <= r; x++) s += a[y * w + Math.min(w - 1, Math.max(0, x))]!;
      for (let x = 0; x < w; x++) {
        b[y * w + x] = s / (2 * r + 1);
        s += a[y * w + Math.min(w - 1, x + r + 1)]! - a[y * w + Math.max(0, x - r)]!;
      }
    }
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let y = -r; y <= r; y++) s += b[Math.min(h - 1, Math.max(0, y)) * w + x]!;
      for (let y = 0; y < h; y++) {
        a[y * w + x] = s / (2 * r + 1);
        s += b[Math.min(h - 1, y + r + 1) * w + x]! - b[Math.max(0, y - r) * w + x]!;
      }
    }
    [a, b] = [a, b];
  }
  return a;
}
