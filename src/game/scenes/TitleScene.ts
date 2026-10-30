import Phaser from "phaser";
import { LANG, setLang } from "../../content/lang";
import { playMusic } from "../music";
import { FONT, px } from "../ui/theme";
import { DISCLAIMER, FREE_FOREVER, GAME_VERSION } from "../../core/version";
import { currentWorld, session } from "../session";
import { portraitKey } from "../sprites";
import { pixText } from "../ui/pixelFont";
import { messageFrame } from "../ui/battleBookends";
import { RichText } from "../ui/RichText";
import { Button } from "../ui/Button";
import { addFullscreenButton } from "../ui/fullscreen";
import { getVolume, setVolume, sfx } from "../audio";
import { t } from "../i18n";
import { FEEDBACK_URL, openFeedback } from "../feedback";
import { DEMO_BATTLES } from "../../content/demoBattles";

/** Width of the menu column on the right. */
const MENU_W = 200;

export class TitleScene extends Phaser.Scene {

  constructor() {
    super("Title");
  }

  create(): void {
    playMusic(this, "title");
    const { width, height } = this.scale;
    const hasSave = session.hasSave() && session.load();
    this.backdrop();
    // The name top left; the menu is a slim column on the right, so the replay behind stays in view.
    this.logo(24, 16);

    const w = MENU_W;
    const x = width - w - 20;
    // The menu's backing fades in from the left, so it sits over the replay without a hard edge.
    this.add.graphics().fillGradientStyle(0x0b1022, 0x0b1022, 0x0b1022, 0x0b1022, 0, 0.85, 0, 0.85).fillRect(x - 74, 0, 60, height)
      .fillStyle(0x0b1022, 0.85).fillRect(x - 14, 0, width - x + 14, height);
    let y = 24;
    const row = (h = 26) => (y += h + 6) - h - 6;
    if (hasSave) {
      new Button(this, x, row(30), w, 30, t("▶ Continue"), () => this.scene.start("Overworld", {})).setSolid(0x2e8b3e);
      // Who is waiting and where: the team's portraits and the map's name, under Continue.
      const team = session.game.roster.party.slice(0, 6);
      team.forEach((m, i) => {
        if (this.textures.exists(portraitKey(m.speciesId))) this.add.image(x + 2 + i * 30, y, portraitKey(m.speciesId)).setOrigin(0).setDisplaySize(26, 26);
      });
      this.add.text(x + 2, y + 30, currentWorld().name, { fontFamily: FONT, fontSize: px(11), color: "#9aa3b6" });
      y += 52;
    }
    new Button(this, x, row(), w, 26, t("✦ New game"), () => {
      if (hasSave) return this.confirmOverwrite();
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

  /** The logo in the pixel font: gold letters in a thick blue outline, bobbing gently, a sparkle now and then. */
  private logo(x: number, y: number): void {
    // A soft dark pool behind it, so the replay never shows through the letters.
    const key = "ui-vignette";
    if (!this.textures.exists(key)) {
      const tex = this.textures.createCanvas(key, 256, 256)!;
      const ctx = tex.getContext();
      const grad = ctx.createRadialGradient(128, 128, 8, 128, 128, 128);
      grad.addColorStop(0, "rgba(8,10,20,0.75)");
      grad.addColorStop(1, "rgba(8,10,20,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 256, 256);
      tex.refresh();
    }
    this.add.image(x + 140, y + 62, key).setDisplaySize(560, 260);
    const words: Phaser.GameObjects.GameObject[] = [];
    const ring = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]] as const;
    const outlined = (wx: number, wy: number, text: string, scale: number, fill: number) => {
      for (const [dx, dy] of ring) words.push(pixText(this, wx + dx * scale * 2, wy + dy * scale * 2, text, 0x10141c, scale, false));
      for (const [dx, dy] of ring) words.push(pixText(this, wx + dx * scale, wy + dy * scale, text, 0x3d7dca, scale, false));
      // Each letter light at the top, gold below, as on the classic logo.
      const top = pixText(this, wx, wy, text, 0xffffff, scale, false).setCharacterTint(0, -1, Phaser.TintModes.MULTIPLY, 0xfff6b0, 0xfff6b0, fill, fill);
      words.push(top);
      return top;
    };
    const big = outlined(0, 0, "POKÉMON", 5, 0xffcb05);
    const second = outlined(4, big.height - 6, "WILDFRONT", 4, 0xffcb05);
    words.push(pixText(this, 6, second.y + second.height - 6, t("Tactical RPG"), 0xc8d0e0, 2));
    const box = this.add.container(x, y, words);
    this.tweens.add({ targets: box, y: y + 3, duration: 1600, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    // Now and then a star glints on a letter.
    this.time.addEvent({ delay: 1400, loop: true, callback: () => {
      const sx = x + Phaser.Math.Between(10, big.width - 10), sy = box.y + Phaser.Math.Between(6, big.height + second.height - 20);
      const st = this.add.star(sx, sy, 4, 1.5, 7, 0xffffff).setBlendMode(Phaser.BlendModes.ADD).setScale(0);
      this.tweens.add({ targets: st, scale: 1.2, angle: 90, duration: 260, yoyo: true, onComplete: () => st.destroy() });
    } });
  }

  /** Starting over erases the save: asked in a box, with the safe answer as the easy one. */
  private confirmOverwrite(): void {
    const { width, height } = this.scale;
    const layer = this.add.container(0, 0).setDepth(100);
    const dim = this.add.rectangle(0, 0, width, height, 0x05070c, 0.7).setOrigin(0).setInteractive();
    const bw = 420, bh = 150, bx = (width - bw) / 2, by = (height - bh) / 2;
    const box = messageFrame(this, bx, by, bw, bh);
    const title = pixText(this, width / 2, by + 22, t("Start over?"), 0xff8a8a, 3).setOrigin(0.5);
    const text = new RichText(this, bx + 20, by + 46, bw - 40, 13);
    text.setMarkup(t("A new game erases your save: your team, items and progress are gone for good."));
    const yes = new Button(this, bx + 20, by + bh - 44, 180, 30, t("Erase and start"), () => this.scene.start("Starter")).centerLabel().setSolid(0xb0302a);
    const no = new Button(this, bx + bw - 200, by + bh - 44, 180, 30, t("Keep my save"), () => layer.destroy()).centerLabel().setHighlighted(true);
    layer.add([dim, box, title, text, yes, no]);
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
    // The footer sits on a dark strip, so it reads over any arena.
    this.add.graphics().fillGradientStyle(0x05070c, 0x05070c, 0x05070c, 0x05070c, 0, 0, 0.8, 0.8).fillRect(0, height - 90, width, 90);
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
