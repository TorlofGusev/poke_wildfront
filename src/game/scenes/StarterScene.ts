import Phaser from "phaser";
import { playMusic } from "../music";
import { playCry } from "../audio";
import { CONTENT } from "../../content";
import { session, STARTERS } from "../session";
import { animKey, footOrigin, hasSprite, portraitKey } from "../sprites";
import { Button } from "../ui/Button";
import { tag } from "../ui/markup";
import { STAT_SHORT, statLine } from "../ui/describeEffects";
import { RichText } from "../ui/RichText";
import { FONT, px, TYPE_COLORS } from "../ui/theme";
import { t } from "../i18n";
import { typeTag } from "../ui/typeName";
import { panel, screenTitle } from "../ui/frames";

/** New game: choose one starter. */
export class StarterScene extends Phaser.Scene {
  constructor() {
    super("Starter");
  }

  create(): void {
    // Screens fade in from the background colour instead of cutting.
    this.cameras.main.fadeIn(160, 16, 20, 28);
    playMusic(this, "title");
    const { width } = this.scale;
    screenTitle(this, width / 2, 28, t("Choose your first Pokémon")).setOrigin(0.5);
    this.add.text(width / 2, 58, t("Build the rest of your team by catching wild Pokémon."), { fontFamily: FONT, fontSize: px(13), color: "#8a93a6" }).setOrigin(0.5);

    const gap = 12;
    const cardW = Math.floor((width - 48 - gap * (STARTERS.length - 1)) / STARTERS.length);
    STARTERS.forEach((id, i) => {
      const s = CONTENT.species[id]!;
      const x = 24 + i * (cardW + gap);
      const y = 84;
      const frame = panel(this, x, y, cardW, 360, { edge: TYPE_COLORS[s.types[0]!] ?? 0x3a4560 });
      const bg = frame.list[1] as Phaser.GameObjects.Rectangle;
      // The Pokémon itself on a little stage in its type's colour, in its idle animation.
      const base = TYPE_COLORS[s.types[0]!] ?? 0x888888;
      this.add.ellipse(x + cardW / 2, y + 88, 96, 22, base, 0.35).setStrokeStyle(2, base, 0.8);
      let body: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image | null = null;
      if (hasSprite(id)) {
        const spr = this.add.sprite(x + cardW / 2, y + 90, `${id}-idle`).play(animKey(id, "idle", 0));
        body = spr.setOrigin(0.5, footOrigin(this, id)).setScale(spr.frame.height <= 40 ? 3 : 2);
      } else if (this.textures.exists(portraitKey(id))) body = this.add.image(x + cardW / 2, y + 52, portraitKey(id)).setDisplaySize(80, 80);
      // Pointing at a card lifts it a little and the Pokémon calls out.
      bg.setInteractive({ useHandCursor: true }).on("pointerover", () => {
        bg.setFillStyle(0x252c3e);
        playCry(this, id);
        if (body) this.tweens.add({ targets: body, y: body.y - 8, duration: 120, yoyo: true, ease: "Quad.easeOut" });
      }).on("pointerout", () => bg.setFillStyle(0x1c2130)).on("pointerdown", () => this.confirm(id));
      const ability = s.ability ? CONTENT.abilities[s.ability] : undefined;
      new RichText(this, x + 10, y + 98, cardW - 20, 11).setMarkup([
        `${tag("title", s.name)}  ${s.types.map((ty) => typeTag(ty)).join("/")}`,
        // Two even rows: the card is too narrow for all six stats on one.
        `${STAT_SHORT.hp} ${s.stats.hp}  ${statLine(s.stats).split("  ").slice(0, 2).join("  ")}`,
        statLine(s.stats).split("  ").slice(2).join("  "),
        "",
        ...s.types.map((ty) => tag("dim", CONTENT.types[ty]?.summary ?? "")),
        "",
        ability ? `${tag("special", ability.name)}: ${ability.description}` : "",
        s.evolution ? tag("dim", t("Evolves at Lv {level}", { level: s.evolution.level })) : "",
      ].filter((l, idx, arr) => l !== "" || arr[idx - 1] !== "").join("\n"));
      new Button(this, x + 12, y + 322, cardW - 24, 30, t("Choose {name}", { name: s.name }), () => this.confirm(id)).centerLabel();
    });

    new Button(this, width / 2 - 90, 496, 180, 28, t("← Back"), () => this.scene.start("Title")).centerLabel();
  }

  /** "So you want Charmander?" A choice for the whole game is asked once more; yes opens its ball. */
  private confirm(id: string): void {
    const { width, height } = this.scale;
    const s = CONTENT.species[id]!;
    const layer = this.add.container(0, 0).setDepth(100);
    const dim = this.add.rectangle(0, 0, width, height, 0x05070c, 0.72).setOrigin(0).setInteractive();
    const bw = 440, bh = 120, bx = (width - bw) / 2, by = height - bh - 40;
    const box = panel(this, bx, by, bw, bh, { edge: TYPE_COLORS[s.types[0]!] ?? 0x5a6785, edgeWidth: 2 });
    const text = new RichText(this, bx + 20, by + 16, bw - 40, 14);
    text.setMarkup(t("So you want {name}, the {type} Pokémon?", { name: tag("title", s.name), type: s.types.map((ty) => typeTag(ty)).join("/") }));
    const yes = new Button(this, bx + 20, by + bh - 46, 190, 30, t("Yes, {name}!", { name: s.name }), () => {
      layer.destroy();
      playCry(this, id);
      // The ball opens: a white flash, then the journey starts.
      this.cameras.main.flash(260, 255, 255, 255);
      session.start([id]);
      this.time.delayedCall(320, () => this.scene.start("Overworld", { intro: true }));
    }).centerLabel().setSolid(0x2e8b3e);
    const no = new Button(this, bx + bw - 210, by + bh - 46, 190, 30, t("Let me think"), () => layer.destroy()).centerLabel();
    layer.add([dim, box, text, yes, no]);
  }
}
