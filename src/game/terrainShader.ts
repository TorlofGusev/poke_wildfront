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

const MAX_LIGHTS = 8;
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
uniform vec4 uLights[${MAX_LIGHTS}];
uniform vec4 uLightColors[${MAX_LIGHTS}];

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
vec4 maskA(vec2 px) { return texture2D(uMaskA, px / uSize); }
float mud(vec2 px) { return texture2D(uMaskB, px / uSize).r; }
// Edges wobble with noise, so no patch has straight sides.
float cover(float m, vec2 px, float k) { return smoothstep(0.42, 0.5, m + (fbm(px * k) - 0.5) * 0.22); }

void main() {
  vec2 px = vec2(outTexCoord.x, 1.0 - outTexCoord.y) * uSize;
  px = floor(px / 2.0) * 2.0 + 1.0; // 2-px pixels
  vec4 m = maskA(px);
  vec3 light = normalize(vec3(-0.6, -0.8, 0.9));

  // --- Ground: two tones in large soft patches, fine grain, flowers and pebbles.
  float big = fbm(px * 0.012);
  vec3 col = mix(uGround1, uGround2, smoothstep(0.35, 0.7, big));
  col *= 0.9 + 0.2 * noise(px * 0.35);
  // Small props on a 10-px grid: tufts of grass (a dark blade, a light tip), tiny flowers, pebbles.
  vec2 cell = floor(px / 10.0);
  vec2 inCell = mod(px, 10.0);
  float h = hash(cell);
  float spot = step(abs(inCell.x - 5.0), 1.0) * step(abs(inCell.y - 5.0), 1.0);
  if (uFlora > 0.5 && h > 0.55 && h < 0.75) {
    float blade = step(abs(inCell.x - 3.0 - floor(h * 40.0 - 22.0)), 0.5 + step(0.6, h)) * step(3.0, inCell.y) * step(inCell.y, 8.0);
    col = mix(col, col * (inCell.y < 5.0 ? 1.35 : 0.7), blade * 0.8);
  } else if (uFlora > 0.5 && h > 0.985) col = mix(col, hash(cell + 3.0) > 0.5 ? vec3(0.97, 0.9, 0.45) : vec3(0.95, 0.6, 0.85), spot);
  else if (h < 0.04) col = mix(col, col * 1.35 + 0.05, spot);

  // Drop shadows of rocks and bushes (light from the top left: shadows fall right and down).
  float shadow = max(cover(maskA(px - vec2(5.0, 8.0)).r, px, 0.05), cover(maskA(px - vec2(4.0, 6.0)).g, px, 0.07) * 0.8);
  col *= 1.0 - 0.38 * shadow;

  // --- Mud: wet and dark, glossy specks.
  float md = mud(px);
  float mc = cover(md, px, 0.08);
  if (mc > 0.0) {
    vec3 mudc = mix(vec3(0.42, 0.32, 0.2), vec3(0.28, 0.2, 0.12), smoothstep(0.5, 0.9, md));
    mudc *= 0.9 + 0.2 * noise(px * 0.2);
    if (noise(px * 0.15 + uTime * 0.05) > 0.78) mudc += 0.12;
    col = mix(col, mudc, mc);
  }

  // --- Water: shallow to deep, moving ripples, caustics, foam at the shore, glints.
  float wd = m.b;
  float wc = cover(wd, px, 0.06);
  if (wc > 0.0) {
    float depth = smoothstep(0.45, 0.95, wd);
    vec3 water = mix(vec3(0.27, 0.55, 0.78), vec3(0.1, 0.25, 0.45), depth);
    vec2 q = px * 0.04 + vec2(uTime * 0.25, uTime * 0.1);
    float ripple = fbm(q + fbm(q * 1.3 - uTime * 0.2));
    water *= 0.85 + 0.3 * ripple;
    float caustic = pow(1.0 - abs(noise(px * 0.06 + uTime * 0.4) - noise(px * 0.06 - uTime * 0.3 + 5.0)), 8.0);
    water += vec3(0.25, 0.35, 0.4) * caustic * (1.0 - depth);
    float foam = smoothstep(0.62, 0.45, wd + (noise(px * 0.15 + uTime) - 0.5) * 0.12);
    water = mix(water, vec3(0.85, 0.95, 1.0), foam * 0.8);
    if (hash(floor(px / 4.0) + floor(uTime * 2.0)) > 0.996) water += 0.4;
    col = mix(col, water, wc);
  }

  // --- Bushes: a canopy of leaf clumps, each a lit dome.
  float bc = cover(m.g, px, 0.07);
  float w = worley(px / 13.0);
  bc *= smoothstep(1.0, 0.75, w + (1.0 - smoothstep(0.4, 0.7, m.g)) * 0.6);
  if (bc > 0.0) {
    float dome = 1.0 - w;
    vec2 cellDir = vec2(worley(px / 13.0 + vec2(0.15, 0.0)) - w, worley(px / 13.0 + vec2(0.0, 0.15)) - w);
    vec3 n = normalize(vec3(cellDir * 6.0, 1.0));
    float lit = clamp(dot(n, light), 0.0, 1.0);
    vec3 leaf = mix(vec3(0.08, 0.22, 0.1), vec3(0.34, 0.64, 0.3), lit * dome);
    leaf *= 0.9 + 0.2 * step(0.5, noise(px * 0.4)); // leaf texture
    if (hash(floor(px / 2.0)) > 0.97 && lit > 0.6) leaf += vec3(0.25, 0.3, 0.15);
    col = mix(col, leaf, bc);
  }

  // --- Rocks: relief from the mask's slope plus noise, lit, with dark creases.
  float rc = cover(m.r, px, 0.05);
  if (rc > 0.0) {
    float e = 3.0;
    float hx = maskA(px + vec2(e, 0.0)).r - maskA(px - vec2(e, 0.0)).r;
    float hy = maskA(px + vec2(0.0, e)).r - maskA(px - vec2(0.0, e)).r;
    float detail = fbm(px * 0.035);
    vec2 dd = vec2(fbm(px * 0.035 + vec2(0.6, 0.0)) - detail, fbm(px * 0.035 + vec2(0.0, 0.6)) - detail);
    vec3 n = normalize(vec3(-(hx * 9.0 + dd.x * 3.0), -(hy * 9.0 + dd.y * 3.0), 1.0));
    float lit = clamp(dot(n, light), 0.0, 1.0);
    vec3 rock = uRock * (0.45 + 0.9 * lit);
    float crease = smoothstep(0.025, 0.0, abs(noise(px * 0.04) - 0.5));
    rock *= 1.0 - 0.4 * crease;
    rock *= 0.97 + 0.06 * hash(floor(px / 4.0));
    // A dark rim where the stone meets the ground.
    rock *= mix(0.55, 1.0, smoothstep(0.5, 0.62, m.r + (fbm(px * 0.05) - 0.5) * 0.22));
    col = mix(col, rock, rc);
  }

  // --- Light: the scene's ambient, plus burning ground and attack flashes.
  vec3 lsum = vec3(uAmbient);
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    vec4 L = uLights[i];
    if (L.w <= 0.0) continue;
    float d = length(px - L.xy) / L.z;
    lsum += uLightColors[i].rgb * L.w * clamp(1.0 - d * d, 0.0, 1.0);
  }
  col *= lsum;
  col = floor(col * 28.0 + 0.5) / 28.0; // a limited palette
  gl_FragColor = vec4(col, 1.0);
}
`;

const THEMES: Record<BoardTheme, { g1: number; g2: number; rock: number; ambient: number; flora: number }> = {
  field: { g1: 0x3b5a36, g2: 0x4f6b3a, rock: 0x8a8e98, ambient: 1, flora: 1 },
  cave: { g1: 0x4a423c, g2: 0x5a5048, rock: 0x8c7f70, ambient: 0.82, flora: 0 },
  shore: { g1: 0x8a7f58, g2: 0xa39568, rock: 0x9c9280, ambient: 1.05, flora: 0 },
  indoor: { g1: 0x4a4d57, g2: 0x55586a, rock: 0x7d8290, ambient: 0.95, flora: 0 },
};

const rgb = (c: number) => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];

export interface GroundLight {
  x: number;
  y: number;
  radius: number;
  intensity: number;
  color: number;
}

/** Whether the GPU ground can be used (WebGL renderer). */
export const shaderGround = (scene: Phaser.Scene): boolean => scene.game.renderer.type === Phaser.WEBGL;

export class TerrainShader {
  private readonly shader: Phaser.GameObjects.Shader;
  private readonly keyA: string;
  private readonly keyB: string;
  private lights: GroundLight[] = [];

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
    const w = Math.ceil(board.w / CELL), h = Math.ceil(board.h / CELL);
    scene.textures.addCanvas(this.keyA, Object.assign(document.createElement("canvas"), { width: w, height: h }));
    scene.textures.addCanvas(this.keyB, Object.assign(document.createElement("canvas"), { width: w, height: h }));
    const start = scene.time.now;
    this.shader = scene.add.shader({
      name: `ground-${id}`,
      fragmentSource: FRAG,
      setupUniforms: (set: (name: string, value: unknown) => void) => {
        set("uMaskA", 0);
        set("uMaskB", 1);
        set("uSize", [board.w, board.h]);
        set("uTime", (scene.time.now - start) / 1000);
        set("uGround1", rgb(t.g1));
        set("uGround2", rgb(t.g2));
        set("uRock", rgb(t.rock));
        set("uAmbient", t.ambient);
        set("uFlora", t.flora);
        const L = new Float32Array(MAX_LIGHTS * 4), C = new Float32Array(MAX_LIGHTS * 4);
        this.lights.slice(0, MAX_LIGHTS).forEach((l, i) => {
          L.set([l.x - board.x, l.y - board.y, l.radius, l.intensity], i * 4);
          C.set([...rgb(l.color), 1], i * 4);
        });
        set("uLights[0]", L);
        set("uLightColors[0]", C);
      },
    }, board.x, board.y, board.w, board.h, [this.keyA, this.keyB]).setOrigin(0).setDepth(-1);
  }

  setLights(lights: GroundLight[]): void {
    this.lights = lights;
  }

  /** Paints the terrain masks from the field (later zones cover earlier ones, as in the rules), softened. */
  update(field: FreeField): void {
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
    const blurred = masks.map(({ g, c }) => blur(g.getImageData(0, 0, c.width, c.height), 4));
    this.write(this.keyA, [blurred[0]!, blurred[1]!, blurred[2]!]);
    this.write(this.keyB, [blurred[3]!, blurred[3]!, blurred[3]!]);
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
    this.shader.destroy();
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
