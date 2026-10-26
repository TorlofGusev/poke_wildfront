import { describe, expect, it } from "vitest";
import { planTurn } from "../src/core/ai";
import { applyAction, deploymentErrors, lockDeployment } from "../src/core/battle";
import { Grid, key } from "../src/core/grid";
import { CONTENT, SCENARIOS } from "../src/content";
import { maxHpOf } from "../src/core/battle";

describe("content integrity", () => {
  it("only Bond moves reach beyond 3 hexes", () => {
    const far = Object.values(CONTENT.moves).filter((m) => m.kind !== "bond" && m.range.max > 3).map((m) => m.id);
    expect(far).toEqual([]);
  });

  it("species reference existing types and moves; ids match keys", () => {
    for (const [id, s] of Object.entries(CONTENT.species)) {
      expect(s.id).toBe(id);
      for (const t of s.types) expect(CONTENT.typeChart.chart).toHaveProperty(t);
      for (const m of s.moves) expect(CONTENT.moves, `${id} → ${m}`).toHaveProperty(m);
      expect(s.captureBase).toBeGreaterThan(0);
      expect(s.moves.some((m) => CONTENT.moves[m]!.kind === "basic"), `${id} needs a basic move`).toBe(true);
    }
  });

  it("moves are well-formed", () => {
    for (const [id, m] of Object.entries(CONTENT.moves)) {
      expect(m.id).toBe(id);
      expect(CONTENT.typeChart.chart).toHaveProperty(m.type);
      expect(m.range.min).toBeLessThanOrEqual(m.range.max);
      if (m.kind === "special") expect(m.cooldown, `${id} cooldown`).toBeGreaterThan(0);
      for (const e of m.effects ?? []) if (e.kind === "status") expect(CONTENT.statuses).toHaveProperty(e.status);
    }
  });

  it("scenarios are valid", () => {
    for (const s of Object.values(SCENARIOS)) {
      const grid = Grid.fromAscii(s.mapRows);
      for (const p of s.deploymentZone) expect(grid.isPassable(p), key(p)).toBe(true);
      for (const e of s.enemies) {
        expect(grid.isPassable(e.pos)).toBe(true);
        expect(CONTENT.species).toHaveProperty(e.speciesId);
      }
      for (const h of s.hiddenEnemies ?? []) expect(s.enemies.map((e) => e.id)).toContain(h);
    }
  });

  it("prototype battle is completable by AI vs AI", () => {
    const PROTOTYPE_PARTY = ["bulbasaur", "charmander", "squirtle"].map((s) => ({ id: s, speciesId: s, hp: maxHpOf(CONTENT, s) }));
    const scenario = SCENARIOS["viridian-forest-ambush"]!;
    const placements = PROTOTYPE_PARTY.slice(0, 3).map((m, i) => ({ unitId: m.id, pos: scenario.deploymentZone[i * 2]! }));
    expect(deploymentErrors(scenario, PROTOTYPE_PARTY, placements)).toEqual([]);
    let { state } = lockDeployment(CONTENT, scenario, PROTOTYPE_PARTY, placements);
    for (let i = 0; i < 300 && state.outcome === "ongoing"; i++)
      for (const a of planTurn(state, CONTENT)) if (state.outcome === "ongoing") state = applyAction(state, CONTENT, a).state;
    expect(state.outcome).not.toBe("ongoing");
  });
});
