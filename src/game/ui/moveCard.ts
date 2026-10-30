import Phaser from "phaser";
import type { MoveDef } from "../../core/battle";
import { sfx } from "../audio";
import { t } from "../i18n";
import { baked } from "./bake";
import { pixText } from "./pixelFont";
import { FONT, TYPE_COLORS, px } from "./theme";
import { typeName } from "./typeName";

/**
 * How a move card shows. Battle: ready (full colour), noTarget (can't be used from here: dark, hatched, red ✕ note)
 * or spent (darkest, hatched: used, cooling down). Menus: ready for a move in use (with a ✓ badge when `inUse`),
 * resting for one known but not in use (dim, no hatching). `note` sits at its bottom right.
 */
export interface MoveCardLook {
  readonly state: "ready" | "noTarget" | "spent" | "resting";
  readonly note: string;
  /** A green ✓ badge on the corner: this move is in the loadout. */
  readonly inUse?: boolean;
}

/**
 * A move as a card in its type's colour, as on the handhelds: the name, a white type chip, POW and a note at the
 * right (reach, cost or state). Used by the battle panel and the Pokémon screen.
 */
export function moveCard(scene: Phaser.Scene, move: MoveDef, power: number, look: MoveCardLook, w: number, h: number, selected: boolean,
onClick: () => void, onHover: (over: boolean) => void = () => {}, clickable: "ready" | "always" = "ready"): Phaser.GameObjects.Container {
  const base = TYPE_COLORS[move.type] ?? 0x888888;
  const mix = (c: number, to: number, k: number) => {
    const ch = (sh: number) => Math.round(((c >> sh) & 255) * (1 - k) + ((to >> sh) & 255) * k);
    return (ch(16) << 16) | (ch(8) << 8) | ch(0);
  };
  const fill = look.state === "ready" ? base : look.state === "resting" ? mix(base, 0x2a3040, 0.72)
    : look.state === "noTarget" ? mix(base, 0x1c2028, 0.68) : mix(base, 0x10141c, 0.82);
  // Can't be used now: hatched, so it reads at a glance (not only on hover).
  const hatched = look.state === "noTarget" || look.state === "spent";
  // Drawn once per look into a texture (a live Graphics would re-tessellate its rounded shapes every frame).
  const g = baked(scene, `mc:${fill}:${look.state}:${selected}:${w}x${h}`, w + 4, h + 6, (b) => {
    b.translateCanvas(2, 2);
    b.fillStyle(0x000000, 0.35).fillRoundedRect(1, 3, w, h, 7);
    b.fillStyle(mix(fill, 0x000000, 0.25), 1).fillRoundedRect(0, 0, w, h, 7);
    b.fillStyle(fill, 1).fillRoundedRect(2, 2, w - 4, h - 4, 6);
    // The sheen: a lighter upper half.
    b.fillStyle(0xffffff, look.state === "spent" ? 0.05 : 0.16).fillRoundedRect(3, 3, w - 6, h / 2 - 3, { tl: 5, tr: 5, bl: 0, br: 0 });
    if (hatched) {
      b.lineStyle(2, 0x000000, 0.22);
      for (let d = 0; d < w + h; d += 8) {
        // One diagonal, kept inside the card's inner rectangle.
        const x0 = Math.min(d, w - 4), y0 = Math.max(3, d - (w - 4) + 3);
        const x1 = Math.max(3, d - (h - 6)), y1 = Math.min(h - 3, d + 3);
        if (x0 > x1) b.lineBetween(x0, y0, x1, y1);
      }
    }
    if (selected) b.lineStyle(3, 0xf5d76e, 1).strokeRoundedRect(0, 0, w, h, 7);
  }).setPosition(-2, -2);
  const dimText = look.state !== "ready";
  const name = scene.add.text(8, 5, move.name, { fontFamily: FONT, fontSize: px(12), color: dimText ? "#a4aab8" : "#ffffff", fontStyle: "bold" })
    .setStroke("#10141c", 3);
  name.setCrop(0, 0, w - (look.inUse ? 24 : 12), 30);
  // Bottom row: the type in a white chip, power, and reach or state at the right.
  const chipLabel = scene.add.text(0, 0, typeName(move.type).toUpperCase(), { fontFamily: FONT, fontSize: "9px", color: `#${mix(base, 0x000000, 0.25).toString(16).padStart(6, "0")}`, fontStyle: "bold" }).setOrigin(0.5);
  const chipW = chipLabel.width + 8;
  const chip = scene.add.rectangle(8, h - 11, chipW, 11, 0xf8f8f8, dimText ? 0.5 : 1).setOrigin(0, 0.5);
  chipLabel.setPosition(8 + chipW / 2, h - 11).setAlpha(dimText ? 0.6 : 1);
  const parts: Phaser.GameObjects.GameObject[] = [g, name, chip, chipLabel];
  // Power only where the move can be used (the note needs the room otherwise).
  if (power && (look.state === "ready" || look.state === "resting")) {
    // Power as on the handhelds' summary: a small POW, then the number.
    const pow = pixText(scene, 8 + chipW + 6, h - 11, t("POW"), dimText ? 0x8a90a0 : 0xf0f0f0, 1).setOrigin(0, 0.5);
    parts.push(pow, scene.add.text(pow.x + pow.width + 3, h - 11, String(power), { fontFamily: FONT, fontSize: px(11), color: dimText ? "#9aa0ae" : "#ffffff", fontStyle: "bold" })
      .setOrigin(0, 0.5).setStroke("#10141c", 2));
  }
  const noteColor = look.state === "noTarget" ? "#ff8a8a" : look.state === "spent" ? "#c8ccd8" : move.kind === "bond" ? "#fff3a0" : "#ffffff";
  parts.push(scene.add.text(w - 7, h - 11, look.note, { fontFamily: FONT, fontSize: px(10), color: noteColor, fontStyle: "bold" }).setOrigin(1, 0.5).setStroke("#10141c", 2));
  if (look.inUse) {
    // In the loadout: a green check badge on the top right corner.
    parts.push(scene.add.circle(w - 9, 9, 7, 0x2e9e48).setStrokeStyle(2, 0x10141c), pixText(scene, w - 9, 9, "✓", 0xffffff, 1).setOrigin(0.5));
  }
  const hover = scene.add.rectangle(0, 0, w, h, 0xffffff, 0).setOrigin(0);
  parts.push(hover);
  const card = scene.add.container(0, 0, parts).setSize(w, h);
  hover.setInteractive({ useHandCursor: true });
  hover.on("pointerover", () => {
    hover.setFillStyle(0xffffff, 0.12);
    onHover(true);
  });
  hover.on("pointerout", () => {
    hover.setFillStyle(0xffffff, 0);
    onHover(false);
  });
  hover.on("pointerdown", () => {
    // In battle only ready cards act (the rest explain themselves on hover); a menu can open any card.
    if (clickable === "ready" && look.state !== "ready") return;
    sfx(scene, "select");
    onClick();
  });
  return card;
}
