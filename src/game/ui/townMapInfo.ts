import { CONTENT, STORY_STEPS, WORLD_CONTENT, WORLDS } from "../../content";
import type { GameState } from "../../core/party/roster";
import { knownSpecies } from "../../core/party/roster";
import { doneFlag, isBattler, npcDone } from "../../core/story";
import { t } from "../i18n";
import { tag } from "./markup";

/** The flag a map leaves once the party has set foot on it. */
export const visitFlag = (mapId: string) => `visit:${mapId}`;

/** Maps the party has been to: visit flags, plus (for older saves) maps whose people it has dealt with. */
export function visitedMaps(g: GameState, hereId: string): Set<string> {
  const flags = new Set(g.flags ?? []);
  return new Set(Object.values(WORLDS).filter((w) =>
    w.id === hereId || flags.has(visitFlag(w.id)) || (w.npcs ?? []).some((n) => flags.has(doneFlag(n.id)))).map((w) => w.id));
}

/** The map of the current story goal (the one with the person it names), and the goal's text. */
export function goalMap(g: GameState): { mapId: string | null; text: string } | null {
  const step = STORY_STEPS.find((s) => !(g.flags ?? []).includes(s.flag));
  if (!step) return null;
  const npcId = step.flag.startsWith("npc:") ? step.flag.slice(4) : null;
  const map = npcId ? Object.values(WORLDS).find((w) => (w.npcs ?? []).some((n) => n.id === npcId)) : undefined;
  return { mapId: map?.id ?? null, text: step.text };
}

/** Wild Pokémon of a map: every spawn zone's table merged, with the level range they come in. */
function wildOf(mapId: string): { speciesId: string; min: number; max: number }[] {
  const out = new Map<string, { speciesId: string; min: number; max: number }>();
  for (const z of WORLDS[mapId]!.spawnZones ?? []) {
    const table = WORLD_CONTENT.biomes[z.biome]?.encounters;
    if (!table) continue;
    const lv = z.levels ?? table.levels;
    for (const e of table.entries) {
      const cur = out.get(e.speciesId);
      out.set(e.speciesId, { speciesId: e.speciesId, min: Math.min(cur?.min ?? lv.min, lv.min), max: Math.max(cur?.max ?? lv.max, lv.max) });
    }
  }
  return [...out.values()];
}

/** The side panel's text for one map: what is known of it once visited. */
export function mapInfo(g: GameState, mapId: string, visited: boolean): string {
  const w = WORLDS[mapId]!;
  const lines = [tag("title", w.name)];
  if (!visited) return [...lines, tag("dim", t("Not visited yet."))].join("\n");
  const known = knownSpecies(g);
  const { party, storage, fallen } = g.roster;
  const owned = new Set([...party, ...storage, ...fallen].map((m) => m.speciesId));
  const wild = wildOf(mapId);
  if (wild.length) {
    lines.push("", tag("num", t("Wild Pokémon")));
    const range = (min: number, max: number) => tag("dim", min === max ? `Lv ${min}` : `Lv ${min}-${max}`);
    for (const s of wild.filter((w) => known.has(w.speciesId))) {
      const sp = CONTENT.species[s.speciesId]!;
      lines.push(`${sp.types.map((ty) => tag(ty, "●")).join("")} ${sp.name} ${range(s.min, s.max)}${owned.has(s.speciesId) ? ` ${tag("good", "✓")}` : ""}`);
    }
    // Species not met yet: one line, how many and at what levels.
    const unknown = wild.filter((w) => !known.has(w.speciesId));
    if (unknown.length) lines.push(`${tag("dim", t("??? ×{n} not met yet", { n: unknown.length }))} ${range(Math.min(...unknown.map((u) => u.min)), Math.max(...unknown.map((u) => u.max)))}`);
  }
  const battlers = (w.npcs ?? []).filter((n) => isBattler(n) && n.kind !== "wild");
  const leader = battlers.find((n) => n.kind === "leader");
  if (leader) {
    const types = [...new Set((leader.team ?? []).flatMap((m) => CONTENT.species[m.species]?.types ?? []))].slice(0, 2);
    lines.push("", `${tag("num", t("Gym"))} ${leader.name} ${types.map((ty) => tag(ty, "●")).join("")} ${npcDone(g, leader) ? tag("good", t("badge won ✓")) : tag("bad", t("not yet beaten"))}`);
  }
  if (battlers.length) lines.push(`${tag("num", t("Trainers"))} ${battlers.filter((n) => npcDone(g, n)).length}/${battlers.length} ${t("beaten")}`);
  const townChar = WORLD_CONTENT.biomes.town?.char;
  if (townChar && w.rows.some((r) => r.includes(townChar))) lines.push(`${tag("num", t("Services"))} ${t("Pokémon Center · Poké Mart")}`);
  const left = (w.pickups ?? []).filter((p) => p.once && !g.world.collected.includes(p.id)).length;
  if (left) lines.push(`${tag("num", t("Items"))} ${t("{n} still to find", { n: left })}`);
  const exits = (w.exits ?? []).filter((e) => e.to && WORLDS[e.to]).map((e) => e.name);
  if (exits.length) lines.push("", `${tag("num", t("Roads"))} ${[...new Set(exits)].join(" · ")}`);
  return lines.join("\n");
}
