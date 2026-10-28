import { describe, expect, it } from "vitest";
import { deploymentErrors, lockDeployment, type BattleScenario, type DeployCandidate } from "../../src/core/battle";
import { content } from "./fixtures";

const scenario: BattleScenario = {
  id: "test",
  field: { width: 6, height: 4, zones: [{ terrain: "rock", poly: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] }] },
  deploymentZone: [{ x: 1.5, y: 1.5 }, { x: 1.5, y: 2.5 }, { x: 2.5, y: 1.5 }, { x: 2.5, y: 2.5 }, { x: 0.5, y: 3.4 }],
  enemies: [{ id: "e", speciesId: "slow", side: "enemy", pos: { x: 5, y: 2 } }],
};

const party: DeployCandidate[] = [
  { id: "a", speciesId: "fast", hp: 40 },
  { id: "b", speciesId: "mid", hp: 20 },
  { id: "c", speciesId: "slow", hp: 40 },
  { id: "d", speciesId: "slow", hp: 40 },
  { id: "ko", speciesId: "slow", hp: 0 },
];

describe("deployment", () => {
  it("accepts up to three placements on deploy spots, on a free field", () => {
    const placements = [
      { unitId: "a", pos: { x: 1.5, y: 1.5 } },
      { unitId: "b", pos: { x: 2.5, y: 1.5 } },
      { unitId: "c", pos: { x: 1.5, y: 2.5 } },
    ];
    expect(deploymentErrors(scenario, party, placements)).toEqual([]);
    const { state } = lockDeployment(content, scenario, party, placements);
    expect(state.units.map((u) => u.id)).toEqual(["a", "b", "c", "e"]);
    expect(state.units[1]!.hp).toBe(20);
    expect(state.field).toEqual(scenario.field);
  });

  it("rejects more than three, empty, off-spot, duplicate and fainted placements", () => {
    expect(deploymentErrors(scenario, party, [])).toContain("deploy at least one Pokémon");
    const four = ["a", "b", "c", "d"].map((id, i) => ({ unitId: id, pos: scenario.deploymentZone[i]! }));
    expect(deploymentErrors(scenario, party, four)).toContain("at most 3 Pokémon can be deployed");
    expect(deploymentErrors(scenario, party, [{ unitId: "a", pos: { x: 3.5, y: 1.5 } }])).toContain("3.5,1.5 is not a deploy spot");
    expect(deploymentErrors(scenario, party, [{ unitId: "a", pos: { x: 1.5, y: 1.5 } }, { unitId: "a", pos: { x: 1.5, y: 2.5 } }])).toContain("a is placed twice");
    expect(deploymentErrors(scenario, party, [{ unitId: "a", pos: { x: 1.5, y: 1.5 } }, { unitId: "b", pos: { x: 1.5, y: 1.5 } }])).toContain("1.5,1.5 has two Pokémon");
    expect(deploymentErrors(scenario, party, [{ unitId: "ko", pos: { x: 1.5, y: 1.5 } }])).toContain("ko cannot fight (0 HP)");
    expect(deploymentErrors(scenario, party, [{ unitId: "zz", pos: { x: 1.5, y: 1.5 } }])).toContain("zz is not in the party");
  });

  it("refuses to lock an invalid deployment", () => {
    expect(() => lockDeployment(content, scenario, party, [])).toThrow(/Invalid deployment/);
  });
});
