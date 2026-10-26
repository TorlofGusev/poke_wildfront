import Phaser from "phaser";
import { LANG, setLang } from "../../content/lang";
import { playMusic } from "../music";
import { px } from "../ui/theme";
import { DISCLAIMER, GAME_VERSION } from "../../core/version";
import { session } from "../session";
import { Button } from "../ui/Button";
import { addFullscreenButton } from "../ui/fullscreen";
import { getVolume, setVolume, sfx } from "../audio";
import { t } from "../i18n";

export class TitleScene extends Phaser.Scene {
  private confirmNew = false;

  constructor() {
    super("Title");
  }

  create(): void {
    playMusic(this, "title");
    this.confirmNew = false;
    const { width, height } = this.scale;
    this.add
      .text(width / 2, height / 2 - 110, "Pokémon Wildfront", { fontFamily: "monospace", fontSize: "48px", color: "#f5d76e" })
      .setOrigin(0.5);
    this.add
      .text(width / 2, height / 2 - 60, t("Tactical prototype"), { fontFamily: "monospace", fontSize: "18px", color: "#c8d0e0" })
      .setOrigin(0.5);

    const hasSave = session.hasSave() && session.load();
    let y = height / 2 - 10;
    if (hasSave) {
      new Button(this, width / 2 - 140, y, 280, 32, t("▶ Continue"), () => this.scene.start("Overworld", {}));
      y += 42;
    }
    const newButton = new Button(this, width / 2 - 140, y, 280, 32, t("✦ New game"), () => {
      if (hasSave && !this.confirmNew) {
        this.confirmNew = true;
        newButton.setText(t("✦ New game: click again to overwrite"));
        return;
      }
      this.scene.start("Starter");
    });
    y += 42;
    if (addFullscreenButton(this, width / 2 - 140, y, 280)) y += 42;
    // Credits and the hex prototype share a row.
    new Button(this, width / 2 - 140, y, 136, 32, t("ⓘ Credits"), () => this.scene.start("Credits"));
    new Button(this, width / 2 + 4, y, 136, 32, t("⬢ Hex test"), () => this.scene.start("HexLab"));
    y += 42;
    this.volumeSlider(width / 2 - 140, y + 6, 280);
    y += 32;
    // Language: switching reloads, so content and texts are rebuilt in the new language.
    (["en", "hu"] as const).forEach((l, i) => {
      new Button(this, width / 2 - 140 + i * 144, y, 136, 26, l === "en" ? "English" : "Magyar", () => {
        if (l === LANG) return;
        setLang(l);
        window.location.reload();
      }).setHighlighted(l === LANG).centerLabel();
    });
    y += 36;
    if (session.loadError) {
      this.add
        .text(width / 2, y + 10, t("Your save could not be loaded ({error}).", { error: session.loadError }), {
          fontFamily: "monospace", fontSize: px(12), color: "#ff6b6b",
        })
        .setOrigin(0.5);
    }

    this.add
      .text(width / 2, height - 30, `v${GAME_VERSION} · ${DISCLAIMER}`, {
        fontFamily: "monospace", fontSize: px(11), color: "#7a8499", align: "center", wordWrap: { width: width - 40 },
      })
      .setOrigin(0.5);
  }

  /** Master volume: drag or tap the bar. */
  private volumeSlider(x: number, y: number, w: number): void {
    const label = this.add.text(x, y, "", { fontFamily: "monospace", fontSize: px(13), color: "#c8d0e0" }).setOrigin(0, 0.5);
    const barX = x + 110;
    const barW = w - 110;
    this.add.rectangle(barX, y, barW, 6, 0x2a3242).setOrigin(0, 0.5);
    const fill = this.add.rectangle(barX, y, 0, 6, 0xf5d76e).setOrigin(0, 0.5);
    const knob = this.add.circle(barX, y, 9, 0xf5d76e);
    const draw = () => {
      const v = getVolume();
      label.setText(t("♪ Volume {pct}%", { pct: Math.round(v * 100) }));
      fill.width = barW * v;
      knob.x = barX + barW * v;
    };
    const hit = this.add.zone(barX - 10, y - 14, barW + 20, 28).setOrigin(0).setInteractive({ useHandCursor: true });
    const apply = (p: Phaser.Input.Pointer) => {
      setVolume(this.game, Math.round(Math.min(1, Math.max(0, (p.x - barX) / barW)) * 20) / 20);
      draw();
    };
    hit.on("pointerdown", apply);
    hit.on("pointermove", (p: Phaser.Input.Pointer) => p.isDown && apply(p));
    hit.on("pointerup", () => sfx(this, "select"));
    draw();
  }
}
