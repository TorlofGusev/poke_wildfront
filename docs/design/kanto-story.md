# Kanto story content spec (maps per canon area, gyms, quests, Elite Four)

This replaces the 10 region maps of kanto-maps.md with one map per canon area. Engine: `src/core/story/story.ts`
(NpcDef, ObstacleDef, Condition, StoryReward), `WorldDef.npcs` / `WorldDef.obstacles` / `WorldExit.requires`
(src/core/expedition/world.ts). Key items: src/content/keyItems.json. Main goals: src/content/story.json (flags `npc:<id>`).

## Engine rules (what the content can use)
- **Map files:** `src/content/worlds/<id>.json`, auto-registered. A new game starts on `pallet-town`. Maps are at most
  24×16 tiles (towns and interiors may be smaller, e.g. 14×10). `spawnZones` may be empty (towns, interiors).
- **NPCs:** `npcs: [{ id, name, kind, pos, text, afterText?, lockedText?, requires?, visibleIf?, team?, teamByStarter?,
  reward?, choices?, arena?, capture?, group?, sprite? }]`.
  - Kinds: trainer, leader, rival, rocket, elite, champion, talk, gift, wild.
  - An NPC occupies its tile; the player talks to it from a neighbouring tile. Battlers show "!" until beaten.
  - Beating or finishing an NPC sets the flag `npc:<id>` and applies its reward.
  - `requires` gates the battle or gift (show `lockedText` otherwise). `visibleIf` hides it entirely (e.g. `notFlags`).
  - `wild` = a boss Pokémon (Snorlax, legendaries): battle with `capture: true`. It disappears once done.
  - `group: "e4"`: losing to any member clears the group's flags.
  - `arena`: the biome id whose 16×10 arena hosts the battle. Default is the biome under the NPC; towns have none, so set
    `arena` for town and gym NPCs (e.g. "route", "cave", or a gym biome you add).
- **Teams:** `[{ species, level, role?, heldItem?, moves? }]` (at most 5). They are developed automatically: role,
  masteries, stat points.
  - Rivals use `teamByStarter: { bulbasaur: [...], charmander: [...], squirtle: [...], pikachu: [...] }`, picking the
    counter starter: bulbasaur → charmander line, charmander → squirtle line, squirtle → bulbasaur line,
    pikachu → eevee line (Vaporeon).
- **Rewards:** `{ money?, items?, balls?, keyItems?, badge?, flags?, pokemon?: [{species, level}], takesKeyItems? }`.
  `choices: [{label, reward}]` offers a pick-one (fossils, Hitmonlee/Hitmonchan).
- **Obstacles:** `obstacles: [{ pos, kind: "cut"|"boulder"|"dark"|"guard"|"rock", opensIf: Condition, text }]`. They block
  a tile until the condition holds. Put them in chokepoints.
  - Cut tree: `opensIf: {fieldMove: "cut"}`.
  - Boulder: `{fieldMove: "strength"}`.
  - Saffron gate guard: `{keyItems: ["tea"]}`.
  - Badge-check guards on Route 23: `{badges: n}`.
- **Exits:** `exits: [{ name, pos, to, arrive, requires?, lockedText? }]` on edge tiles, passable on both maps.
  - Dark caves: the exit into Rock Tunnel gets `requires: {fieldMove: "flash"}`.
  - Cerulean Cave: `requires: {flags: ["npc:champion"]}`.
  - Victory Road: `requires: {badges: 8}`.
- **Surf:** open water `~` becomes walkable once Surf is usable (HM03 + Soul Badge). Put Surf-only areas behind water.
- **Field moves** (key item + badge):

  | Move | HM item | Badge | Where the HM is found |
  |---|---|---|---|
  | Cut | hm-cut | cascade | S.S. Anne captain |
  | Flash | hm-flash | boulder | Route 2 aide, after Brock |
  | Surf | hm-surf | soul | Safari Zone secret house |
  | Strength | hm-strength | rainbow | Fuchsia warden |
