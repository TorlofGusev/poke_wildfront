import { describe, expect, it } from "vitest";
import { WORLD, WORLD_CONTENT, CONTENT, PROGRESSION } from "../../src/content";
import { wildSetup } from "../../src/core/progression";
import {
  addTravelFatigue,
  biomeAt,
  effectiveGroup,
  fatigueLevel,
  generateEncounter,
  makeCamp,
  newWorld,
  removeEncounter,
  returnToLastCamp,
  travel,
  travelPath,
  wildScenario,
  worldGrid,
  type EncounterTable,
} from "../../src/core/expedition";
import { createBattle } from "../../src/core/battle";
import { key } from "../../src/core/grid";

const rules = WORLD_CONTENT.fatigue;

describe("fatigue", () => {
  it("only penalises once the limit is reached", () => {
    // No penalty at all until the limit is reached.
    expect(fatigueLevel(rules, 0)).toMatchObject({ movePenalty: 0, damageMultiplier: 1 });
    expect(fatigueLevel(rules, 99)).toMatchObject({ movePenalty: 0, damageMultiplier: 1 });
    expect(fatigueLevel(rules, 100)).toMatchObject({ name: "Exhausted", movePenalty: 1, damageMultiplier: 0.8 });
  });

  it("accumulates per tile and caps at the maximum", () => {
    expect(addTravelFatigue(rules, 10, 3)).toBe(13);
    expect(addTravelFatigue(rules, 99, 3)).toBe(100);
  });
});

describe("encounter generation", () => {
  const table: EncounterTable = {
    groupSize: { min: 2, max: 4 },
    levels: { min: 3, max: 5 },
    entries: [{ speciesId: "a", weight: 5 }, { speciesId: "b", weight: 1, maxPerGroup: 1 }],
  };

  it("respects group size, species list and per-group limits, and reaches every species", () => {
    const seen = new Set<string>();
    let rng = 1;
    for (let i = 0; i < 500; i++) {
      const g = generateEncounter(table, rng);
      rng = g.rngState;
      expect(g.species.length).toBeGreaterThanOrEqual(2);
      expect(g.species.length).toBeLessThanOrEqual(4);
      expect(g.species.filter((s) => s === "b").length).toBeLessThanOrEqual(1);
      g.species.forEach((s) => seen.add(s));
      expect(g.levels).toHaveLength(g.species.length);
      for (const lv of g.levels) expect(lv >= 3 && lv <= 5).toBe(true);
    }
    expect(seen).toEqual(new Set(["a", "b"]));
  });

  it("is deterministic for a seed", () => {
    expect(generateEncounter(table, 99)).toEqual(generateEncounter(table, 99));
  });

  it("every biome table only lists known species and fits its arena", () => {
    for (const biome of Object.values(WORLD_CONTENT.biomes)) {
      if (!biome.encounters) continue;
      for (const e of biome.encounters.entries) expect(CONTENT.species, `${biome.id}: ${e.speciesId}`).toHaveProperty(e.speciesId);
      expect(biome.arena!.enemySpawns.length).toBeGreaterThanOrEqual(biome.encounters.groupSize.max);
    }
  });
});

