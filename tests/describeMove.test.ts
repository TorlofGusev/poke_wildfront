import { describe, expect, it } from "vitest";
import { CONTENT } from "../src/content";
import { describeMove } from "../src/game/ui/describeMove";
import { stripMarkup } from "../src/game/ui/markup";

describe("move descriptions", () => {
  it("describes every move", () => {
    for (const m of Object.values(CONTENT.moves)) expect(stripMarkup(describeMove(CONTENT, m))).toContain(m.name);
  });

  it("explains effects in plain words", () => {
    const text = stripMarkup(describeMove(CONTENT, CONTENT.moves["poison-powder"]!));
    expect(text).toContain("3-turn cooldown");
    expect(text).toContain("area: target tile + 1 around it");
    expect(text).toContain("Inflicts Poison for 3 turns (loses 10% max HP each turn)");
  });
});