- **Biomes:** add new biomes in `src/content/biomes/<region>.json` (copy existing ones: route, cave, forest or any
  region biome). Existing region biomes in src/content/biomes/*.json can be reused by id.
- **Biome chars:** each author uses only its own range (new biomes only):
  - region A: `n p q r s`
  - region B: `t u v w x`
  - region C: `y z 0 1 2`
  - region D: `3 4 5 6 7 8 9 j k`
- **Towns:** cities use the `town` biome (`T`); the Pokémon Center and Mart are automatic there. Put each gym as a
  walled block of town tiles holding its trainers and leader.
- **Map tuning:**
  - Deploy slots: 3 from Pallet to Viridian Forest, 4 from Pewter to Route 4, 5 from Cerulean onward.
  - AI: tutorial from Pallet to Viridian Forest, novice for Pewter and Route 3, normal from Mt. Moon onward.
  - Max level 30.

## Level plan (max 30)
| Area | Wild | Trainers / leader |
|---|---|---|
| Pallet, Route 1, Viridian, Route 22 (early) | 1–3 | Rival 1: L4–5 |
| Route 2, Viridian Forest | 2–4 | bug catchers L3–5 |
| Pewter, Route 3 | 4–8 | Brock: Geodude 9, Onix 11 |
| Mt. Moon | 8–12 | Rockets L10–12 |
| Route 4, Cerulean, Routes 24/25 | 11–14 | Rival 2: L13–15; Misty: Staryu 14, Starmie 16 |
| Routes 5/6/11, Vermilion, S.S. Anne, Diglett's Cave | 13–17 | Rival 3: L16–17; Lt. Surge: Voltorb 17, Pikachu 17, Raichu 19 |
| Routes 9/10, Rock Tunnel, Lavender, Power Plant | 16–20 (Plant 20–22) | — |
| Routes 7/8, Celadon, Rocket Hideout | 18–21 | Erika: Victreebel 21, Tangela 20, Vileplume 22; Giovanni (hideout): Onix 21, Rhyhorn 21, Kangaskhan 22 |
| Pokémon Tower | 19–21 | Rival 4: L21–22; Marowak ghost L22 |
| Saffron, Silph Co., Fighting Dojo | 21–24 | Rival 5: L23–24; Giovanni (Silph): Nidorino 23, Kangaskhan 23, Rhyhorn 23, Nidoqueen 24; Sabrina: Kadabra 25, Mr. Mime 25, Venomoth 24, Alakazam 26 |
| Routes 12–18, Fuchsia, Safari Zone | 21–25 | Koga: Koffing 24, Muk 24, Koffing 24, Weezing 26 |
| Routes 19–21, Seafoam, Cinnabar, Mansion | 24–27 | Blaine: Growlithe 26, Ponyta 26, Rapidash 27, Arcanine 28 |
| Viridian Gym | — | Giovanni: Rhyhorn 28, Dugtrio 28, Nidoqueen 28, Nidoking 29, Rhydon 30 |
| Route 22 (late), Route 23, Victory Road | 26–30 | Rival 6: L28–29 |
| Indigo Plateau | — | Lorelei, Bruno, Agatha, Lance: 5 Pokémon at L29–30; Champion (rival): L30 with held items |

Canon Gen 1 teams. Leaders and the Elite Four carry fitting held items. Gym trainers (1–3 per gym) sit 2–4 levels below their leader.

## Maps and owners
**Region A** (owner A; deletes the old worlds route-2.json, route-3.json, mt-moon.json):
- pallet-town (start), route-1, viridian-city, route-22, route-2, viridian-forest, pewter-city, route-3,
  mt-moon (2 maps: mt-moon-1f, mt-moon-b2f), route-4.
- Viridian Gym is locked: leader `giovanni` with `requires: {badges: 7}`.
- Route 22: rival 1 `rival-route22a` (early) and `rival-route22b` (`requires: {badges: 8}`).
- Route 2 aide: gift `hm-flash`, `requires: {flags: ["npc:brock"]}`.
- Brock: `brock`.
- Mt. Moon: Rockets, then `rocket-mtmoon` with `choices` Helix Fossil / Dome Fossil (keyItems), plus a Clefairy area.

**Region B** (owner B; deletes cerulean.json, vermilion.json, rock-tunnel.json):
- cerulean-city, route-24, route-25, cerulean-cave, route-5, route-6, vermilion-city, ss-anne, route-11,
  digletts-cave, route-9, rock-tunnel, route-10, power-plant, lavender-town.
- Cerulean: `misty`, and a Rocket burglar `rocket-cerulean` (TM reward).
- Route 24: Nugget Bridge trainers and `rival-cerulean`.
- Route 25: `bill`, a gift giving `ss-ticket`.
- Cerulean Cave: post-game, requires `npc:champion`. Mewtwo is a `wild` NPC at L30, plus strong wild spawns.
- Vermilion: the gym entrance is blocked by a cut tree; `surge`; the dock exit to ss-anne requires `keyItems: ["ss-ticket"]`.
- S.S. Anne: trainers, `rival-ssanne`, and the captain (gift `hm-cut`).
- Route 9: a cut tree. The exit into rock-tunnel requires Flash.
- Power Plant: behind water (Surf). Zapdos is a `wild` NPC at L28 with `capture: true`.
- Lavender: `mr-fuji` appears after the Tower.

**Region C** (owner C; deletes celadon.json):
- pokemon-tower, route-8, saffron-city, silph-co, fighting-dojo, route-7, celadon-city, rocket-hideout,
  route-16, route-17, route-18.
- Celadon: `erika`, a gift NPC giving `tea`, Eevee gift, and a Game Corner area with the hideout exit.
- Rocket Hideout: Rockets, a gift `lift-key`, then `giovanni-hideout` (`requires: {keyItems: ["lift-key"]}`) giving `silph-scope`.
- Pokémon Tower:
  - `rival-tower` and ghost trainers.
  - Marowak ghost: `wild`, `requires: {keyItems: ["silph-scope"]}`.
  - Then Rockets, then `mr-fuji-tower` (a talk NPC giving `poke-flute` and flag `fuji-freed`).
- Saffron:
  - Gate guards are obstacles opening with `tea`.
  - `sabrina`, `requires: {flags: ["npc:giovanni-silph"]}`.
- Silph Co.: `rival-silph`, Rockets, a gift `card-key`, `giovanni-silph` (`requires: {keyItems: ["card-key"]}`), and a Lapras gift.
- Fighting Dojo: `karate-master`, with choices Hitmonlee / Hitmonchan.
- Route 16: Snorlax is a `wild` NPC at L26 blocking the road, `requires: {keyItems: ["poke-flute"]}`, `capture: true`.

**Region D** (owner D; deletes fuchsia.json, cinnabar.json, indigo.json):
- fuchsia-city, safari-zone, route-12, route-13, route-14, route-15, route-19, route-20, seafoam-islands,
  cinnabar-island, pokemon-mansion, route-21, route-23, victory-road, indigo-plateau.
- Route 12: a second Snorlax, as on Route 16.
- Fuchsia: `koga` and the `warden` (gift `hm-strength`, `requires: {flags: ["npc:koga"]}`).
- Safari Zone: a secret-house gift `hm-surf` and the Safari spawns.
- Routes 19/20: water routes; Surf needed to go south of Fuchsia.
- Seafoam: boulders (Strength). Articuno is a `wild` NPC at L28 with `capture: true`.
- Pokémon Mansion: a gift giving `secret-key`.
- Cinnabar:
  - `blaine` (`requires: {keyItems: ["secret-key"]}`).
  - The lab revives fossils: a gift with `requires: {keyItems: ["helix-fossil"]}` gives Omanyte L20, with
    `takesKeyItems`. Likewise Dome → Kabuto and Old Amber → Aerodactyl. The Old Amber is a gift in the mansion or Pewter museum.
- Route 23: badge guards, as obstacles with `opensIf: {badges: n}`.
- Victory Road: boulders. Moltres is a `wild` NPC at L29.
- Indigo Plateau:
  - A town with a Center/Mart, then a walled hall: `lorelei` → `bruno` → `agatha` → `lance` → `champion`.
  - Each requires the previous one's flag; all are `group: "e4"`.
  - The champion is the rival (`teamByStarter`), and the exit into the hall requires 8 badges.

Legendaries are bosses, not random spawns: remove Articuno, Zapdos, Moltres and Mewtwo from spawn tables. Mew may stay
a tiny spawn in Cerulean Cave.

## Cross-region links (both sides must have the matching exit)
- A → B: route-4 ↔ cerulean-city
- B → C: lavender-town ↔ route-8; route-5 ↔ saffron-city; route-6 ↔ saffron-city
- B → D: route-11 ↔ route-12 (east), lavender-town ↔ route-12 (south)
- C → D: route-7 ↔ celadon? (C internal); route-18 ↔ fuchsia-city
- D → A: route-21 ↔ pallet-town; route-23 ↔ route-22

Use `"arrive": {"x": -1, "y": -1}` for links into another owner's map. Name the exit after the target map
(e.g. "Cerulean City"); the arrive tiles are resolved afterwards.
