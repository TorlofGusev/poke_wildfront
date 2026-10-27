import { writeFileSync } from "node:fs";
import { it } from "vitest";
import { CONTENT, PROGRESSION } from "../src/content";
import { baseMovement } from "../src/core/battle";
import { memberStats } from "../src/core/progression";
import { newMember } from "../src/core/party";

/** How many species move 1/2/3 hexes at a few levels (SPEEDDIST=1, writes speeddist.txt). */
it.runIf(process.env.SPEEDDIST)("speed / movement distribution", () => {
  const out: string[] = [];
  for (const lv of [1, 5, 15, 30]) {
    const mv: Record<number, string[]> = {};
    for (const id of Object.keys(CONTENT.species)) {
      const sp = memberStats(CONTENT, PROGRESSION, newMember(CONTENT, PROGRESSION, id, 1, lv)).stats.speed;
      (mv[baseMovement(CONTENT, sp)] ??= []).push(`${id}:${sp}`);
    }
    out.push(`Lv${lv} ${Object.entries(mv).map(([k, v]) => `${k}hex=${v.length}`).join(" ")}`);
    if (lv === 1) for (const k of Object.keys(mv)) out.push(`  ${k}hex: ${mv[+k]!.join(" ")}`);
  }
  const c: Record<number, number> = {};
  for (const s of Object.values(CONTENT.species)) c[s.stats.speed] = (c[s.stats.speed] ?? 0) + 1;
  out.push(`base speed ${JSON.stringify(c)}`);
  writeFileSync("speeddist.txt", out.join("\n"));
});
