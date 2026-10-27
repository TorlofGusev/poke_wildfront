import { describe, expect, it } from "vitest";
import { CONTENT } from "../../src/content";
import { powerFromCanon } from "../../src/core/battle";

describe("move power from canon", () => {
  const r = CONTENT.rules.movePower;
  it("every move with a canon power has the power the formula gives it", () => {
    const off = Object.values(CONTENT.moves).filter((m) => m.canonPower && m.power !== powerFromCanon(r, m, m.canonPower));
    expect(off.map((m) => `${m.id} ${m.power} ≠ ${powerFromCanon(r, m, m.canonPower!)}`)).toEqual([]);
    expect(Object.values(CONTENT.moves).filter((m) => m.canonPower).length).toBeGreaterThan(200);
  });

  it("keeps canon order and pays for reach, areas and spammability", () => {
    const melee = { kind: "special" as const, range: { min: 1, max: 1 }, shape: { kind: "single" as const } };
    expect(powerFromCanon(r, melee, 90)).toBeGreaterThan(powerFromCanon(r, melee, 60));
    expect(powerFromCanon(r, { ...melee, range: { min: 1, max: 2 } }, 90)).toBeLessThan(powerFromCanon(r, melee, 90));
    expect(powerFromCanon(r, { ...melee, shape: { kind: "burst", radius: 1 } }, 90)).toBeLessThan(powerFromCanon(r, melee, 90));
    expect(powerFromCanon(r, { ...melee, kind: "basic" }, 90)).toBeLessThan(powerFromCanon(r, melee, 90));
    expect(powerFromCanon(r, melee, 250)).toBe(r.max);
  });
});
