import { describe, expect, it } from "vitest";
import { formatEvent, type LogContext } from "../src/game/ui/combatLog";
import { parseMarkup, stripMarkup } from "../src/game/ui/markup";

const plain = (e: ReturnType<typeof formatEvent>) => e && { ...e, text: stripMarkup(e.text) };

const ctx: LogContext = {
  name: (id) => (id === "p" ? "Charmander" : "Foe Oddish"),
  isPlayer: (id) => id === "p",
  moveName: () => "Ember",
  statusName: () => "Poison",
  ballName: () => "Poké Ball",
  abilityName: () => "Static",
  typeOf: (id) => (id === "p" ? "fire" : "grass"),
};

describe("combat log", () => {
  it("describes attacks, damage and effectiveness", () => {
    expect(plain(formatEvent({ type: "moveUsed", unitId: "p", moveId: "ember", target: { x: 0, y: 0 }, affected: ["e"] }, ctx)))
      .toEqual({ text: "Charmander uses Ember → Foe Oddish", tone: "player" });
    expect(plain(formatEvent({ type: "damaged", unitId: "e", amount: 22, hp: 68, source: "move", effectiveness: 1.5 }, ctx))?.text)
      .toBe("Foe Oddish takes 22 damage (super effective ×1.5) — 68 HP left");
    expect(plain(formatEvent({ type: "damaged", unitId: "e", amount: 9, hp: 59, source: "status" }, ctx))?.text)
      .toBe("Foe Oddish takes 9 damage from status — 59 HP left");
  });

  it("colours names by side and damage by meaning", () => {
    const e = formatEvent({ type: "damaged", unitId: "e", amount: 22, hp: 68, source: "move" }, ctx)!;
    expect(parseMarkup(e.text).slice(0, 3)).toEqual([
      { text: "Foe Oddish", key: "foe:grass" }, { text: " takes " }, { text: "22 damage", key: "dmg" },
    ]);
  });

  it("skips bookkeeping events", () => {
    expect(formatEvent({ type: "turnEnded", unitId: "p" }, ctx)).toBeNull();
  });
});
