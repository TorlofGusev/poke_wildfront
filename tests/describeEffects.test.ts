import { describe, expect, it } from "vitest";
import { CONTENT, PROGRESSION } from "../src/content";
import { describeItem, describeTalent } from "../src/game/ui/describeEffects";
import { stripMarkup } from "../src/game/ui/markup";

const plain = (lines: string[]) => lines.map(stripMarkup).join("\n");

describe("exact effect descriptions", () => {
  it("states talent numbers exactly", () => {
    expect(plain(describeTalent(CONTENT, PROGRESSION, PROGRESSION.talents["vitality-training"]!))).toBe("+1 Vitality (max HP +4)");
    expect(plain(describeTalent(CONTENT, PROGRESSION, PROGRESSION.talents["rock-power"]!))).toContain("15%");
    expect(plain(describeTalent(CONTENT, PROGRESSION, PROGRESSION.talents.leader!))).toContain("While deployed, the team starts battles with +1 Bond (base 2)");
    expect(plain(describeTalent(CONTENT, PROGRESSION, PROGRESSION.talents["skill:protect"]!))).toContain("Protect");
  });

  it("describes every talent and held item with at least one effect line", () => {
    for (const t of Object.values(PROGRESSION.talents)) expect(describeTalent(CONTENT, PROGRESSION, t).length, t.id).toBeGreaterThan(0);
    for (const i of Object.values(PROGRESSION.items)) expect(describeItem(CONTENT, i).length, i.id).toBeGreaterThan(0);
    expect(plain(describeItem(CONTENT, PROGRESSION.items.charcoal!))).toBe("Fire moves deal +20% damage");
  });
});
