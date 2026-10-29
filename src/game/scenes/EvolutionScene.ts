import Phaser from "phaser";
import { CONTENT, PROGRESSION } from "../../content";
import { findMember, withMember } from "../../core/party";
import { evolutionDue, evolveNow, holdEvolution, readyToEvolve } from "../../core/progression";
import { playCry, sfx } from "../audio";
import { playMusic } from "../music";
import { session } from "../session";
import { animKey, hasSprite, portraitKey } from "../sprites";
import { Button } from "../ui/Button";
import { messageFrame } from "../ui/battleBookends";
import { pixText, setPixText } from "../ui/pixelFont";
import { t } from "../i18n";

export interface EvolutionData {
  /** Who evolves, one after another. */
  readonly uids: readonly string[];
  /** Where to go once all are done. */
  readonly next: string;
  readonly nextData?: object;
}

/** The party members whose evolution scene is due (level reached, not held back). */
export const evolvingUids = (): string[] => session.game.roster.party.filter((m) => readyToEvolve(CONTENT, m)).map((m) => m.uid);

/**
 * The big moment: "What? Zubat is evolving!", the white silhouette flickering between the two forms faster
 * and faster, a flash, the new form. Stopping it holds the evolution until the player starts it from the
 * Pokémon screen, so it is never asked again on every level-up.
 */
export class EvolutionScene extends Phaser.Scene {
  private data0!: EvolutionData;

  constructor() {
    super("Evolution");
  }

  init(data: EvolutionData): void {
    this.data0 = data;
  }

  create(): void {
    playMusic(this, "victory");
    const [uid, ...rest] = this.data0.uids;
    const done = () =>
      rest.length ? this.scene.restart({ ...this.data0, uids: rest }) : this.scene.start(this.data0.next, this.data0.nextData ?? {});
    const m = uid ? findMember(session.game, uid) : undefined;
    const into = m ? evolutionDue(CONTENT, m) : null;
    if (!m || !into) return void this.time.delayedCall(0, done);

    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2 - 30;
    // Deep blue fading to black round the Pokémon, and slow light rays turning behind it.
    this.add.rectangle(0, 0, width, height, 0x05070c).setOrigin(0);
    const bg = this.add.graphics();
    for (let r = 420, k = 0; r > 0; r -= 20, k++) bg.fillStyle(0x16305e, 0.05 + k * 0.004).fillCircle(cx, cy, r);
    const rays = this.add.graphics({ x: cx, y: cy });
    for (let i = 0; i < 16; i++) rays.fillStyle(0xbfd8ff, 0.08).slice(0, 0, 600, (i / 16) * Math.PI * 2, (i / 16) * Math.PI * 2 + 0.12, false).fillPath();
    this.tweens.add({ targets: rays, angle: 360, duration: 60_000, repeat: -1 });
    const glow = this.add.circle(cx, cy, 90, 0x3a5a98, 0.35);
    this.tweens.add({ targets: glow, scale: 1.15, alpha: 0.55, duration: 900, yoyo: true, repeat: -1 });
    const from = CONTENT.species[m.speciesId]!;
    const to = CONTENT.species[into]!;
    // The message box, as in battle.
    messageFrame(this.add.graphics(), 40, height - 206, width - 80, 98);
    const say = pixText(this, 60, height - 192, t("What? {name} is evolving!", { name: from.name })).setMaxWidth(width - 120);

    const oldView = this.formView(m.speciesId, cx, cy);
    const newView = this.formView(into, cx, cy).setVisible(false);
    const oldWhite = this.silhouette(m.speciesId, cx, cy).setVisible(false);
    const newWhite = this.silhouette(into, cx, cy).setVisible(false);

    let stopped = false;
    let finished = false;
    const timers: Phaser.Time.TimerEvent[] = [];
    const stop = new Button(this, cx - 90, height - 96, 180, 30, t("Stop it!"), () => {
      if (finished || stopped) return;
      stopped = true;
      timers.forEach((x) => x.remove());
      stop.destroy();
      sfx(this, "select");
      session.update(withMember(session.game, m.uid, holdEvolution));
      [oldWhite, newWhite, newView].forEach((v) => v.setVisible(false));
      oldView.setVisible(true);
      setPixText(say, t("Huh? {name} stopped evolving.\nYou can start it any time from its Pokémon screen.", { name: from.name }));
      new Button(this, cx - 90, height - 92, 180, 30, t("➜ Continue"), done);
    });

    // One second as it is, then the flicker: old and new silhouettes alternating, faster and faster, each
    // swelling into the other's size, while sparks stream in from all around.
    let at = 1200;
    timers.push(this.time.delayedCall(at, () => {
      oldView.setVisible(false);
      oldWhite.setVisible(true);
      timers.push(this.time.addEvent({ delay: 90, loop: true, callback: () => this.inward(cx, cy) }));
    }));
    at += 600;
    let showNew = false;
    const sizeOld = oldWhite.scaleX, sizeNew = newWhite.scaleX;
    for (let gap = 560; gap > 40; gap *= 0.87) {
      at += gap;
      const flip: boolean = !showNew;
      showNew = flip;
      const ms = gap;
      timers.push(this.time.delayedCall(at, () => {
        oldWhite.setVisible(!flip);
        newWhite.setVisible(flip);
        const shown = flip ? newWhite : oldWhite;
        const fromScale = flip ? sizeOld : sizeNew, toScale = flip ? sizeNew : sizeOld;
        shown.setScale(fromScale);
        this.tweens.add({ targets: shown, scale: toScale, duration: Math.max(30, ms * 0.8), ease: "Sine.easeOut" });
      }));
    }
    at += 300;
    timers.push(this.time.delayedCall(at, () => {
      finished = true;
      timers.forEach((x) => x.remove(false));
      stop.destroy();
      oldWhite.setVisible(false);
      newWhite.setVisible(true);
      const flash = this.add.rectangle(0, 0, width, height, 0xffffff).setOrigin(0).setAlpha(0);
      this.tweens.add({
        targets: flash, alpha: 1, duration: 220, yoyo: true, hold: 120,
        onYoyo: () => {
          newWhite.setVisible(false);
          newView.setVisible(true);
          this.sparkle(cx, cy);
        },
      });
      const before = findMember(session.game, m.uid)!;
      const r = evolveNow(CONTENT, PROGRESSION, before);
      session.update(withMember(session.game, m.uid, () => r.member));
      sfx(this, "levelUp");
      // The new form shows itself: two hops and its cry.
      this.time.delayedCall(700, () => {
        playCry(this, into);
        this.tweens.add({ targets: newView, y: cy - 18, duration: 140, yoyo: true, repeat: 1, ease: "Quad.easeOut" });
      });
      const learned = r.events.flatMap((e) => (e.type === "learned" ? [CONTENT.moves[e.move]!.name] : []));
      const extra = [t("+{n} points to spend", { n: PROGRESSION.rules.evolutionPoints }), ...learned.map((n) => t("learned {move}", { move: n }))].join(" · ");
      setPixText(say, `${t("Congratulations! {name} evolved into {into}!", { name: from.name, into: to.name })}\n${extra}`);
      new Button(this, cx - 90, height - 92, 180, 30, t("➜ Continue"), done);
    }));
  }

