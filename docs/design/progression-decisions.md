# Progression, economy and equipment: decisions

Confirmed by the project owner on 2026-10-24. These extend the original brief, which only asked for "basic progression", "exploration rewards" and evolution.

| Topic | Decision |
|---|---|
| Money and shop | **Pokédollars** from battles and exploration; a **Poké Mart** in towns sells Poké Balls, healing items and held items. |
| Equipment | **One held item** per Pokémon (e.g. Charcoal: more fire damage; Quick Claw: +1 movement; Leftovers: heals each turn). |
| Level-ups | **Role branch + talents** (Wartales-style): at a set level each Pokémon picks a role (e.g. Pikachu: Striker or Controller); every later level offers a choice of talents from that role. The talent pool also contains **plain stat talents** (e.g. +HP, +Attack, +Defense) that add no new mechanic, as steady filler between the rarer, game-changing talents. Evolution at set levels. Knockout counters survive evolution. |
| Moves | Pokémon **learn moves** by level; at camp the player picks which **3 moves + the basic attack** are active (like the 4 moves of the main games). |

Order of work agreed: phone playability → progression (this document) → graphics → Phase 6 (expand Kanto) → playtest.

## Implemented rules (first version)

All numbers live in `src/content/progression.json`, `roles.json`, `talents.json`, `items.json`.

- **XP**: a victory gives every deployed Pokémon `sum of defeated enemy levels × 6` XP (fainted ones too; they fought). Level L → L+1 needs `L × 30` XP. Max level 30.
- **Stats**: base × (1 + 5% per level above 1); Speed grows a third as fast so movement thresholds stay meaningful. Battle HP = HP stat × 2.
- **Roles** at level 5 (starters begin at 5, so the first choice is immediate): Tank, Striker, Controller, Skirmisher; each species offers two. From level 6 every level gives one talent pick: the role's 3 special talents (once each) or stackable stat talents (Vigor +10% HP, Power +8% Attack, Guard +8% Defense, Agility +4 Speed).
- **Moves**: species learn moves at set levels; new moves auto-activate while fewer than 3 are active. The loadout is changed in the Party screen.
- **Evolution** at set levels (15 evolutions in the current content). Knockouts, role, talents, moves and held item carry over.
- **Money**: a victory gives `sum of defeated enemy levels × ₽12`. New games start with ₽500 and 2 Potions.
- **Poké Mart** on the town tiles of the map: balls, Potion (40 HP), Super Potion (90 HP), held items (type boosters, Quick Claw, Leftovers, Muscle Band). Potions are used outside battle and cannot revive.
- **Wild levels** by biome: route 3–5, forest 3–6, mountain 7–10, cave 8–11.
