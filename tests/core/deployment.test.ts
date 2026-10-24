import { describe, expect, it } from "vitest";
import { deploymentErrors, lockDeployment, type BattleScenario, type DeployCandidate } from "../../src/core/battle";
import { content } from "./fixtures";

const scenario: BattleScenario = {
  id: "test",
  mapRows: ["#....", ".....", "....."],
  deploymentZone: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 1, y: 1 }, { x: 1, y: 2 }],
  enemies: [{ id: "e", speciesId: "slow", side: "enemy", pos: { x: 4, y: 1 } }],
};

const party: DeployCandidate[] = [
  { id: "a", speciesId: "fast", hp: 40 },
  { id: "b", speciesId: "mid", hp: 20 },
  { id: "c", speciesId: "slow", hp: 40 },
  { id: "d", speciesId: "slow", hp: 40 },
  { id: "ko", speciesId: "slow", hp: 0 },
];

describe("deployment", () => {
  it("accepts up to three placements in the zone", () => {
    const placements = [
      { unitId: "a", pos: { x: 0, y: 1 } },
      { unitId: "b", pos: { x: 1, y: 1 } },
      { unitId: "c", pos: { x: 0, y: 2 } },
    ];
    expect(deploymentErrors(scenario, party, placements)).toEqual([]);
    const { state } = lockDeployment(content, scenario, party, placements);
    expect(state.units.map((u) => u.id)).toEqual(["a", "b", "c", "e"]);
    expect(state.units[1]!.hp).toBe(20);
  });

  it("rejects more than three, empty, outside-zone, impassable, duplicate and fainted placements", () => {
    expect(deploymentErrors(scenario, party, [])).toContain("deploy at least one Pokémon");
    const four = ["a", "b", "c", "d"].map((id, i) => ({ unitId: id, pos: { x: i < 3 ? 0 : 1, y: i < 3 ? i : 1 } }));
    expect(deploymentErrors(scenario, party, four)).toContain("at most 3 Pokémon can be deployed");
    expect(deploymentErrors(scenario, party, [{ unitId: "a", pos: { x: 3, y: 1 } }])).toContain("3,1 is outside the deployment zone");
    expect(deploymentErrors(scenario, party, [{ unitId: "a", pos: { x: 0, y: 0 } }])).toContain("0,0 is not passable");
    expect(deploymentErrors(scenario, party, [{ unitId: "a", pos: { x: 0, y: 1 } }, { unitId: "a", pos: { x: 0, y: 2 } }])).toContain("a is placed twice");
    expect(deploymentErrors(scenario, party, [{ unitId: "a", pos: { x: 0, y: 1 } }, { unitId: "b", pos: { x: 0, y: 1 } }])).toContain("0,1 has two Pokémon");
    expect(deploymentErrors(scenario, party, [{ unitId: "ko", pos: { x: 0, y: 1 } }])).toContain("ko cannot fight (0 HP)");
    expect(deploymentErrors(scenario, party, [{ unitId: "zz", pos: { x: 0, y: 1 } }])).toContain("zz is not in the party");
  });

  it("refuses to lock an invalid deployment", () => {
    expect(() => lockDeployment(content, scenario, party, [])).toThrow(/Invalid deployment/);
  });
});
