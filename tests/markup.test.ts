import { describe, expect, it } from "vitest";
import { parseMarkup, stripMarkup, tag } from "../src/game/ui/markup";

describe("markup", () => {
  it("splits coloured and plain segments", () => {
    expect(parseMarkup(`Ember ${tag("fire", "FIRE")} hits`)).toEqual([
      { text: "Ember " }, { text: "FIRE", key: "fire" }, { text: " hits" },
    ]);
    expect(stripMarkup("{dmg|12 damage} taken")).toBe("12 damage taken");
  });

  it("keeps text with braces from breaking markup", () => {
    expect(stripMarkup(tag("num", "a{b}|c"))).toBe("abc");
  });
});