  /** The form in colour: its idle animation facing down, else the portrait. */
  private formView(speciesId: string, x: number, y: number): Phaser.GameObjects.Sprite | Phaser.GameObjects.Image {
    if (hasSprite(speciesId)) return this.add.sprite(x, y, `${speciesId}-idle`).setScale(3).play(animKey(speciesId, "idle", 0));
    return this.add.image(x, y, portraitKey(speciesId)).setDisplaySize(120, 120);
  }

  /** The form as a white shape (its first idle frame filled white), drawn once. */
  private silhouette(speciesId: string, x: number, y: number): Phaser.GameObjects.Image {
    const key = `${speciesId}-evo-white`;
    if (!this.textures.exists(key)) {
      const src = hasSprite(speciesId) ? this.textures.get(`${speciesId}-idle`) : this.textures.get(portraitKey(speciesId));
      const frame = hasSprite(speciesId) ? src.get(0) : src.get();
      const c = document.createElement("canvas");
      c.width = frame.cutWidth;
      c.height = frame.cutHeight;
      const g = c.getContext("2d")!;
      g.drawImage(src.getSourceImage() as CanvasImageSource, frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight, 0, 0, frame.cutWidth, frame.cutHeight);
      g.globalCompositeOperation = "source-in";
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, c.width, c.height);
      this.textures.addCanvas(key, c);
    }
    const img = this.add.image(x, y, key);
    return hasSprite(speciesId) ? img.setScale(3) : img.setDisplaySize(120, 120);
  }

  /** A spark drifting in from the dark towards the Pokémon. */
  private inward(x: number, y: number): void {
    const a = Math.random() * Math.PI * 2, r = 170 + Math.random() * 90;
    const s = this.add.star(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.8, 4, 1.5, 4, Math.random() < 0.5 ? 0xfff3a0 : 0xbfe0ff).setAlpha(0);
    this.tweens.add({ targets: s, x, y, alpha: { from: 0.9, to: 0.2 }, angle: 180, duration: 900, ease: "Quad.easeIn", onComplete: () => s.destroy() });
  }

  private sparkle(x: number, y: number): void {
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const s = this.add.star(x, y, 4, 2, 7, 0xfff3a0);
      this.tweens.add({ targets: s, x: x + Math.cos(a) * 120, y: y + Math.sin(a) * 100, alpha: 0, angle: 180, duration: 900, ease: "Cubic.easeOut", onComplete: () => s.destroy() });
    }
  }
}
