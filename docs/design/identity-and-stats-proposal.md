# Proposal: type playstyles, small stats, stat points, abilities and talents

Status: **proposal, awaiting the owner's approval** (2026-10-24). Replaces the percentage-based stat growth of the first progression version.

## Goals (from the owner)

1. Each type defines a **playstyle**, and the playstyle defines the **stats**.
2. Stats are **small numbers** (single digits at the start), so +1 / +2 steps matter.
3. **No automatic stat growth.** Every level gives **1 stat point**; a **resource** can make it **2** (Wartales-style).
4. Talents include **filler** (small, stat-like) and talents that **unlock new skills**.
5. With 151 Pokémon, species must not become reskins: something unique per species/line is needed.

## Four layers of identity

| Layer | Comes from | What it gives | Example (Charmander) |
|---|---|---|---|
| 1. Type playstyle | its type(s) | starting stats + a type mechanic on its moves | Fire: striker profile, moves can **Burn** |
| 2. Ability | species line (as in the main games) | one innate passive, unique per line | **Blaze**: +30% Fire damage below half HP |
| 3. Role | chosen at Lv 5 (2 options per species) | talent tree: filler + skill-unlocking talents | Striker or Skirmisher |
| 4. Stat points | player, every level | +1 (or +2 with a vitamin) to any stat | all into Speed for a hit-and-run Charmander |

Abilities are the answer to "151 reskins": the main games already give almost every evolution line its own passive (Overgrow, Static, Sturdy, Keen Eye, Shield Dust, Arena Trap…). They are data, one per line (~80 lines in Kanto), and are added gradually with the content. Combined with the move list and the 2 role options, two Pokémon of the same type play differently.

## Stats

Four stats, small numbers. Starting values (Lv 1) come from the type profile; dual types average the two profiles (rounded); the species adds a **±1 nudge** to match its character (Geodude +1 Def, Rattata +1 Spe).

| Stat | Effect |
|---|---|
| **HP** | Max HP = 30 + 6 × HP |
| **Attack** | Damage = power × (10 + Atk) / (10 + Def of target) × type × modifiers / 4 |
| **Defense** | see Attack (each point ≈ −5% damage taken at low values) |
| **Speed** | Movement = 3 + ⌊Speed / 3⌋ (max 6); turn order |

Worked example: Atk 5 vs Def 5, power 40 → 10 damage; a Pokémon with HP 5 has 60 HP → about 6 hits. One extra Attack point ≈ +7% damage; three extra Speed points = +1 tile of movement.

### Stat points

- **+1 point per level**, spent freely in the Party screen.
- **Vitamins** (HP Up, Protein, Iron, Carbos) are the resource: using one with a level's point makes it **+2 in that vitamin's stat**. Rare: found on the map, given by trainers/gyms, expensive in the Poké Mart.
- **Evolution** grants +2 free points (and may change type → new type mechanic, e.g. Butterfree gains Flying).
- Points can be reset at a Pokémon Center for money (optional, later).

## Type playstyles (Gen 1 types)

Profiles are Lv 1 values (HP / Atk / Def / Spe, total 20). Every type mechanic is deterministic and is clearly shown in move descriptions.

| Type | Playstyle | HP/Atk/Def/Spe | Type mechanic |
|---|---|---|---|
| Normal | adaptable generalist | 5/5/5/5 | Normal moves are never resisted (always ×1) |
| Fire | burst striker | 4/7/3/6 | **Burn**: damage each turn, burned target deals −20% damage |
| Water | displacement, sustain | 6/5/5/4 | Water moves push 1 extra tile |
| Grass | drain and control | 6/4/5/5 | **Drain**: heals the user for 25% of damage dealt |
| Electric | fast skirmisher | 3/6/3/8 | **Paralysis**: target cannot move on its next turn (can still act) |
| Ice | lockdown control | 5/5/4/6 | **Freeze**: target cannot act on its next turn (can still move) |
| Fighting | melee bruiser | 6/7/4/3 | **Flank**: +25% damage if an ally is adjacent to the target |
| Poison | attrition | 5/4/5/6 | **Poison** stacks (each application adds a turn) |
| Ground | terrain shaper | 6/6/6/2 | Ground moves turn target tiles into mud (2 movement) |
| Flying | mobility | 4/5/3/8 | moves over units, water and mud at normal cost |
| Psychic | ranged manipulation | 4/7/3/6 | Psychic moves can swap or pull at range |
| Bug | swarm tactics | 4/5/4/7 | **Swarm**: +10% damage per ally adjacent to the target (any type) |
| Rock | fortress | 6/6/8/0 | cannot be pushed or pulled; can raise rock tiles |
| Ghost | trickster | 4/6/3/7 | moves through units; **Curse**: target takes +25% damage |
| Dragon | rare all-rounder | 6/7/5/2* | dragon moves ignore Defense (*plus a species nudge) |

Synergies come from positioning and roles (Fighting wants an ally next to the target, Bug rewards surrounding, Water and Psychic set those up), never from having several Pokémon of the same type, as the brief requires.

## Abilities (first batch)

| Line | Ability | Effect |
|---|---|---|
| Bulbasaur | Overgrow | +30% Grass damage below half HP |
| Charmander | Blaze | +30% Fire damage below half HP |
| Squirtle | Torrent | +30% Water damage below half HP |
| Pikachu | Static | melee attackers become Paralyzed |
| Geodude | Sturdy | once per battle survives a knockout blow at 1 HP (matters with permadeath!) |
| Pidgey, Spearow | Keen Eye | ignores tall-grass concealment |
| Rattata | Run Away | can always retreat from melee without penalty (+1 move after attacking) |
| Caterpie | Shield Dust | immune to statuses |
| Weedle | Poison Point | melee attackers become Poisoned |
| Zubat | Inner Focus | immune to Paralysis and Freeze |
| Oddish | Effect Spore | Grass moves also apply Poison |
| Mankey | Anger Point | +1 Attack (this battle) each time it is hit, max +3 |
| Diglett | Arena Trap | adjacent enemies cannot move away |

## Talents

Each role has a small tree per tier (every 2–3 levels a choice of 2–3):

- **Filler talents**: +1 to a stat, +5% damage of the Pokémon's types, +1 vitamin effect… steady, no new mechanic.
- **Skill talents**: unlock a new active skill usable regardless of species, flavoured by role. Tank: *Protect* (block all damage to self until next turn), *Taunt*; Striker: *Focus Energy*, *Quick Strike*; Controller: *Disable*, *Leer*; Skirmisher: *Agility* (extra move), *Double Team* (switch places with an ally).
- **Type-flavoured upgrades** of the type mechanic: e.g. Fire: Burn lasts +1 turn; Electric: Paralysis also −1 movement afterwards; Rock: rock tiles last longer. These appear only for Pokémon of that type, so the same role plays differently per type.

Per-species signature talents can come later for the most iconic lines.

## Phase 6 decisions recorded

- Expand in game order: Route 2 → Pewter City → Route 3 → Mt. Moon → Cerulean City.
- Named trainers with fixed teams; Brock as the first gym boss; no capture in trainer battles, better rewards.
- **Several small areas** connected at their edges (one area ≈ one screen; each is one JSON file).
- Minimal story frame: collecting gym badges.

## Suggested order

1. Stats rework (type profiles, small numbers, points, vitamins) and save migration.
2. Type mechanics (statuses and move rules) one type at a time, with tests.
3. Abilities for the current 14 lines.
4. Talent trees with filler and skill talents.
5. Phase 6 areas, trainers, Brock and badges.
