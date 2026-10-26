import { expect, it } from "vitest";
import { CONTENT, PROGRESSION } from "../../src/content";
import { masteryGrid, pathOptions, pathStartSkill, talentFor, resolvePath } from "../../src/core/progression";
it("every tree: 10 rows, one kind per row, no option name or move twice", () => {
  const problems = new Set<string>();
  for (const sp of Object.values(CONTENT.species))
    for (const path of pathOptions(CONTENT, PROGRESSION, { speciesId: sp.id })) {
      const rows = masteryGrid(CONTENT, PROGRESSION, sp.id, path);
      const type = resolvePath(CONTENT, sp.id, path).type;
      if (rows.length !== 10) problems.add(`${sp.id} ${path}: ${rows.length} rows`);
      const start = pathStartSkill(PROGRESSION, path, sp.id)!;
      const all = [start, ...rows.flatMap((r) => r.options)];
      const names = all.map((o) => talentFor(CONTENT, PROGRESSION, o, [type]));
      const seenN = new Map<string, string>(); const seenM = new Map<string, string>();
      names.forEach((t, i) => {
        if (seenN.has(t.name)) problems.add(`${path}${PROGRESSION.speciesKits?.[sp.id] ? "/" + sp.id : ""}: name "${t.name}" twice (${seenN.get(t.name)}, ${all[i]})`);
        seenN.set(t.name, all[i]!);
        const mv = t.grantsMove && CONTENT.moves[t.grantsMove]?.name;
        if (mv) { if (seenM.has(mv)) problems.add(`${path}: move "${mv}" twice (${seenM.get(mv)}, ${all[i]})`); seenM.set(mv, all[i]!); }
      });
      for (const r of rows) {
        const kinds = new Set(r.options.map((o) => Boolean(PROGRESSION.talents[o]?.grantsMove)));
        if (kinds.size > 1) problems.add(`${sp.id} ${path} Lv${r.level} mixed`);
        for (const o of r.options) if (!PROGRESSION.talents[o]) problems.add(`missing ${o}`);
      }
    }
  expect([...problems]).toEqual([]);
});
