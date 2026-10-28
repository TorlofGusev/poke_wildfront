import Phaser from "phaser";
import { CONTENT } from "../content";
import { session } from "./session";
import { Button } from "./ui/Button";
import { tag } from "./ui/markup";
import { RichText } from "./ui/RichText";
import { t } from "./i18n";

/** One-time tips, each shown the first time its situation comes up (and all of them again behind "?"). */
export type TipId = "battle" | "engage" | "collision" | "zones" | "capture" | "focus" | "camp" | "knockout";

const TIP_ORDER: readonly TipId[] = ["battle", "engage", "collision", "zones", "capture", "knockout", "focus", "camp"];

function tipText(id: TipId): { title: string; text: string } {
  const c = CONTENT.capture;
  switch (id) {
    case "battle": return { title: t("Your turn"), text: t("The Pokémon with the yellow ring acts. Click the field to walk, then pick a move: one basic attack per turn, skills whenever they are off cooldown, and Bond moves paid from the shared Bond bar. End the turn with End turn (Space). Tap a foe to see how far it reaches.") };
    case "engage": return { title: t("Engaged"), text: t("A melee hit locks the two Pokémon together. Stepping away gives the foe a free strike. An engaged ranged Pokémon can only scuffle (Struggle) until it steps away, so keep your melee Pokémon in front.") };
    case "collision": return { title: t("Collision"), text: t("Knocking a Pokémon into a rock or another Pokémon hurts it extra. Water moves push one step further.") };
    case "zones": return { title: t("Marked ground"), text: t("Coloured circles are burning or poisoned ground: for two turns they hurt whoever stands in them, allies too; fresh mud slows walking. Dashed outlines are strikes landing next turn, or watches that hit the first foe stepping in: step out or keep away.") };
    case "capture": return { title: t("Catch it!"), text: t("A wild Pokémon below {pct}% HP can be caught: pick a ball in the panel and throw it ({min}–{max} away, in sight). Weaker targets and better balls catch more often; the ball is used up either way.", { pct: Math.round(c.hpThreshold * 100), min: c.throwRange.min, max: c.throwRange.max }) };
    case "knockout": return { title: t("Knocked out"), text: t("A Pokémon knocked out three times is gone for good. A Revival Herb or Pokémon Center treatment clears the marks. Retreat in time if a battle turns.") };
    case "focus": return { title: t("Focus and masteries"), text: t("At Lv 3 a Pokémon chooses a focus: its stat grows every level and it learns a Bond skill. After that a row of masteries opens every few levels: one pick per row. A reset costs Pokédollars.") };
    case "camp": return { title: t("Camp"), text: t("Travelling adds fatigue, which weakens your team. Rest here with a meal: food restores HP and fatigue and gives a bonus for the next battles; resting hungry heals only part.") };
  }
}

const flag = (id: TipId) => `tip-${id}`;
const seen = (id: TipId) => session.game.flags?.includes(flag(id)) ?? false;

/** Tips waiting for a calm moment, per scene. */
const queues = new WeakMap<Phaser.Scene, TipId[]>();
const open = new WeakSet<Phaser.Scene>();

/** A tip or the help is open: keyboard shortcuts wait. */
export const tipOpen = (scene: Phaser.Scene): boolean => open.has(scene);

/** Queues a tip the player has not seen yet; `flushTips` shows it. */
export function queueTip(scene: Phaser.Scene, id: TipId): void {
  if (seen(id)) return;
  const q = queues.get(scene) ?? [];
  if (!q.includes(id)) q.push(id);
  queues.set(scene, q);
}

/** Shows the next queued tip (one at a time); call when the player can read it (not mid-animation). */
export function flushTips(scene: Phaser.Scene): void {
  if (open.has(scene)) return;
  const q = queues.get(scene) ?? [];
  const id = q.shift();
  if (!id || seen(id)) return id ? flushTips(scene) : undefined;
  session.update({ ...session.game, flags: [...(session.game.flags ?? []), flag(id)] });
  const { title, text } = tipText(id);
  showBox(scene, `${tag("title", `💡 ${title}`)}\n${text}`, 460, () => flushTips(scene));
}

/** Queues and shows at once (for scenes without animations). */
export function showTip(scene: Phaser.Scene, id: TipId): void {
  queueTip(scene, id);
  flushTips(scene);
}

/** Every tip, for the "?" button. */
export function showHelp(scene: Phaser.Scene): void {
  if (open.has(scene)) return;
  const body = TIP_ORDER.map((id) => {
    const { title, text } = tipText(id);
    return `${tag("title", title)}  ${text}`;
  }).join("\n\n");
  showBox(scene, body, 860, () => undefined, 11);
}

function showBox(scene: Phaser.Scene, markup: string, w: number, onClose: () => void, size = 13): void {
  open.add(scene);
  const { width, height } = scene.scale;
  const x = (width - w) / 2;
  const shade = scene.add.rectangle(0, 0, width, height, 0x000000, 0.45).setOrigin(0).setInteractive();
  const body = new RichText(scene, x + 16, 0, w - 32, size);
  const h = body.setMarkup(markup) + 64;
  const y = Math.max(10, (height - h) / 2);
  body.setY(y + 14);
  const frame = scene.add.rectangle(x, y, w, h, 0x10141c, 0.97).setOrigin(0).setStrokeStyle(2, 0xf5d76e);
  const box = scene.add.container(0, 0).setDepth(1000).setScrollFactor(0);
  const ok = new Button(scene, x + w / 2 - 70, y + h - 40, 140, 28, t("Got it"), () => {
    box.destroy();
    open.delete(scene);
    onClose();
  }).setHighlighted(true).centerLabel();
  box.add([shade, frame, body, ok]);
}
