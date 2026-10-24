# Phase 4 design: overworld, encounters, fatigue and camping

Defaults chosen by Claude on 2026-10-24; open for the owner's review.

## Overworld

- A hand-authored tile map (Route 2 / Viridian Forest / Diglett's Cave entrance). The player moves a single party token tile by tile (click a destination; shortest path).
- Each tile has a **biome** (route, forest, mountain, cave, water edge, town) that sets its travel cost and its wild encounters.
- **Visible encounters**: wild groups are shown on the map as markers. Their species are not revealed until the battle's deployment phase, but the biome hints at what they are. Walking onto a marker starts the battle. They can be avoided.
- **Camp sites** are fixed map locations. Making camp there: restores all HP, resets fatigue to 0, respawns wild groups, and opens party/storage management.
- **Pickups** (items on the map) give Poké Balls once.

## Fatigue

- Only overworld travel adds fatigue: `+travel cost` per tile entered (route 1, forest 2, cave 2, mountain 3). Battles, captures and interacting never add fatigue.
- Range 0–100, shared by the whole expedition.
- Effects (shown in the HUD and on the deployment screen):

| Fatigue | State | Effect in battle |
|---|---|---|
| 0–49 | Rested | none |
| 50–79 | Tired | −1 movement for your Pokémon |
| 80–100 | Exhausted | −1 movement and −20% damage dealt by your Pokémon |

- All numbers live in `src/content/fatigue.json`.

## Encounter generation

- Each biome has an encounter table: group size range and weighted species entries (optionally `maxPerGroup`).
- Generation uses the world's seeded RNG, so a save always reproduces the same groups.
- Constraints (tested): size within range, only species from that biome's table, `maxPerGroup` respected, every listed species can appear.
- Wild battles are fought on a per-biome arena map; the enemy positions come from the arena's spawn points.
- Named trainers and bosses (later) use hand-authored scenarios instead of tables.

## Progression (minimal)

- Pickups give balls. Each victory has a small chance of a Poké Ball reward.
- No XP or levels yet; that is a later design topic.

## Defeat

- Defeat returns the party to the last camp site used (start: the town camp), where it rests (HP and fatigue restored). Knockouts stay.

## Save format v2

- Adds `world` to the game state: position, fatigue, last camp, active encounter groups, collected pickups and RNG state.
- `migrate 1 → 2` adds a fresh world to old saves, so Phase 3 saves keep their party, knockouts and storage.
