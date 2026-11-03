import Phaser from "phaser";
import { playMusic } from "../music";
import { session } from "../session";
import { AVATAR_IDS, avatarTexture, DEFAULT_AVATAR, isAvatar, poseAvatar, type AvatarId } from "../playerSprites";
import { Button } from "../ui/Button";
import { FONT, px } from "../ui/theme";
import { t } from "../i18n";
import { panel, screenTitle } from "../ui/frames";

type Next = "Starter" | "Party" | "Overworld";

/**
 * Choose your look: the ready-made trainers, each walking on its card. Before the starter in a new game, from the
 * camp at any time, and once for a save made before looks existed.
 */
export class AvatarScene extends Phaser.Scene {
  private next: Next = "Starter";
  private chosen: AvatarId = DEFAULT_AVATAR;

  constructor() {
    super("Avatar");
  }

  init(data: { next?: Next }): void {
    this.next = data?.next ?? "Starter";
    const current = this.next === "Starter" ? session.pendingAvatar : session.game.avatar;
    this.chosen = isAvatar(current) ? current : DEFAULT_AVATAR;
  }

  create(): void {
    this.cameras.main.fadeIn(160, 16, 20, 28);
    playMusic(this, this.next === "Starter" ? "title" : "overworld");
    const { width } = this.scale;
    screenTitle(this, width / 2, 28, t("Choose your look")).setOrigin(0.5);
    this.add.text(width / 2, 58, t("This is you on the map, with your lead Pokémon at your side. You can change it at camp."), { fontFamily: FONT, fontSize: px(13), color: "#8a93a6" }).setOrigin(0.5);

    const cols = 4, cardW = 196, cardH = 176, gap = 14;
    const x0 = (width - (cols * cardW + (cols - 1) * gap)) / 2;
    const frames: { id: AvatarId; bg: Phaser.GameObjects.Rectangle; figure: Phaser.GameObjects.Sprite }[] = [];
    const mark = () => frames.forEach((f) => {
      const on = f.id === this.chosen;
      f.bg.setFillStyle(on ? 0x2a3550 : 0x1c2130).setStrokeStyle(on ? 3 : 1, on ? 0xf5d76e : 0x3a4560);
      // The chosen one walks towards you; the rest stand.
      poseAvatar(f.figure, on, 0);
    });
    AVATAR_IDS.forEach((id, i) => {
      const x = x0 + (i % cols) * (cardW + gap), y = 84 + Math.floor(i / cols) * (cardH + gap);
      const frame = panel(this, x, y, cardW, cardH, { edge: 0x3a4560 });
      const bg = frame.list[1] as Phaser.GameObjects.Rectangle;
      this.add.ellipse(x + cardW / 2, y + cardH - 30, 90, 18, 0xf5d76e, 0.18);
      const figure = this.add.sprite(x + cardW / 2, y + cardH - 26, avatarTexture(this, id), 0).setOrigin(0.5, 1).setScale(8);
      frames.push({ id, bg, figure });
      // Pointing at a card turns its trainer round once: side, back, side, front.
      bg.setInteractive({ useHandCursor: true })
        .on("pointerover", () => {
          if (id !== this.chosen) poseAvatar(figure, true, 1);
        })
        .on("pointerout", () => mark())
        .on("pointerdown", () => {
          this.chosen = id;
          mark();
        });
    });
    mark();

    const by = 84 + 2 * (cardH + gap) + 6;
    new Button(this, width / 2 + 8, by, 200, 30, this.next === "Starter" ? t("That's me! →") : t("That's me!"), () => this.confirm()).centerLabel().setSolid(0x2e8b3e);
    // A save without a look must pick one: no way back from that screen.
    if (this.next !== "Overworld")
      new Button(this, width / 2 - 208, by, 200, 30, t("← Back"), () => this.scene.start(this.next === "Starter" ? "Title" : "Party", {})).centerLabel();
  }

  private confirm(): void {
    if (this.next === "Starter") {
      session.pendingAvatar = this.chosen;
      this.scene.start("Starter");
      return;
    }
    session.update({ ...session.game, avatar: this.chosen });
    this.scene.start(this.next, {});
  }
}
