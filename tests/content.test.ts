import { describe, expect, it } from "vitest";
import { deploymentErrors, lockDeployment } from "../src/core/battle";
import { applyAction } from "../src/core/battle";
import { battleArena } from "../src/core/free";
import { planTurn } from "../src/core/ai";
import { CONTENT, PROGRESSION, WORLD_CONTENT } from "../src/content";
import { maxHpOf } from "../src/core/battle";

describe("content integrity", () => {
  it("melee moves reach 1–2, ranged ones 2–4 (5 at most), and every species has its role's basic attack", () => {
    const off: string[] = [];
    for (const m of Object.values(CONTENT.moves)) {
      if (!m.reach || m.shape.kind === "line" || m.shape.kind === "cone") continue;
      if (m.reach === "melee" && (m.range.min > 1 || m.range.max > 2)) off.push(`${m.id} melee ${m.range.min}-${m.range.max}`);
      if (m.reach === "ranged" && (m.range.min !== 2 || m.range.max < 4 || m.range.max > 5)) off.push(`${m.id} ranged ${m.range.min}-${m.range.max}`);
    }
    for (const s of Object.values(CONTENT.species)) {
      const basics = s.moves.filter((m) => CONTENT.moves[m]?.kind === "basic");
      if (basics.length !== 1) off.push(`${s.id}: ${basics.length} basic attacks`);
      for (const m of s.moves) if (s.role && CONTENT.moves[m]?.reach && CONTENT.moves[m]!.reach !== s.role) off.push(`${s.id} (${s.role}) starts with ${m}`);
    }
    expect(off).toEqual([]);
  });

  it("a line's tree only teaches moves of its role", () => {
    const off: string[] = [];
    for (const [id, tree] of Object.entries(PROGRESSION.trees)) {
      const role = CONTENT.species[id]?.role;
      const rows = { ...tree.rows, ...(tree.forms?.[id]?.rows ?? {}) };
      for (const opt of [...Object.values(rows).flat(), ...tree.focus.map((f) => f.skill)]) {
        const mv = PROGRESSION.talents[opt]?.grantsMove;
        const reach = mv ? CONTENT.moves[mv]?.reach : undefined;
        if (role && reach && reach !== role) off.push(`${id} (${role}): ${mv}`);
      }
    }
    expect(off).toEqual([]);
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

  it("delayed strikes and watches are never a basic attack (they come from masteries)", () => {
    expect(Object.values(CONTENT.moves).filter((m) => m.timing && m.kind === "basic").map((m) => m.id)).toEqual([]);
  });

  it("moves are well-formed", () => {
    for (const [id, m] of Object.entries(CONTENT.moves)) {
      expect(m.id).toBe(id);
      expect(CONTENT.typeChart.chart).toHaveProperty(m.type);
      expect(m.range.min).toBeLessThanOrEqual(m.range.max);
      if (m.kind === "special") expect(m.cooldown, `${id} cooldown`).toBeGreaterThan(0);
      // Nothing hits across the board: reach (range + area, or a line's length) is at most 6.
      const reach = Math.max(m.range.max + (m.shape.kind === "burst" ? m.shape.radius : 0), m.shape.kind === "line" || m.shape.kind === "cone" ? m.shape.length : 0);
      expect(reach, `${id} reach`).toBeLessThanOrEqual(6);
      for (const e of m.effects ?? []) if (e.kind === "status") expect(CONTENT.statuses).toHaveProperty(e.status);
    }
  });

  it("a generated wild battle is completable by AI vs AI", () => {
    const party = ["bulbasaur", "charmander", "squirtle"].map((s) => ({ id: s, speciesId: s, hp: maxHpOf(CONTENT, s) }));
    const arena = battleArena(WORLD_CONTENT.biomes.forest!.arena!, "forest", 11, "wild", 3, 3);
    const scenario = {
      id: "t", field: arena.field, deploymentZone: arena.deploymentZone,
      enemies: ["rattata", "pidgey", "caterpie"].map((s, i) => ({ id: `e${i}`, speciesId: s, side: "enemy" as const, pos: arena.enemySpawns[i]! })),
    };
    const placements = party.map((m, i) => ({ unitId: m.id, pos: scenario.deploymentZone[i]! }));
    expect(deploymentErrors(scenario, party, placements)).toEqual([]);
    let { state } = lockDeployment(CONTENT, scenario, party, placements);
    for (let i = 0; i < 300 && state.outcome === "ongoing"; i++)
      for (const a of planTurn(state, CONTENT)) if (state.outcome === "ongoing") state = applyAction(state, CONTENT, a).state;
    expect(state.outcome).not.toBe("ongoing");
  });
});
