import Phaser from "phaser";
import { playMusic } from "../music";
import { playCry } from "../audio";
import { CONTENT, PROGRESSION } from "../../content";
import { PLAYTEST_TEAM, session, STARTERS } from "../session";
import { portraitKey } from "../sprites";
import { Button } from "../ui/Button";
import { tag } from "../ui/markup";
import { statLine } from "../ui/describeEffects";
import { RichText } from "../ui/RichText";
import { FONT, px } from "../ui/theme";

/** New game: choose one starter (classic), or take the fixed playtest team. */
export class StarterScene extends Phaser.Scene {
  constructor() {
    super("Starter");
  }

  create(): void {
    playMusic(this, "title");
    const { width } = this.scale;
    this.add.text(width / 2, 28, "Choose your first Pokémon", { fontFamily: FONT, fontSize: "24px", color: "#f5d76e" }).setOrigin(0.5);
    this.add.text(width / 2, 58, "Build the rest of your team by catching wild Pokémon.", { fontFamily: FONT, fontSize: px(13), color: "#8a93a6" }).setOrigin(0.5);

    const gap = 12;
    const cardW = Math.floor((width - 48 - gap * (STARTERS.length - 1)) / STARTERS.length);
    STARTERS.forEach((id, i) => {
      const s = CONTENT.species[id]!;
      const x = 24 + i * (cardW + gap);
      const y = 84;
      this.add.rectangle(x, y, cardW, 360, 0x1c2130).setOrigin(0).setStrokeStyle(1, 0x3a4560);
      if (this.textures.exists(portraitKey(id))) this.add.image(x + cardW / 2, y + 52, portraitKey(id)).setDisplaySize(80, 80);
      const ability = s.ability ? CONTENT.abilities[s.ability] : undefined;
      const roles = (s.roles ?? []).map((r) => PROGRESSION.roles[r]!.name).join(" or ");
      new RichText(this, x + 10, y + 98, cardW - 20, 11).setMarkup([
        `${tag("title", s.name)}  ${s.types.map((t) => tag(t, t)).join("/")}`,
        `HP ${s.stats.hp}  ${statLine(s.stats)}`,
        "",
        ...s.types.map((t) => tag("dim", CONTENT.types[t]?.summary ?? "")),
        "",
        ability ? `${tag("special", ability.name)}: ${ability.description}` : "",
        `Roles: ${roles}`,
        s.evolution ? tag("dim", `Evolves at Lv ${s.evolution.level}`) : "",
      ].filter((l, idx, arr) => l !== "" || arr[idx - 1] !== "").join("\n"));
      new Button(this, x + 12, y + 322, cardW - 24, 30, `Choose ${s.name}`, () => {
        playCry(this, id);
        session.start([id]);
        this.scene.start("Overworld", {});
      }).setHighlighted(true);
    });

    new Button(this, width / 2 - 200, 462, 400, 28, `Playtest: start with a fixed team of ${PLAYTEST_TEAM.length}`, () => {
      session.start(PLAYTEST_TEAM);
      this.scene.start("Overworld", {});
    });
    new Button(this, width / 2 - 200, 496, 400, 28, "← Back", () => this.scene.start("Title"));
  }
}
