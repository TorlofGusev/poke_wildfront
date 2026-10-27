import { describe, expect, it } from "vitest";
import { WORLD, WORLD_CONTENT, WORLDS, CONTENT, PROGRESSION } from "../../src/content";
import { wildSetup } from "../../src/core/progression";
import {
  addTravelFatigue,
  biomeAt,
  changeMap,
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
  pickupKind,
  rollLoot,
  stepGroups,
  LEASH,
  type WorldDef,
  type WorldState,
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

  it("collects a pickup once; refilling ones come back elsewhere in the same area after a rest", () => {
    const clear = { ...world, encounters: [] };
    const grove = clear.pickups.find((p) => p.id === "grove-balls")!;
    const r = travel(WORLD_CONTENT, WORLD, clear, grove.pos);
    expect(r.pickedUp.map((p) => p.id)).toEqual(["grove-balls"]);
    expect(r.world.pickups.some((p) => p.id === "grove-balls")).toBe(false);
    const step = r.path.length >= 2 ? r.path[r.path.length - 2]! : clear.pos;
    const back = travel(WORLD_CONTENT, WORLD, travel(WORLD_CONTENT, WORLD, r.world, step).world, grove.pos);
    expect(back.pickedUp).toEqual([]);
    const rested = makeCamp(WORLD_CONTENT, WORLD, back.world);
    const again = rested.pickups.find((p) => p.id === "grove-balls")!;
    expect(biomeAt(WORLD_CONTENT, WORLD, again.pos).id).toBe(biomeAt(WORLD_CONTENT, WORLD, WORLD.pickups.find((p) => p.id === "grove-balls")!.pos).id);
    // One-time finds never return.
    const once = WORLD.pickups.find((p) => p.once)!;
    const took = travel(WORLD_CONTENT, WORLD, { ...rested, encounters: [] }, rested.pickups.find((p) => p.id === once.id)!.pos).world;
    expect(makeCamp(WORLD_CONTENT, WORLD, took).pickups.some((p) => p.id === once.id)).toBe(false);
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

  it("allows as many wild Pokémon as the map's deploy slots", () => {
    expect(effectiveGroup(g, 6, 4).species).toHaveLength(4);
    expect(effectiveGroup(g, 2, 4).species).toHaveLength(2);
  });
});

describe("multiple maps", () => {
  it("every map is consistent and open exits lead to passable tiles on real maps", () => {
    for (const def of Object.values(WORLDS)) {
      const grid = worldGrid(WORLD_CONTENT, def);
      const passable = (p: { x: number; y: number }) => grid.inBounds(p) && grid.terrainAt(p).moveCost !== null;
      expect(passable(def.start), def.id).toBe(true);
      for (const z of def.spawnZones) for (const p of z.points) expect(biomeAt(WORLD_CONTENT, def, p).id, `${def.id} ${key(p)}`).toBe(z.biome);
      const world = { ...newWorld(WORLD_CONTENT, def, 5), encounters: [] };
      for (const p of def.pickups) expect(travelPath(WORLD_CONTENT, def, world, p.pos), `${def.id} ${p.id}`).not.toBeNull();
      for (const e of def.exits ?? []) {
        if (!e.to) continue;
        expect(travelPath(WORLD_CONTENT, def, world, e.pos), `${def.id} exit ${e.name}`).not.toBeNull();
        const target = WORLDS[e.to]!;
        expect(target, e.to).toBeDefined();
        const arrive = e.arrive ?? target.start;
        expect(worldGrid(WORLD_CONTENT, target).terrainAt(arrive).moveCost, `${e.to} arrival`).not.toBeNull();
      }
    }
  });

  it("changing maps keeps fatigue, meal and collected pickups, and uses the zone's levels", () => {
    const from = { ...newWorld(WORLD_CONTENT, WORLD, 9), fatigue: 33, collected: ["grove-balls"] };
    const next = changeMap(WORLD_CONTENT, from, WORLDS["route-3"]!, { x: 4, y: 14 });
    expect(next).toMatchObject({ mapId: "route-3", pos: { x: 4, y: 14 }, lastCamp: { x: 4, y: 14 }, fatigue: 33, collected: ["grove-balls"] });
    expect(next.encounters.length).toBeGreaterThan(0);
    for (const g of next.encounters) {
      const zone = WORLDS["route-3"]!.spawnZones.find((z) => z.biome === g.biome)!;
      for (const lv of g.levels) expect(lv).toBeGreaterThanOrEqual(zone.levels!.min);
    }
  });
});

describe("first map difficulty", () => {
  it("never has wild Pokémon above level 3", () => {
    for (let seed = 1; seed < 30; seed++)
      for (const g of newWorld(WORLD_CONTENT, WORLD, seed).encounters) expect(Math.max(...g.levels)).toBeLessThanOrEqual(3);
  });
});

describe("loot and pickups", () => {
  it("a won battle yields at most one item from the loot table", () => {
    const table = [{ item: "a", chance: 1 }, { item: "b", chance: 1 }];
    expect(rollLoot(table, 1).item).toBe("a");
    expect(rollLoot([{ item: "a", chance: 0 }], 1).item).toBeNull();
  });

  it("pickups show what they hold: rare one-time finds, then held items, balls, healing, food", () => {
    const kind = (id: string) => ({ claw: "held", potion: "potion", berry: "food" })[id];
    const at = { id: "p", pos: { x: 0, y: 0 } };
    expect(pickupKind({ ...at, once: true, items: { berry: 1 } }, kind)).toBe("rare");
    expect(pickupKind({ ...at, items: { claw: 1, potion: 1 } }, kind)).toBe("held");
    expect(pickupKind({ ...at, balls: { "poke-ball": 1 }, items: { potion: 1 } }, kind)).toBe("ball");
    expect(pickupKind({ ...at, items: { potion: 1, berry: 1 } }, kind)).toBe("heal");
    expect(pickupKind({ ...at, items: { berry: 2 } }, kind)).toBe("food");
  });
});

describe("moving wild groups", () => {
  // A 12×3 strip of forest; the party walks along the middle row.
  const def = { ...WORLD, rows: ['""""""""""""', '""""""""""""', '""""""""""""'], exits: [], spawnZones: [] } as unknown as WorldDef;
  const base: WorldState = { ...newWorld(WORLD_CONTENT, WORLD, 1), mapId: def.id, pickups: [] };
  const group = (x: number) => ({ id: "g", pos: { x, y: 1 }, home: { x, y: 1 }, biome: "forest", species: ["pidgey"], levels: [3] });

  it("a group that sees the party stops to notice it, then closes in (slower than walking) and catches it", () => {
    let world: WorldState = { ...base, pos: { x: 0, y: 1 }, encounters: [group(3)] };
    let r = stepGroups(WORLD_CONTENT, def, world);
    // First it only notices the party.
    expect(r.world.encounters[0]).toMatchObject({ pos: { x: 3, y: 1 }, chasing: true });
    let steps = 0;
    while (!r.caught && steps < 20) {
      const before = r.world.encounters[0]!.pos.x;
      r = stepGroups(WORLD_CONTENT, def, r.world);
      expect(r.world.encounters[0]!.pos.x).toBeLessThanOrEqual(before);
      steps++;
    }
    expect(r.caught?.id).toBe("g");
    expect(steps).toBeGreaterThanOrEqual(2);
  });

  it("idle groups only wander near home, never onto the party, and the same state moves the same way", () => {
    let world: WorldState = { ...base, pos: { x: 11, y: 1 }, encounters: [group(0)] };
    for (let i = 0; i < 60; i++) {
      const r = stepGroups(WORLD_CONTENT, def, world);
      expect(r.world.encounters[0]!.chasing).toBe(false);
      expect(Math.abs(r.world.encounters[0]!.pos.x - 0) + Math.abs(r.world.encounters[0]!.pos.y - 1)).toBeLessThanOrEqual(LEASH);
      expect(stepGroups(WORLD_CONTENT, def, world)).toEqual(r);
      world = r.world;
    }
  });
});
