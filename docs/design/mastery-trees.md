# Mastery trees (hand-made, one per evolution line)

Owner decisions (2026-10, Wartales-style):
- Every evolution line has **one hand-made tree** (`src/content/mastery/trees/<first-species>.json`). No
  generated role × type combinations; roles no longer exist.
- **Lv 3 — focus:** three buttons, each = **a stat + a Bond skill that fits the build**. The focus stat
  gets `focusBonus` points at once and +1 every `focusGrowthEvery` levels (progression.json); choosing it says which build the
  player wants (Defense = tank, Speed = skirmisher…). **Damage always follows the move's canon category**
  (physical = Attack, special = Sp. Atk, `category` set explicitly when the type default is wrong). A Defense
  focus gets a tanky Bond skill (guarding, taunting, a sturdy canon move), not a Defense-scaled Hydro Pump.
  The only `scaleStat` moves are the canon ones: Body Press (Defense) and Electro Ball (Speed).
  The focus also names the Pokémon's style in the UI
  (Attack = Striker, Sp. Atk = Caster, Defense = Guardian, Sp. Def = Warden, HP = Bulwark, Speed = Skirmisher).
  Pick the 3 stats that fit the Pokémon (Snorlax: HP / Attack / Defense; Alakazam: Sp. Atk / Speed / Sp. Def).
- **Cleansing** (Heal Bell, Aromatherapy, Refresh): move effect `{ "kind": "cleanse" }` removes the statuses
  foes put on the target (use `affects: "allies"` and a burst for team cleanses).
- **Rows** (fixed per line, the same whatever the focus): few, weighty choices; 2 options, at most 3 rows with 3.
  A row is all skills or all passives.

| Level | 4 | 6 | 9 | 12 | 15 | 18 | 21 | 24 | 27 | 30 |
|---|---|---|---|---|---|---|---|---|---|---|
| Kind | passive | skill | passive | skill | passive | skill (big) | passive | skill (late power) | passive | capstone passive |

- Row options should serve **different focuses** where it makes sense (a physical and a special skill in
  the same row; a defensive and an offensive passive), so each focus has a natural path through the tree.
- **Evolution lines**: `line` lists every member; picks survive evolution. A type an evolution adds
  (Charizard's Flying, Gyarados's Flying) is woven into the rows that come after the evolution level.
- **Branching evolutions** (Eevee): `forms.<speciesId>.rows` replaces rows for that form (rows after the
  evolution level); picks no longer in the tree are dropped and those rows reopen for a free pick.

## File format

```json
{
 "line": ["charmander", "charmeleon", "charizard"],
 "focus": [ { "stat": "attack", "skill": "<talent id>" }, { "stat": "spAttack", ... }, { "stat": "speed", ... } ],
 "rows": { "4": ["<id>", "<id>"], "6": [...], ..., "30": [...] },
 "forms": { "<speciesId>": { "rows": { "18": [...] } } },
 "moves": { "<lineprefix-move>": { ...MoveDef } },
 "talents": { "<lineprefix-talent>": { ...TalentDef } }
}
```
Example: `src/content/mastery/trees/charmander.json`.

- Ids defined in a tree are prefixed with the line's first species (`charmander-…`) and defined once.
- The **library** (`src/content/mastery/library/{types,roles}/*.json`, plus `src/content/talents.json` and
  `moves.json`) holds shared passives and skills; a tree may reuse a library id, but one library id may
  appear in **at most 4 trees** (tested). Prefer line-unique entries for anything iconic.
- Hungarian: `src/content/i18n/hu/mastery/trees/<file>.json` mirrors `talents.<id>.description` (and
  `name` only when the canon Hungarian name differs; normally names stay English).

## Content rules (tested in tests/core/masteryTrees.test.ts where possible)

- **Pokémon feel:** use canon moves/abilities the line actually has or plausibly would; a canon name must
  do roughly what the canon move/ability does (Swift Swim ≠ disengage). No invented jargon; plain English
  when no canon name fits. Each line should feel like that Pokémon (Snorlax: Rest, Body Slam, Thick Fat).
- Skills: `kind: "special"`, `cooldown` 2–4, power ≤ 100 (late big moves ~85–100, cd 4), reach ≤ 2, and not a
  move the line already learns by level (species.json `moves`/`learnset`). Focus Bond skills: `kind: "bond"`,
  `bondCost` 1–3, reach ≤ 3 at cost 2+, power ≤ 110.
- Hex grid: say "hex", never "tile". Movement is capped at 3 → no "+move" passives.
- **Reach** (range + burst radius, or a line's length) ≤ 2; ≤ 3 only for ultimates and Bond moves costing 2+ (tested).
- Damage bonuses are additive (cap +100%) → keep each conditional bonus +10…25%.
- Status duration bonus is capped at +2 total.
- No two options in a tree share a name or move name; avoid the same effect twice in a tree; don't make one
  option of a row strictly better than the other.
- Mods must exist in `src/core/battle/modifiers.ts` (`UnitModifiers`); descriptions ≤ ~100 characters and must
  match the mods exactly (stats in `stats` are shown automatically — don't repeat them in prose).
- Capstones (Lv 30) are build-defining and comparable to each other; start their text with "Capstone.".
