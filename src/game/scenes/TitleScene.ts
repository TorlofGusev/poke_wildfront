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
import { CONTENT } from "../../content";
import { animKey, FACE_RIGHT, hasSprite } from "../sprites";

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
    this.backdrop(hasSave ? session.game.roster.party.map((m) => m.speciesId) : []);
    this.add
      .text(width / 2, height / 2 - 110, "Pokémon Wildfront", { fontFamily: "monospace", fontSize: "48px", color: "#f5d76e" })
      .setOrigin(0.5);
    this.add
      .text(width / 2, height / 2 - 60, t("Tactical RPG"), { fontFamily: "monospace", fontSize: "18px", color: "#c8d0e0" })
      .setOrigin(0.5);

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
    if (hasSave) {
      new Button(this, width / 2 - 140, y, 136, 32, t("📖 Pokédex"), () => this.scene.start("Pokedex", { from: "Title" }));
      new Button(this, width / 2 + 4, y, 136, 32, t("ⓘ Credits"), () => this.scene.start("Credits"));
    } else new Button(this, width / 2 - 140, y, 280, 32, t("ⓘ Credits"), () => this.scene.start("Credits"));
    y += 42;
    // Experimental battle with free movement instead of hexes.
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
      .text(width / 2, height - 30, `v${GAME_VERSION} · ${t(DISCLAIMER)}`, {
        fontFamily: "monospace", fontSize: px(11), color: "#7a8499", align: "center", wordWrap: { width: width - 40 },
      })
      .setOrigin(0.5);
  }

  /**
   * Dusk over the hills: a sky gradient with twinkling stars, two ridges, and Pokémon (the party, or a few
   * wild ones) walking along the path at the bottom, round and round.
   */
  private backdrop(party: readonly string[]): void {
    const { width, height } = this.scale;
    const sky = this.add.graphics();
    sky.fillGradientStyle(0x0b1022, 0x0b1022, 0x3a2a4a, 0x3a2a4a, 1);
    sky.fillRect(0, 0, width, height);
    const rnd = new Phaser.Math.RandomDataGenerator(["wildfront"]);
    for (let i = 0; i < 70; i++) {
      const star = this.add.circle(rnd.between(0, width), rnd.between(0, height * 0.55), rnd.realInRange(0.6, 1.6), 0xffffff, rnd.realInRange(0.3, 0.9));
      this.tweens.add({ targets: star, alpha: 0.1, duration: rnd.between(1200, 3200), yoyo: true, repeat: -1, delay: rnd.between(0, 2000) });
    }
    const ridge = (base: number, amp: number, color: number, seed: number) => {
      const g = this.add.graphics().fillStyle(color, 1);
      const pts = [new Phaser.Math.Vector2(0, height)];
      for (let x = 0; x <= width; x += 16) pts.push(new Phaser.Math.Vector2(x, base - amp * (Math.sin(x / 90 + seed) * 0.6 + Math.sin(x / 37 + seed * 2) * 0.25)));
      pts.push(new Phaser.Math.Vector2(width, height));
      g.fillPoints(pts, true);
    };
    ridge(height - 120, 30, 0x1d2238, 1);
    ridge(height - 70, 18, 0x14291f, 4);
    this.add.rectangle(0, height - 52, width, 52, 0x10200f).setOrigin(0);

    // Walkers: the party, else a few Pokémon that still evolve.
    const pool = party.filter(hasSprite);
    const ids = pool.length ? pool.slice(0, 6) : rnd.shuffle(Object.keys(CONTENT.species).filter((id) => hasSprite(id) && CONTENT.species[id]!.evolution)).slice(0, 5);
    ids.forEach((id, i) => {
      const s = this.add.sprite(-40 - i * 90, height - 52, `${id}-walk`).setOrigin(0.5, 0.85).setScale(1.5).play(animKey(id, "walk", FACE_RIGHT)).setAlpha(0.9);
      const lap = (width + 80 + ids.length * 90) * 18;
      this.tweens.add({ targets: s, x: width + 40 + (ids.length - 1 - i) * 90, duration: lap, repeat: -1 });
    });
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
