import Phaser from "phaser";
import { LANG, setLang } from "../../content/lang";
import { playMusic } from "../music";
import { FONT, px } from "../ui/theme";
import { DISCLAIMER, FREE_FOREVER, GAME_VERSION } from "../../core/version";
import { session } from "../session";
import { Button } from "../ui/Button";
import { addFullscreenButton } from "../ui/fullscreen";
import { getVolume, setVolume, sfx } from "../audio";
import { t } from "../i18n";
import { FEEDBACK_URL, openFeedback } from "../feedback";
import { DEMO_BATTLES } from "../../content/demoBattles";

/** Width of the menu column on the right. */
const MENU_W = 200;

export class TitleScene extends Phaser.Scene {
  private confirmNew = false;

  constructor() {
    super("Title");
  }

  create(): void {
    playMusic(this, "title");
    this.confirmNew = false;
    const { width, height } = this.scale;
    const hasSave = session.hasSave() && session.load();
    this.backdrop();
    // The name top left; the menu is a slim column on the right, so the replay behind stays in view.
    this.add.text(24, 18, "Pokémon Wildfront", { fontFamily: FONT, fontSize: "34px", color: "#f5d76e" }).setShadow(2, 2, "#000000", 4);
    this.add.text(26, 60, t("Tactical RPG"), { fontFamily: FONT, fontSize: "15px", color: "#c8d0e0" }).setShadow(1, 1, "#000000", 3);

    const w = MENU_W;
    const x = width - w - 20;
    this.add.rectangle(x - 14, 0, w + 34, height, 0x0b1022, 0.55).setOrigin(0);
    let y = 24;
    const row = (h = 26) => (y += h + 6) - h - 6;
    if (hasSave) new Button(this, x, row(), w, 26, t("▶ Continue"), () => this.scene.start("Overworld", {})).setHighlighted(true);
    const newButton = new Button(this, x, row(), w, 26, t("✦ New game"), () => {
      if (hasSave && !this.confirmNew) {
        this.confirmNew = true;
        newButton.setText(t("✦ Again to overwrite"));
        return;
      }
      this.scene.start("Starter");
    }).setHighlighted(!hasSave);
    if (hasSave) new Button(this, x, row(), w, 26, t("📖 Pokédex"), () => this.scene.start("Pokedex", { from: "Title" }));
    if (FEEDBACK_URL) new Button(this, x, row(), w, 26, t("💬 Feedback"), () => openFeedback(this.game, "title"));
    new Button(this, x, row(), w, 26, t("✨ What's new"), () => this.scene.start("WhatsNew"));
    new Button(this, x, row(), w, 26, t("ⓘ Credits"), () => this.scene.start("Credits"));
    y += 10;
    if (addFullscreenButton(this, x, y, w)) y += 34;
    this.volumeSlider(x, y + 10, w);
    y += 30;
    // Language: switching reloads, so content and texts are rebuilt in the new language.
    (["en", "hu"] as const).forEach((l, i) => {
      new Button(this, x + i * (w / 2 + 3), y, w / 2 - 3, 24, l === "en" ? "English" : "Magyar", () => {
        if (l === LANG) return;
        setLang(l);
        window.location.reload();
      }).setHighlighted(l === LANG).centerLabel();
    });
    y += 32;
    if (session.loadError) {
      this.add.text(x, y + 4, t("Your save could not be loaded ({error}).", { error: session.loadError }), {
        fontFamily: FONT, fontSize: px(11), color: "#ff6b6b", wordWrap: { width: w },
      });
    }

    // Bottom left, under the name's column: free forever, then the version and the disclaimer.
    const footW = width - MENU_W - 80;
    this.add.text(24, height - 64, `♥ ${t(FREE_FOREVER)}`, { fontFamily: FONT, fontSize: px(12), color: "#7ed321", wordWrap: { width: footW } })
      .setShadow(1, 1, "#000000", 3);
    this.add.text(24, height - 42, `v${GAME_VERSION} · ${t(DISCLAIMER)}`, { fontFamily: FONT, fontSize: px(11), color: "#9aa3b6", wordWrap: { width: footW } })
      .setShadow(1, 1, "#000000", 3);
  }

  /**
   * A recorded battle replays behind the menu, dimmed; when it ends the next one starts (in random order).
   * Without recordings: a plain dusk sky.
   */
  private backdrop(): void {
    const { width, height } = this.scale;
    if (!DEMO_BATTLES.length) {
      this.add.graphics().fillGradientStyle(0x0b1022, 0x0b1022, 0x3a2a4a, 0x3a2a4a, 1).fillRect(0, 0, width, height);
      return;
    }
    const order = Phaser.Utils.Array.Shuffle([...DEMO_BATTLES.keys()]);
    let i = 0;
    const next = () => {
      this.scene.stop("Battle");
      this.scene.launch("Battle", { demo: DEMO_BATTLES[order[i++ % order.length]!] });
      this.scene.bringToTop();
      this.scene.get("Battle").events.once("demoOver", next);
    };
    next();
    this.events.once("shutdown", () => {
      this.scene.get("Battle").events.off("demoOver", next);
      this.scene.stop("Battle");
    });
    this.add.rectangle(0, 0, width, height, 0x0b1022, 0.2).setOrigin(0);
  }

  /** Master volume: drag or tap the bar. */
  private volumeSlider(x: number, y: number, w: number): void {
    const label = this.add.text(x, y, "", { fontFamily: FONT, fontSize: px(13), color: "#c8d0e0" }).setOrigin(0, 0.5);
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
