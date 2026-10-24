import type Phaser from "phaser";

/**
 * "Play sideways" for phones with auto-rotate switched off: the page stays in portrait,
 * CSS rotates the game container 90° (see index.html), and these patches make Phaser size
 * the canvas and read touches in the rotated frame.
 */
const portrait = () => window.matchMedia("(orientation: portrait)").matches;
const rotated = () => document.body.classList.contains("rotated") && portrait();

export function setupRotation(game: Phaser.Game): void {
  const scale = game.scale as Phaser.Scale.ScaleManager & {
    getParentBounds(): boolean;
    updateCenter(): void;
    parentSize: Phaser.Structs.Size;
  };
  const originalBounds = scale.getParentBounds.bind(scale);
  // Rotated, the container's on-screen box is swapped; use its untransformed layout size instead.
  scale.getParentBounds = () => {
    if (!rotated() || !scale.parent) return originalBounds();
    const parent = scale.parent as HTMLElement;
    const w = parent.offsetWidth;
    const h = parent.offsetHeight;
    if (scale.parentSize.width === w && scale.parentSize.height === h) return false;
    scale.parentSize.setSize(w, h);
    return true;
  };

  // Centering also measures the rotated box; centre on the layout sizes instead.
  const originalCenter = scale.updateCenter.bind(scale);
  scale.updateCenter = () => {
    if (!rotated()) return originalCenter();
    const style = game.canvas.style;
    style.marginLeft = `${Math.floor((scale.parentSize.width - scale.displaySize.width) / 2)}px`;
    style.marginTop = `${Math.floor((scale.parentSize.height - scale.displaySize.height) / 2)}px`;
  };

  const input = game.input as Phaser.Input.InputManager & {
    transformPointer(pointer: Phaser.Input.Pointer, pageX: number, pageY: number, wasMove: boolean): void;
  };
  const originalTransform = input.transformPointer.bind(input);
  // Screen → game coordinates for a container rotated 90° clockwise around its top-left corner,
  // placed at the right edge of the viewport: local x = screen y, local y = viewport width − screen x.
  input.transformPointer = (pointer, pageX, pageY, wasMove) => {
    if (!rotated()) return originalTransform(pointer, pageX, pageY, wasMove);
    const canvas = game.canvas;
    pointer.prevPosition.x = pointer.position.x;
    pointer.prevPosition.y = pointer.position.y;
    // displayScale is derived from the (rotated) on-screen box, so use the layout sizes directly.
    const kx = scale.baseSize.width / scale.displaySize.width;
    const ky = scale.baseSize.height / scale.displaySize.height;
    pointer.position.x = (pageY - window.scrollY - canvas.offsetLeft) * kx;
    pointer.position.y = (window.innerWidth - (pageX - window.scrollX) - canvas.offsetTop) * ky;
  };

  // refresh() reuses the cached parent size, so re-measure the parent first.
  const refresh = () => requestAnimationFrame(() => {
    scale.getParentBounds();
    scale.refresh();
  });
  document.getElementById("play-rotated")?.addEventListener("click", () => {
    document.body.classList.add("rotated");
    refresh();
  });
  window.addEventListener("resize", refresh);
  window.addEventListener("orientationchange", refresh);
}

/** In fullscreen, ask the browser to lock landscape (works on Android Chrome, also with auto-rotate off). */
export function lockLandscape(): void {
  const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
  orientation?.lock?.("landscape").catch(() => {
    // Not supported (iOS, desktop) or refused: the sideways mode remains available.
  });
}
