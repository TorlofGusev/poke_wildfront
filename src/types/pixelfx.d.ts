// pixelfx (github:patch-gg/pixelfx) ships plain JS; the slice of its API the game uses.
declare module "pixelfx" {
  export interface PixelFrame { readonly w: number; readonly h: number; readonly color: Uint32Array; readonly light: Uint32Array }
  export interface PixelFxInstance { update(dt: number): void; draw(frame: PixelFrame, layer?: "back" | "front"): void; stop(): void; done(): boolean }
  export interface PixelFxModule { readonly meta: { readonly size: readonly [number, number]; readonly origin: readonly [number, number]; readonly duration?: number; readonly loop?: boolean } }
  export function createFrame(w: number, h: number, ox?: number, oy?: number): PixelFrame;
  export function clearFrame(f: PixelFrame): PixelFrame;
  export function createFx(mod: PixelFxModule, o?: Record<string, unknown>): PixelFxInstance;
  export function composite(f: PixelFrame, out: Uint8ClampedArray, bg?: number | null, lightK?: number): Uint8ClampedArray;
}
declare module "pixelfx/fx/*" {
  export const meta: import("pixelfx").PixelFxModule["meta"];
}
