import Phaser from "phaser";
import { playMusic } from "../music";
import { CONTENT } from "../../content";
import { MAX_PARTY_SIZE, type PartyMember } from "../../core/party";
import { session } from "../session";
import { portraitKey } from "../sprites";
import { Button } from "../ui/Button";
import { panel, screenTitle } from "../ui/frames";
import { scrollArea } from "../ui/scrollArea";
import { COLORS, FONT, TYPE_COLORS, px } from "../ui/theme";
import { typeName } from "../ui/typeName";
import { t } from "../i18n";

export type StorageSort = "dex" | "level" | "name" | "recent";

const TILE_W = 148;
const TILE_H = 54;
const COLS = 6;

/**
 * Storage, the PC box: every stored Pokémon as a tile in a scrolling grid, sorted by Pokédex number, level, name or
 * when it arrived, and filtered by type. Tap one to open its page (it can join the party from there).
 */
export class StorageScene extends Phaser.Scene {
  private sort: StorageSort = "recent";
  private type: string | null = null;

  constructor() {
    super("Storage");
  }

  init(data: { sort?: StorageSort; type?: string | null }): void {
    this.sort = data?.sort ?? this.sort;
    this.type = data?.type === undefined ? this.type : data.type;
  }

  create(): void {
    this.cameras.main.fadeIn(160, 16, 20, 28);
    playMusic(this, "overworld");
    const { storage, party } = session.game.roster;
    const title = screenTitle(this, 16, 14, t("Storage"));
    this.add.text(16 + title.width + 16, 20, t("{n} stored · party {p}/{max}", { n: storage.length, p: party.length, max: MAX_PARTY_SIZE }), {
      fontFamily: FONT, fontSize: px(13), color: COLORS.dim,
    });
    new Button(this, 824, 12, 120, 26, t("← Camp"), () => this.scene.start("Party", { rested: false, choosingMeal: false })).centerLabel();

    // Sorting.
    const again = (d: { sort?: StorageSort; type?: string | null }) => this.scene.restart({ sort: this.sort, type: this.type, ...d });
    const sortLabel = this.add.text(16, 54, t("Sort:"), { fontFamily: FONT, fontSize: px(12), color: COLORS.dim }).setOrigin(0, 0.5);
    let x = 16 + sortLabel.width + 10;
    for (const [id, label] of [["recent", t("Newest")], ["dex", t("Pokédex no.")], ["level", t("Level")], ["name", t("Name")]] as const) {
      const w = 96;
      new Button(this, x, 42, w, 24, label, () => again({ sort: id })).centerLabel().setHighlighted(this.sort === id);
      x += w + 6;
    }
    // Filtering by type: only the types somebody in storage has.
    const types = [...new Set(storage.flatMap((m) => CONTENT.species[m.speciesId]!.types))].sort();
    x = 16;
    let chipY = 74;
    const chip = (label: string, color: number | null, on: boolean, go: () => void) => {
      const probe = this.add.text(0, 0, label, { fontFamily: FONT, fontSize: "14px" });
      const w = Math.ceil(probe.width) + 22;
      probe.destroy();
      // A new row when the chips reach the edge.
      if (x + w > 944) {
        x = 16;
        chipY += 28;
      }
      const b = new Button(this, x, chipY, w, 24, label, go).centerLabel().setHighlighted(on);
      if (color !== null) b.setAccent(color);
      x += w + 4;
    };
    chip(t("All"), null, this.type === null, () => again({ type: null }));
    for (const ty of types) chip(typeName(ty), TYPE_COLORS[ty] ?? 0x888888, this.type === ty, () => again({ type: ty }));

    const GRID_Y = chipY + 36;
    const shown = this.sorted(storage.filter((m) => !this.type || CONTENT.species[m.speciesId]!.types.includes(this.type)));
    if (!shown.length) {
      this.add.text(480, 300, storage.length ? t("No stored Pokémon of this type.") : t("Storage is empty. Pokémon you catch with a full party come here."), {
        fontFamily: FONT, fontSize: px(13), color: COLORS.dim,
      }).setOrigin(0.5);
      return;
    }
    // The grid scrolls (wheel, drag or the bar); a tap that was not a drag opens the Pokémon.
    const area = scrollArea(this, 0, GRID_Y, 960, 540 - GRID_Y - 6, () => {
      shown.forEach((m, i) => this.tile(16 + (i % COLS) * (TILE_W + 6), GRID_Y + 4 + Math.floor(i / COLS) * (TILE_H + 6), m, () => area.dragged()));
      return GRID_Y + 4 + Math.ceil(shown.length / COLS) * (TILE_H + 6);
    });
  }

  private sorted(list: readonly PartyMember[]): PartyMember[] {
    const sp = (m: PartyMember) => CONTENT.species[m.speciesId]!;
    const out = [...list];
    if (this.sort === "recent") return out.reverse();
    if (this.sort === "dex") return out.sort((a, b) => (sp(a).dex ?? 0) - (sp(b).dex ?? 0) || b.level - a.level);
    if (this.sort === "level") return out.sort((a, b) => b.level - a.level || (sp(a).dex ?? 0) - (sp(b).dex ?? 0));
    return out.sort((a, b) => sp(a).name.localeCompare(sp(b).name) || b.level - a.level);
  }

  /** One stored Pokémon: portrait, name, level, type pips and knockouts. */
  private tile(x: number, y: number, m: PartyMember, dragged: () => boolean): void {
    const s = CONTENT.species[m.speciesId]!;
    const frame = panel(this, x, y, TILE_W, TILE_H, m.knockouts === 2 ? { edge: 0xd0021b, edgeWidth: 2 } : {});
    const bg = frame.list[1] as Phaser.GameObjects.Rectangle;
    if (this.textures.exists(portraitKey(m.speciesId))) this.add.image(x + 6, y + 5, portraitKey(m.speciesId)).setOrigin(0).setDisplaySize(44, 44);
    this.add.text(x + 56, y + 6, s.name, { fontFamily: FONT, fontSize: px(13), color: COLORS.text, fontStyle: "bold" }).setCrop(0, 0, TILE_W - 60, 30);
    this.add.text(x + 56, y + 25, `Lv ${m.level}`, { fontFamily: FONT, fontSize: px(12), color: "#f5d76e" });
    s.types.forEach((ty, i) => this.add.rectangle(x + TILE_W - 12 - i * 12, y + 33, 9, 9, TYPE_COLORS[ty] ?? 0x888888).setStrokeStyle(1, 0x10141c));
    if (m.knockouts) this.add.text(x + 56, y + 38, "●".repeat(m.knockouts), { fontFamily: FONT, fontSize: px(9), color: COLORS.bad });
    bg.setInteractive({ useHandCursor: true })
      .on("pointerover", () => bg.setFillStyle(0x252c3e))
      .on("pointerout", () => bg.setFillStyle(0x1c2130))
      .on("pointerup", () => !dragged() && this.scene.start("Pokemon", { uid: m.uid, from: "Storage" }));
  }
}
