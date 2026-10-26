# Mastery kits (one tree per Pokémon)

Owner decisions (2026-10):
- One mastery tree per Pokémon, Wartales-style: few, weighty choices; rows of 2 options; a row pairs
  passive vs passive or skill vs skill, never mixed.
- At Lv 3 the Pokémon takes a **path** = (role, type), and the path **grants a starting skill**.
  - Single-type species choose one of their two roles; the type is their type.
  - Dual-type species have a **fixed role per species** and choose which of their two types to grow
    into (Bulbasaur is always a Tank: Grass Tank or Poison Tank; Oddish is something else, e.g. a
    Controller: Grass Controller or Poison Controller). This gives each species its own flavour.
- Names fit the type: canon Pokémon move/ability names where they fit, plain English otherwise; no
  invented jargon. Canon ability names must roughly do what the canon ability does.

## Tree template (fixed slots, max level 30)

| Level | Kind | Options |
|---|---|---|
| 3 | path choice | grants the type kit's `start` skill |
| 4 | passive | type passive 1 \| type passive 2 |
| 6 | skill | role skill 1 \| role skill 2 |
| 9 | passive | role passive 1 \| role passive 2 |
| 12 | skill | type skill 1 \| type skill 2 |
| 15 | passive | role passive 3 \| type passive 3 |
| 18 | skill | role skill 3 \| type skill 3 (the type's big move) |
| 21 | passive | type passive 4 \| role passive 4 |
| 24 | skill | type skill 4 \| role skill 4 (late-game power skills, cooldown 4–5) |
| 27 | passive | role passive 5 \| type passive 5 |
| 30 | capstone (passive) | role capstone \| type capstone |

So kits have 5 passives and 4 skills (`passives[0..4]`, `skills[0..3]`). The tree for a path is
fully determined by its role kit and type kit, plus species overrides (below).

## Species overrides (unique trees and signature slots)

`src/content/kits/species/<name>.json`:
```json
{
 "species": ["charmander", "charmeleon", "charizard"],
 "moves": {}, "talents": {},
 "start": "<optional: replaces the path's start skill>",
 "rows": { "18": ["<id>", "<id>"] }
}
```
- `species` lists a whole evolution line, so picks survive evolution.
- `rows` replaces the options of the given levels for every path of those species; a replacement
  must keep the slot's kind (passive at 4/9/15/21/27/30, skill at 6/12/18/24) and have 2 options.
- **Unique trees** (legendaries Articuno, Zapdos, Moltres, Mewtwo, Mew; Eevee line; Ditto;
  Magikarp line) override most rows (≥ 6 of 10), their start and their capstone row.
- **Signature slots** (starters lines, Pikachu line, Snorlax, Lapras, …) override one option in
  one row with the species' signature (keep the other option from the kit).

## Type-changing evolutions

If an evolution drops the path's type (Eevee normal → Vaporeon water), the path switches to the
new form's first type: talents from the old type kit (and the moves they taught) are removed, so
the type rows reopen and are chosen again from the new type kit, and the new type's start skill
is granted. Role rows are kept.

## Files

- `src/content/kits/types/<type>.json` — one per type (15: bug, dragon, electric, fighting, fire,
  flying, ghost, grass, ground, ice, normal, poison, psychic, rock, water):
  ```json
  {
   "type": "fire",
   "moves": { "<newMoveId>": { ...MoveDef } },
   "talents": { "<talentId>": { ...TalentDef } },
   "start": "<skill talent id>",
   "passives": ["<p1>", "<p2>", "<p3>"],
   "skills": ["<s1>", "<s2>", "<s3 big>"],
   "capstone": "<passive talent id>"
  }
  ```
- `src/content/kits/roles/<role>.json` — one per role (tank, striker, controller, skirmisher,
  sharpshooter): same shape with `"role"` instead of `"type"`, no `start`, and optionally new `mods`
  for the role itself (`"roleMods"`) if the role's base mods in roles.json must change.
- `src/content/kits/speciesRoles.json` — `{ "<dualTypeSpeciesId>": "<role>" }` for every dual-type
  species (fixed role, should be one of the species' `roles` in species.json unless clearly wrong).
- Hungarian: `src/content/i18n/hu/kits/types/<type>.json` / `.../roles/<role>.json` mirroring only
  `talents.<id>.description` (names stay English).

`talents` / `moves` in a kit may define new entries or reuse existing ids from
`src/content/talents.json` / `moves.json` (referencing an existing id needs no redefinition).
A talent id must be unique across all kits (prefix new ones: `fire-…`, `tank-…`).

## Rules the content must respect (current engine)

- Battles are on a **hex grid** (6 neighbours). Use "hex" in text, never "tile".
- **Movement is capped at 4 points including all bonuses** → no "+move" talents (dead). Movement
  flavour must be other effects (ignore terrain cost, free disengage, move after a KO via `koMove`).
- **Non-Bond moves reach at most 3 hexes**; `rangeBonus` only helps 1–2 range moves → avoid; use
  `shootOver` (shots pass over Pokémon) if needed.
- **Status duration bonus is capped at +2 total** → at most one talent per tree may add duration.
- **Conditional damage bonuses are additive** (sum of all bonuses, capped at +100%) → keep each
  between +10% and +25%.
- **No duplicate effects**: two talents in the same kit pair/tree must not do the same thing; avoid
  clones of the same mod across kits (e.g. five "+20% vs set-up foe" talents). Each passive should
  have a distinct trigger or effect.
- Skills grant a move (`grantsMove`). Skills are `kind: "special"` with a `cooldown` (2–4), power
  roughly 40–90 (big type skill up to ~100 with cooldown 4), range ≤ 3, follow existing moves.json
  conventions (shape single/burst/line, effects for statuses/push/pull/heal). Role skills may use
  `skillVariants.json` style per-type names via existing base moves.
- A talent's description must match its mods exactly and fit ~270px (≤ ~90 characters).
- Capstones must feel like capstones (strong, build-defining), both options in the row comparable.
- Available UnitModifiers fields: see `src/core/battle/modifiers.ts`; TalentDef: `src/core/progression/content.ts`;
  MoveDef/effects: `src/core/battle/content.ts`; player text from mods: `src/game/ui/describeEffects.ts`.
