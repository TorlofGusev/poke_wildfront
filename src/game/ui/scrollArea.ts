import Phaser from "phaser";

export interface ScrollArea {
  /** True while the pointer has dragged the content (so a tap on it is not a click). */
  readonly dragged: () => boolean;
}

/**
 * A scrolling region of the screen. Everything `build` adds is laid out in world space from (x, y) downwards and seen
 * through its own camera, cut to the region; it scrolls with the wheel, by dragging (touch or mouse) and by its bar.
 * `build` returns the bottom of its content. Objects added to the scene later stay out of the region.
 */
export function scrollArea(scene: Phaser.Scene, x: number, y: number, w: number, h: number, build: () => number): ScrollArea {
  const before = new Set(scene.children.list);
  const bottom = build();
  const content = scene.children.list.filter((o) => !before.has(o));
  const cam = scene.cameras.add(x, y, w, h).setScroll(x, y);
  scene.cameras.main.ignore(content);
  cam.ignore([...before]);
  const later = (o: Phaser.GameObjects.GameObject) => cam.ignore(o);
  scene.events.on(Phaser.Scenes.Events.ADDED_TO_SCENE, later);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.events.off(Phaser.Scenes.Events.ADDED_TO_SCENE, later));
  cam.fadeIn(160, 16, 20, 28);

  const max = Math.max(y, bottom - h + 8);
  // The bar: a thin track at the right edge and a thumb as tall as the share that shows.
  const track = scene.add.rectangle(x + w - 5, y, 4, h, 0x2a3245).setOrigin(0.5, 0).setVisible(max > y);
  const thumbH = Math.max(24, (h * h) / Math.max(h, bottom - y + 8));
  const thumb = scene.add.rectangle(x + w - 5, y, 6, thumbH, 0x8a93a6).setOrigin(0.5, 0).setVisible(max > y);
  const scrollTo = (sy: number) => {
    cam.scrollY = Phaser.Math.Clamp(sy, y, max);
    thumb.y = y + ((cam.scrollY - y) / Math.max(1, max - y)) * (h - thumbH);
  };
  const inside = (p: Phaser.Input.Pointer) => p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h;
  scene.input.on("wheel", (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => inside(p) && scrollTo(cam.scrollY + dy * 0.6));
  let moved = 0;
  scene.input.on("pointerdown", () => (moved = 0));
  scene.input.on("pointermove", (p: Phaser.Input.Pointer) => {
    if (!p.isDown || !(p.downX >= x && p.downX <= x + w && p.downY >= y && p.downY <= y + h)) return;
    const dy = p.prevPosition.y - p.y;
    moved += Math.abs(dy);
    // Dragging the bar moves the thumb with the finger; dragging the content moves the content.
    scrollTo(p.downX > x + w - 16 ? cam.scrollY - dy * ((bottom - y) / h) : cam.scrollY + dy);
  });
  return { dragged: () => moved > 8 };
}
