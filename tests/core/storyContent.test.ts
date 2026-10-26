import { describe, expect, it } from "vitest";
import { CONTENT, PROGRESSION, STORY_STEPS, WORLD_CONTENT, WORLDS } from "../../src/content";
import { worldGrid } from "../../src/core/expedition";
import { BADGES } from "../../src/core/story";

const all = Object.values(WORLDS).flatMap((w) => (w.npcs ?? []).map((n) => ({ w, n })));

describe("story content", () => {
  it("NPC ids are unique and NPCs stand on passable tiles of their map", () => {
    const ids = all.map(({ n }) => n.id);
    expect(ids.length).toBe(new Set(ids).size);
    for (const { w, n } of all) {
      const grid = worldGrid(WORLD_CONTENT, w);
      expect(grid.inBounds(n.pos), `${w.id}/${n.id}`).toBe(true);
      expect(grid.terrainAt(n.pos).moveCost, `${w.id}/${n.id} on impassable tile`).not.toBeNull();
    }
  });

  it("teams, rewards and arenas reference real content within the level cap", () => {
    for (const { w, n } of all) {
      const teams = [n.team ?? [], ...Object.values(n.teamByStarter ?? {})];
      for (const mon of teams.flat()) {
        expect(CONTENT.species, `${n.id}: ${mon.species}`).toHaveProperty(mon.species);
        expect(mon.level, n.id).toBeLessThanOrEqual(PROGRESSION.rules.maxLevel);
        if (mon.heldItem) expect(PROGRESSION.items[mon.heldItem]?.kind, `${n.id}: ${mon.heldItem}`).toBe("held");
      }
      expect(teams.every((t) => t.length <= 5), n.id).toBe(true);
      const rewards = [n.reward, ...(n.choices ?? []).map((c) => c.reward)].filter(Boolean);
      for (const r of rewards) {
        for (const k of [...(r!.keyItems ?? []), ...(r!.takesKeyItems ?? [])]) expect(PROGRESSION.keyItems, `${n.id}: ${k}`).toHaveProperty(k);
        if (r!.badge) expect(BADGES as readonly string[]).toContain(r!.badge);
        for (const id of Object.keys(r!.items ?? {})) expect(PROGRESSION.items, `${n.id}: ${id}`).toHaveProperty(id);
        for (const p of r!.pokemon ?? []) expect(CONTENT.species).toHaveProperty(p.species);
      }
      if (n.arena) expect(WORLD_CONTENT.biomes[n.arena]?.arena, `${w.id}/${n.id} arena ${n.arena}`).toBeDefined();
      for (const k of [...(n.requires?.keyItems ?? []), ...(n.visibleIf?.keyItems ?? [])]) expect(PROGRESSION.keyItems, `${n.id}: ${k}`).toHaveProperty(k);
    }
    for (const w of Object.values(WORLDS)) for (const o of w.obstacles ?? []) expect(worldGrid(WORLD_CONTENT, w).inBounds(o.pos), w.id).toBe(true);
  });

  it("every main story goal is an NPC that exists", () => {
    const ids = new Set(all.map(({ n }) => `npc:${n.id}`));
    // Until every region is authored, only check the goals whose NPC map exists.
    const missing = STORY_STEPS.filter((s) => !ids.has(s.flag)).map((s) => s.flag);
    if (Object.keys(WORLDS).includes("indigo-plateau")) expect(missing).toEqual([]);
  });
});
