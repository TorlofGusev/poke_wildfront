import Phaser from "phaser";
import { playMusic } from "../music";
import { playCry } from "../audio";
import { CONTENT } from "../../content";
import { session, STARTERS } from "../session";
import { portraitKey } from "../sprites";
import { Button } from "../ui/Button";
import { tag } from "../ui/markup";
import { statLine } from "../ui/describeEffects";
import { RichText } from "../ui/RichText";
import { FONT, px } from "../ui/theme";
import { t } from "../i18n";
import { typeTag } from "../ui/typeName";
import { screenTitle } from "../ui/frames";

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
      this.add.rectangle(x, y, cardW, 360, 0x1c2130).setOrigin(0).setStrokeStyle(1, 0x3a4560);
      if (this.textures.exists(portraitKey(id))) this.add.image(x + cardW / 2, y + 52, portraitKey(id)).setDisplaySize(80, 80);
      const ability = s.ability ? CONTENT.abilities[s.ability] : undefined;
      new RichText(this, x + 10, y + 98, cardW - 20, 11).setMarkup([
        `${tag("title", s.name)}  ${s.types.map((ty) => typeTag(ty)).join("/")}`,
        // Two even rows: the card is too narrow for all six stats on one.
        `HP ${s.stats.hp}  ${statLine(s.stats).split("  ").slice(0, 2).join("  ")}`,
        statLine(s.stats).split("  ").slice(2).join("  "),
        "",
        ...s.types.map((ty) => tag("dim", CONTENT.types[ty]?.summary ?? "")),
        "",
        ability ? `${tag("special", ability.name)}: ${ability.description}` : "",
        s.evolution ? tag("dim", t("Evolves at Lv {level}", { level: s.evolution.level })) : "",
      ].filter((l, idx, arr) => l !== "" || arr[idx - 1] !== "").join("\n"));
      new Button(this, x + 12, y + 322, cardW - 24, 30, t("Choose {name}", { name: s.name }), () => {
        playCry(this, id);
        session.start([id]);
        this.scene.start("Overworld", { intro: true });
      }).setHighlighted(true);
    });

    new Button(this, width / 2 - 200, 496, 400, 28, t("← Back"), () => this.scene.start("Title"));
  }
}
