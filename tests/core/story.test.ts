import { describe, expect, it } from "vitest";
import { CONTENT, PROGRESSION, WORLD_CONTENT } from "../../src/content";
import { travelPath, type WorldDef } from "../../src/core/expedition";
import { key } from "../../src/core/grid";
import { trainerSetup } from "../../src/core/progression";
import {
  applyReward, blockedTiles, completeNpc, currentGoal, failNpc, fieldMoveUsable, meets, teamOf, trainerScenario,
  type NpcDef, type ObstacleDef,
} from "../../src/core/story";
import { newGame } from "../../src/game/session";

const game = () => newGame(["charmander"]);
const leader: NpcDef = {
  id: "brock", name: "Brock", kind: "leader", pos: { x: 3, y: 1 },
  team: [{ species: "geodude", level: 10 }, { species: "onix", level: 12, heldItem: "hard-stone" }],
  reward: { money: 500, badge: "boulder", keyItems: ["tm-rock"] },
};

describe("story conditions", () => {
  it("checks flags, badges, key items and field moves", () => {
    const g = { ...game(), flags: ["a"], badges: ["boulder", "cascade"], keyItems: ["hm-cut"] };
    expect(meets(g, { flags: ["a"], badges: 2 })).toBe(true);
    expect(meets(g, { notFlags: ["a"] })).toBe(false);
    expect(meets(g, { badges: 3 })).toBe(false);
    expect(fieldMoveUsable(g, "cut")).toBe(true);
    expect(fieldMoveUsable({ ...g, badges: ["boulder"] }, "cut")).toBe(false);
    expect(meets(g, { fieldMove: "surf" })).toBe(false);
  });

  it("NPCs and unopened obstacles block their tiles", () => {
    const tree: ObstacleDef = { pos: { x: 5, y: 5 }, kind: "cut", opensIf: { fieldMove: "cut" }, text: "A small tree." };
    const g = game();
    expect([...blockedTiles(g, [leader], [tree])].sort()).toEqual([key(leader.pos), key(tree.pos)].sort());
    const cutter = { ...g, badges: ["cascade"], keyItems: ["hm-cut"] };
    expect(blockedTiles(cutter, [], [tree]).size).toBe(0);
  });

  it("beating a leader gives its badge and reward; losing to the Elite Four resets the group", () => {
    const g = completeNpc(game(), leader);
    expect(g.badges).toEqual(["boulder"]);
    expect(g.keyItems).toContain("tm-rock");
    expect(g.money).toBe(game().money + 500);
    expect(g.flags).toContain("npc:brock");
    const e1: NpcDef = { id: "lorelei", name: "Lorelei", kind: "elite", pos: { x: 0, y: 0 }, group: "e4" };
    const e2: NpcDef = { ...e1, id: "bruno", name: "Bruno" };
    const won = completeNpc(g, e1);
    expect(failNpc(won, e2, [e1, e2]).flags).not.toContain("npc:lorelei");
    expect(applyReward(g, { takesKeyItems: ["tm-rock"] }).keyItems).not.toContain("tm-rock");
  });

  it("rivals answer the player's starter", () => {
    const rival: NpcDef = { ...leader, id: "blue", kind: "rival", teamByStarter: { charmander: [{ species: "squirtle", level: 9 }] } };
    expect(teamOf({ ...game(), starter: "charmander" }, rival).map((m) => m.species)).toEqual(["squirtle"]);
    expect(teamOf({ ...game(), starter: "bulbasaur" }, rival).map((m) => m.species)).toEqual(["geodude", "onix"]);
  });

  it("trainer Pokémon are developed and carry their held items", () => {
    const arena = WORLD_CONTENT.biomes.cave!.arena!;
    const sc = trainerScenario(game(), leader, arena, (mon) => trainerSetup(CONTENT, PROGRESSION, mon), 4);
    expect(sc.enemies).toHaveLength(2);
    expect(sc.captureAllowed).toBe(false);
    const onix = trainerSetup(CONTENT, PROGRESSION, { species: "onix", level: 12, heldItem: "hard-stone" });
    const bare = trainerSetup(CONTENT, PROGRESSION, { species: "onix", level: 12 });
    expect(onix.mods!.typeDamage!.rock! / (bare.mods?.typeDamage?.rock ?? 1)).toBeCloseTo(1.2);
  });

  it("shows the first unmet goal", () => {
    expect(currentGoal({ ...game(), flags: ["s1"] }, [{ flag: "s1", text: "one" }, { flag: "s2", text: "two" }])).toBe("two");
  });
});

describe("overworld access", () => {
  const def: WorldDef = { id: "t", name: "T", rows: ["....", ".~~.", "...."], start: { x: 0, y: 1 }, spawnZones: [], pickups: [] };
  const world = { mapId: "t", pos: { x: 0, y: 1 }, fatigue: 0, lastCamp: { x: 0, y: 1 }, encounters: [], collected: [], pickups: [], rngState: 1, nextEncounterId: 1, meal: null };
  it("blocked tiles are avoided and Surf crosses water", () => {
    expect(travelPath(WORLD_CONTENT, def, world, { x: 1, y: 1 })).toBeNull();
    expect(travelPath(WORLD_CONTENT, def, world, { x: 1, y: 1 }, { blocked: new Set(), surf: true })).not.toBeNull();
    const around = travelPath(WORLD_CONTENT, def, world, { x: 3, y: 1 }, { blocked: new Set(["1,0", "1,2"]), surf: false });
    expect(around).toBeNull();
  });
});
