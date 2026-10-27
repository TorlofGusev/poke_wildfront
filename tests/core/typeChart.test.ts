import { describe, expect, it } from "vitest";
import typeChart from "../../src/content/typeChart.json";
import { typeMultiplier } from "../../src/core/rules/typeChart";

describe("type chart", () => {
  it("uses softened multipliers", () => {
    expect(typeMultiplier(typeChart, "water", ["fire"])).toBe(1.5);
    expect(typeMultiplier(typeChart, "fire", ["water"])).toBe(0.75);
    expect(typeMultiplier(typeChart, "normal", ["fire"])).toBe(1);
  });

  it("has no immunities: canon no-effect pairs are a strong ×0.5 resist", () => {
    expect(typeMultiplier(typeChart, "electric", ["ground"])).toBe(0.5);
    expect(typeMultiplier(typeChart, "normal", ["ghost"])).toBe(0.5);
    expect(typeMultiplier(typeChart, "dragon", ["fairy"])).toBe(0.5);
    for (const atk of Object.keys(typeChart.chart))
      for (const def of Object.keys(typeChart.chart))
        expect(typeMultiplier(typeChart, atk, [def])).toBeGreaterThan(0);
  });

  it("is the modern 18-type chart (Let's Go): Ghost hits Psychic, Bug and Poison are neutral, Fairy hits Dragon", () => {
    expect(Object.keys(typeChart.chart)).toHaveLength(18);
    expect(typeMultiplier(typeChart, "ghost", ["psychic"])).toBe(1.5);
    expect(typeMultiplier(typeChart, "bug", ["poison"])).toBe(0.75);
    expect(typeMultiplier(typeChart, "poison", ["bug"])).toBe(1);
    expect(typeMultiplier(typeChart, "fairy", ["dragon"])).toBe(1.5);
    expect(typeMultiplier(typeChart, "steel", ["fairy"])).toBe(1.5);
  });

  it("multiplies across dual types", () => {
    expect(typeMultiplier(typeChart, "ice", ["grass", "flying"])).toBeCloseTo(2.25);
    expect(typeMultiplier(typeChart, "grass", ["poison", "flying"])).toBeCloseTo(0.5625);
  });

  it("only references known types", () => {
    const known = new Set(Object.keys(typeChart.chart));
    for (const row of Object.values(typeChart.chart))
      for (const t of [...row.strong, ...row.weak, ...((row as { immune?: string[] }).immune ?? [])]) expect(known).toContain(t);
  });

  it("rejects unknown attacking types", () => {
    expect(() => typeMultiplier(typeChart, "sound", ["normal"])).toThrow();
  });
});