describe("world", () => {
  const world = newWorld(WORLD_CONTENT, WORLD, 123);

  it("map data is consistent", () => {
    const grid = worldGrid(WORLD_CONTENT, WORLD);
    const passable = (p: { x: number; y: number }) => grid.isPassable(p);
    expect(passable(WORLD.start)).toBe(true);
    for (const p of WORLD.pickups) expect(passable(p.pos), p.id).toBe(true);
    for (const z of WORLD.spawnZones) for (const p of z.points) expect(biomeAt(WORLD_CONTENT, WORLD, p).id, key(p)).toBe(z.biome);
    for (const p of WORLD.pickups) expect(travelPath(WORLD_CONTENT, WORLD, { ...world, encounters: [] }, p.pos), p.id).not.toBeNull();
  });

  it("spawns groups in their zones with valid species", () => {
    const counts = WORLD.spawnZones.reduce((n, z) => n + z.count, 0);
    expect(world.encounters).toHaveLength(counts);
    for (const g of world.encounters) {
      expect(biomeAt(WORLD_CONTENT, WORLD, g.pos).id).toBe(g.biome);
      expect(g.species.length).toBeGreaterThan(0);
    }
    expect(newWorld(WORLD_CONTENT, WORLD, 123)).toEqual(world);
  });

  it("travel adds fatigue by terrain and only for movement", () => {
    const clear = { ...world, encounters: [] };
    const r = travel(WORLD_CONTENT, WORLD, clear, { x: 6, y: 13 }); // 3 town/route tiles east
    expect(r.path).toHaveLength(3);
    expect(r.world.fatigue).toBe(3);
    const forest = travel(WORLD_CONTENT, WORLD, r.world, { x: 7, y: 12 });
    expect(forest.world.fatigue - r.world.fatigue).toBe(1 + 2);
  });

  it("routes around wild groups unless one is the destination", () => {
    const g = { id: "g", pos: { x: 5, y: 13 }, biome: "route", species: ["pidgey"], levels: [3] };
    const w = { ...world, encounters: [g] };
    const around = travel(WORLD_CONTENT, WORLD, w, { x: 6, y: 13 });
    expect(around.path.some((p) => key(p) === "5,13")).toBe(false);
    expect(around.encounter).toBeNull();
    const into = travel(WORLD_CONTENT, WORLD, w, { x: 5, y: 13 });
    expect(into.encounter).toEqual(g);
  });

  it("collects pickups once", () => {
    const clear = { ...world, encounters: [] };
    const r = travel(WORLD_CONTENT, WORLD, clear, { x: 2, y: 2 });
    expect(r.pickedUp.map((p) => p.id)).toEqual(["grove-balls"]);
    const back = travel(WORLD_CONTENT, WORLD, travel(WORLD_CONTENT, WORLD, r.world, { x: 3, y: 4 }).world, { x: 2, y: 2 });
    expect(back.pickedUp).toEqual([]);
  });

  it("camping works anywhere: resets fatigue, respawns groups away from the party, remembers the spot", () => {
    const clear = { ...world, encounters: [] };
    const tired = travel(WORLD_CONTENT, WORLD, clear, { x: 12, y: 7 }).world;
    expect(tired.fatigue).toBeGreaterThan(0);
    const camped = makeCamp(WORLD_CONTENT, WORLD, tired);
    expect(camped).toMatchObject({ fatigue: 0, lastCamp: { x: 12, y: 7 } });
    expect(camped.encounters.length).toBeGreaterThan(0);
    for (const g of camped.encounters) expect(Math.abs(g.pos.x - 12) + Math.abs(g.pos.y - 7)).toBeGreaterThan(2);
    const back = returnToLastCamp(WORLD_CONTENT, WORLD, { ...camped, pos: { x: 6, y: 13 }, fatigue: 70 });
    expect(back).toMatchObject({ pos: { x: 12, y: 7 }, fatigue: 0 });
  });

  it("builds a valid wild battle for every spawned group", () => {
    for (const g of world.encounters) {
      const scenario = wildScenario(WORLD_CONTENT, g, (s, lv) => wildSetup(CONTENT, PROGRESSION, s, lv));
      expect(scenario.enemies.map((e) => e.level)).toEqual(g.levels);
      expect(scenario.captureAllowed).toBe(true);
      expect(() => createBattle(CONTENT, scenario.mapRows, [
        { id: "p", speciesId: "pikachu", side: "player", pos: scenario.deploymentZone[0]! },
        ...scenario.enemies,
      ])).not.toThrow();
    }
    expect(removeEncounter(world, world.encounters[0]!.id).encounters).toHaveLength(world.encounters.length - 1);
  });
});

describe("team-scaled encounters", () => {
  const g = { id: "g", pos: { x: 0, y: 0 }, biome: "route", species: ["a", "b", "c", "d"], levels: [3, 5, 4, 2] };
  it("never fields more wild Pokémon than the player's healthy team (max 3), keeping the strongest", () => {
    expect(effectiveGroup(g, 1)).toMatchObject({ species: ["b"], levels: [5] });
    expect(effectiveGroup(g, 2)).toMatchObject({ species: ["b", "c"], levels: [5, 4] });
    expect(effectiveGroup(g, 6)).toMatchObject({ species: ["a", "b", "c"], levels: [3, 5, 4] });
    expect(effectiveGroup(g, 0).species).toHaveLength(1);
  });
});
