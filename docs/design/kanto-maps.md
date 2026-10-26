# Kanto map plan (up to the Elite Four)

Overworld maps are 24×16 tiles (see src/content/worlds/route-3.json and mt-moon.json). Each map bundles several
canon areas. Levels top out at 30 (the max level) at Victory Road. Spawns roughly follow Gen 1 / FRLG locations.

| # | Map id | Canon areas | Wild levels | AI | Deploy | Exits |
|---|---|---|---|---|---|---|
| 1 | route-2 | Route 2, Viridian Forest | 1–3 | tutorial | 3 | → route-3 |
| 2 | route-3 | Pewter City, Route 3 | 4–10 | novice | 4 | → route-2, → mt-moon |
| 3 | mt-moon | Mt. Moon | 9–14 | normal | 4 | → route-3, → cerulean |
| 4 | cerulean | Route 4, Cerulean City, Routes 24/25 (Nugget Bridge, Bill), Cerulean Cave (post-game: 28–30) | 12–16 | normal | 4 | → mt-moon, → vermilion, → rock-tunnel |
| 5 | vermilion | Routes 5/6, Vermilion City, Diglett's Cave, Route 11 | 14–18 | normal | 5 | → cerulean, → fuchsia (Route 12) |
| 6 | rock-tunnel | Route 9, Rock Tunnel, Route 10, Power Plant (20–22), Lavender Town, Pokémon Tower | 16–20 | normal | 5 | → cerulean, → celadon (Route 8) |
| 7 | celadon | Route 8, Saffron City (Fighting Dojo), Route 7, Celadon City (Game Corner) | 18–22 | normal | 5 | → rock-tunnel, → fuchsia (Route 16) |
| 8 | fuchsia | Routes 12–15, Cycling Road (16–18), Fuchsia City, Safari Zone (22–25) | 20–24 | normal | 5 | → celadon, → vermilion, → cinnabar (Route 19) |
| 9 | cinnabar | Routes 19/20 (sea), Seafoam Islands, Cinnabar Island, Pokémon Mansion, Route 21 | 23–27 | normal | 5 | → fuchsia, → indigo |
| 10 | indigo | Route 22, Route 23, Victory Road, Indigo Plateau (town; Elite Four building = end of the map) | 26–30 | normal | 5 | → cinnabar |

## Authoring rules
- Each region adds its biomes in `src/content/biomes/<map-id>.json` (merged over biomes.json) and its map in
  `src/content/worlds/<map-id>.json` (auto-registered). Biome ids are prefixed with the map id, e.g. `cerulean-route24`.
- Every biome needs a unique single-character `char`. Already taken: `. " ^ c T ~ # M o l`. Ranges per author:
  - maps 4–5: `A B C D E F G H I J 1 2 3`
  - maps 6–7: `K L N O P Q R S U V 4 5 6`
  - maps 8–10: `W X Y Z a b d e f g h i j k 7 8 9`
- Cities use the existing `town` biome (`T`): Pokémon Center and Poké Mart work there automatically. Name them via `areaNames`.
- Unwalkable: `#` (trees/walls) and `~` (water). The sea routes (19–21) use a walkable sea biome until Surf-locked zones exist (backlog).
- Wild biomes: copy the shape of `cave` in biomes.json (travelCost, encounters {groupSize, entries, levels}, arena
  16×10 mapRows with the same deploymentZone (x 0–1, y 1–8) and 5 enemySpawns on passable tiles, forage, loot).
  Arena tiles: `.` floor, `"` tall grass, `~` water, `#` wall, `m` mud.
- Rare spawns use a small weight and `maxPerGroup: 1`. Legendaries live in their canon spot with a tiny weight:
  Articuno (Seafoam), Zapdos (Power Plant), Moltres (Victory Road), Mewtwo and Mew (Cerulean Cave).
- Gift and static Pokémon become rare spawns near their canon place: Eevee and Porygon (Celadon), Lapras (Saffron or the
  Seafoam water), Hitmonlee and Hitmonchan (Saffron Dojo), Snorlax (Route 12/16), the fossils Omanyte, Kabuto and
  Aerodactyl (Cinnabar or Mt. Moon), Magikarp/Gyarados (water routes), Kangaskhan, Scyther, Pinsir, Tauros, Chansey and Dratini (Safari Zone).
- Exits sit on edge tiles that are passable on both maps. Links between maps owned by different authors use
  `"arrive": {"x": -1, "y": -1}` as a placeholder; they are resolved to the tile next to the matching exit on the target map.
- Pickups: a few per map (berries, potions, held items, balls), and `once: true` for rare ones.
