import Phaser from "phaser";
import { playMusic } from "../music";
import credits from "../../../CREDITS.md?raw";
import { DISCLAIMER, LEGAL_NOTICE } from "../../core/version";
import { tag } from "../ui/markup";
import { textPage, type TextSection } from "../ui/textPage";
import { t } from "../i18n";

/**
 * CREDITS.md (sprite artists, as the CC BY-NC licence requires) as a reading page: each "## " section under its
 * heading, prose joined into paragraphs, table rows as "Artist (contact): Pokémon" lines.
 */
function creditSections(): TextSection[] {
  const sections: Array<{ heading: string; paragraphs: string[]; rows: string[] }> = [];
  let prose: string[] = [];
  const flush = () => {
    if (prose.length && sections.length) sections[sections.length - 1]!.paragraphs.push(prose.join(" "));
    prose = [];
  };
  for (const l of credits.split("\n").slice(1)) {
    const line = l.trim();
    if (line.startsWith("## ")) {
      flush();
      sections.push({ heading: t(line.slice(3)), paragraphs: [], rows: [] });
    } else if (line.startsWith("|")) {
      flush();
      if (line.startsWith("|---") || line.startsWith("| Artist")) continue;
      const [artist, contact, mons] = line.split("|").slice(1, 4).map((c) => c.trim());
      sections[sections.length - 1]?.rows.push(`${tag("num", artist ?? "")}${contact ? ` ${tag("dim", contact)}` : ""}: ${mons}`);
    } else if (!line) flush();
    else {
      // Notes for developers (which script made a file) are not for players.
      const text = line.replace(/ ?(Generated|[Ff]etched) by `tools\/[^`]+`\.?/g, "").replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)").replace(/[*`]/g, "");
      if (text) prose.push(text);
    }
  }
  flush();
  return [
    { paragraphs: [t(LEGAL_NOTICE)] },
    ...sections.flatMap((s): TextSection[] => [
      { heading: s.heading, paragraphs: s.paragraphs },
      ...(s.rows.length ? [{ paragraphs: s.rows, gap: 4 }] : []),
    ]),
    { paragraphs: [t(DISCLAIMER)] },
  ];
}

export class CreditsScene extends Phaser.Scene {
  constructor() {
    super("Credits");
  }

  create(): void {
    // Screens fade in from the background colour instead of cutting.
    this.cameras.main.fadeIn(160, 16, 20, 28);
    playMusic(this, "title");
    textPage(this, t("Credits"), creditSections(), () => this.scene.start("Title"));
  }
}
