import { expect, it } from "vitest";
import { WORLDS, WORLD_CONTENT } from "../src/content";
import { travelPath, type WorldState } from "../src/core/expedition/world";
import { blockedTiles } from "../src/core/story/story";

it("Nugget Bridge can be crossed with every NPC still standing", () => {
  const def = WORLDS["route-24"]!;
  const world = { mapId: def.id, pos: def.start, encounters: [], fatigue: 0, collected: [], pickups: [] } as unknown as WorldState;
  const game = { flags: {}, story: {}, world } as never;
  const blocked = blockedTiles(game, def.npcs, def.obstacles);
  expect(travelPath(WORLD_CONTENT, def, world, { x: 23, y: 2 }, { blocked, surf: false })).not.toBeNull();
});
