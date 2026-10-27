# Progression, economy and equipment: decisions

Confirmed by the project owner on 2026-10-24. These extend the original brief, which only asked for "basic progression", "exploration rewards" and evolution.

| Topic | Decision |
|---|---|
| Money and shop | **Pokédollars** from battles and exploration; a **Poké Mart** in towns sells Poké Balls, healing items and held items. |
| Equipment | **One held item** per Pokémon (e.g. Charcoal: more fire damage; Focus Band: survives one knockout blow; Leftovers: heals each turn). |
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
- **Poké Mart** on the town tiles of the map: balls, Potion (40 HP), Super Potion (90 HP), held items (type boosters, Focus Band, Leftovers, Muscle Band). Potions are used outside battle and cannot revive.
- **Wild levels** by biome: route 3–5, forest 3–6, mountain 7–10, cave 8–11.

## Revision after playtest (2026-10-24)

- **Camp screen** = party overview without stats, a *Rest here* button (resting is a separate choice) and per-Pokémon screens with ◀ ▶ to cycle: Level up (stat points + talent tree), Moves, Equipment (held item and healing items).
- **Role** can be chosen from **level 3**.
- **Talent tree** per role (`roles.json` → `tree`): rows by level (4, 6, 8, 10, 12, 14), two branches that merge, prerequisites (a talent needs one connected talent learned), filler stat talents as normal nodes, the type talent at level 8 for every role. **Talent points** only at levels 4, 6, 8, … 20 (not every level). Repeatable stat talents were removed.
- **Classic start**: choose Bulbasaur, Charmander or Squirtle (level 5); the 6-Pokémon playtest team remains as an option.
- **Team-scaled encounters**: a wild group never fields more Pokémon than the player's healthy party members (max 3), keeping its strongest; the map shows the scaled group.

## Revision: scaling, roles, masteries, loot (2026-10-25)

Confirmed by the project owner.

- **Six stats**: HP, Attack, Defense, Sp. Atk, Sp. Def, Speed. Moves of the types in `rules.json` → `specialTypes` (fire, water, grass, electric, ice, psychic, dragon) are special (Sp. Atk vs Sp. Def); the rest are physical. A move can override this with `category`.
- **Automatic growth (Wartales-style)**: every role has `growth` per level in `roles.json` (fractions accumulate, counted from Lv 1 once the role is chosen). The role buttons show it as a hint (e.g. "Def ++ · SpD ++ · HP +"). Wild Pokémon grow along their species' first role. Free stat points (1 per level) remain.
- **Max HP** = `hpBase + hpPerPoint × HP + (level − 1) × (hpPerLevel + hpPerLevelPerDefense × species base Def)`: HP rises with level, faster for sturdier species. Base (not current) Defense, so Tank Defense growth does not snowball into HP.
- **Range by move, style by role**: range stays a property of the move (Karate Chop is melee, Thunder Shock is ranged). New role **Sharpshooter**: ranged moves (2+ tiles) reach +1 with Long Shot, +10% damage to foes 3+ tiles away, −25% to adjacent foes. Striker: +10% to adjacent foes. Species role pairs follow their move kit (e.g. Pikachu Sharpshooter/Controller, Weedle line Sharpshooter/Striker).
- **Masteries** (formerly talents; code ids still say `talent`): two trees per Pokémon. The **role tree** gives points at Lv 4, 8, 12, 16, 20; the **type tree** (`typeTrees.json`, one per Kanto type, 7 nodes: two roots, two follow-ups, a signature skill, two capstones) gives points at Lv 6, 10, 14, 18. Dual-type Pokémon pick their mastery type together with the role at Lv 3. New mechanics for type masteries: contact status (Flame Body, Toxic Barbs…), heal on knockout (Moxie), thorns (Rough Skin).
- **Evolution within max level 30**: three-stage lines evolve at 10 (second stage planned at 20), bug lines at 4 / 8, two-stage lines at 15.
- **Loot**: a won wild battle yields at most one item from the area's table (chances ×0.6), a Poké Ball 15% of the time. Map pickups show what they hold: ★ one-time rare find, ◆ held item, Poké Ball, ✚ healing, berry.
- **Selling**: the Poké Mart buys back any ball or item for half its price.
- **Pokémon screen tabs**: Stats (where each stat comes from + stat points), Masteries (role and type trees), Moves, Equipment.
- **Saves**: version 4; older saves are discarded (no backward compatibility during the prototype).

### Playtest balance pass (2026-10-25)

`PLAYTEST=1 npx vitest run tests/playtest.report.test.ts --silent=false` simulates AI-vs-AI fights on a mirror-symmetric arena, every matchup played from both sides.

- **First-mover disadvantage**: with identical teams, the side that moves first (the player on Speed ties) wins only ~25%, because the AI walks into range and gets hit first. A human can wait; the enemy AI cannot exploit this, but the player-side AI in tests does not either.
- **Wild Pokémon evolve by level** (`wildForm`): a level 6 wild Caterpie is a Metapod.
- **Role tuning** (same species, role A vs role B, L15): Tank 55%, Striker 54%, Sharpshooter 48%, Controller 47%, Skirmisher 46%. Role bonuses: Striker +10% to adjacent foes; Sharpshooter −10% adjacent / +25% at 3+ tiles; Controller +1 status turn, +15% vs statused foes; Skirmisher +1 movement, +30% vs full-HP foes, −15% damage taken.
- **Follow-ups (confirmed)**: Route 3 wild levels one lower (route 4–6, forest 5–7, mountain 7–9, cave 8–10); every skirmisher species +1 Attack; every root mastery (role Lv 4, type Lv 6) also gives a fitting +1 stat, and the weakest roots got bigger numbers. A developed team now beats its undeveloped mirror 60% at Lv 5, 70% at Lv 10, 85% at Lv 20.
- **Open**: Route 3 is still the hardest step for a Lv 3 team (about 2 of 6 simulated fights lost), which feels intended for the first new map.

## 8-directional grid and engagement (2026-10-25)

- **Battle grid is 8-directional**: `gridDistance` counts diagonals alternately as 1 and 2 (1, 3, 4, 6…), so all eight neighbours are adjacent (melee hits diagonally) while long diagonals are no shortcut. Movement uses the same alternating cost and never cuts the corner of impassable terrain. Bursts use the same distance; lines go in any of the 8 directions; pushes along an exact diagonal go diagonally. The overworld stays 4-directional.
- **Engagement (Wartales-style), one on one**: only a damaging melee hit (range 1) on an adjacent foe, or a skill with the `engage` effect, engages two units, and only if neither is engaged yet. Standing next to a foe does not. Engaged units may only attack each other, and only with melee moves; a Pokémon whose basic attack is ranged (2+) uses **Struggle** instead (its basic attack's type at 50% power, `rules.json` → `engagement.fallbackPower`). Stepping away draws one free attack from the partner (unless it is Frozen) and ends the engagement; a unit knocked out by it stays where it was. Pushes that separate the pair, fainting and capture also end it.
- **Engagement skills**: *Block* (Tank tree, replaces Bulldozer) engages an adjacent foe, taking it over from an ally; *U-turn* (Sharpshooter tree, replaces Quick Step) hits and ends the engagement; *Teleport* (Controller tree, replaces Quick Step) ends it without an attack. Skirmishers break away without a free attack.
- **Balance** (playtest, same species role A vs B, L15): Tank 53%, Striker 68%, Controller 48%, Sharpshooter 42%, Skirmisher 35%. The planned role combos (setup → payoff, +1 Bond per combo) come next.

## Role combos (2026-10-25)

- **Setup → payoff**: a foe is *set up* when it is engaged with one of the attacker's allies, or carries a status an ally applied (statuses remember who applied them). Hitting a set-up foe is a **combo**: the team gains +1 Bond (once per action), and the attacker's combo bonuses apply.
- **Roles**: Tank engages and holds foes (Block); Controller applies statuses that last 1 turn longer (+25% vs statused foes); Striker +25% vs foes engaged with an ally; Skirmisher +30% vs foes engaged with an ally, +12% damage, −10% damage taken, +1 movement, breaks away freely; Sharpshooter +25% vs foes carrying an ally's status, +15% at 3+ tiles, −10% adjacent.
- **New**: *Marked* status (+15% damage taken) from **Lock-On** (Sharpshooter tree, replaces Opening Blow); masteries **Follow Through** (Striker, +20% vs engaged-with-ally, replaces Opening Blow) and **Backstab** (Skirmisher, +25%, replaces Ambush); **Exploit** now gives +20% vs foes carrying an ally's status.
- **Balance** (same species role A vs B, L15): Striker 61%, Tank 57%, Controller 43%, Sharpshooter 43%, Skirmisher 43%. This test pits three copies of one role against three of another, so cross-role combos barely occur in it; mixed teams are where combos pay off.
- **Open**: the AI does not value Block (engaging) or Bond gains yet, so wild Pokémon rarely set up combos on purpose.

### Combo Bond rework (2026-10-25)
- A combo no longer grants Bond by itself (playtests showed ~12 combos per game, flooding Bond).
- Bond for combos comes only from builds: the `comboBond` mod (Backstab mastery: +1) and the
  move effect `{kind:"bond", when:"combo"|"knockout"}` (Feint Attack: +1 on combo; Hyper Fang: +1 on knockout).
- Own setup still never counts as a combo (decision kept: combos reward teamwork).
- Skirmisher damageDealt 1.12 → 1.18.
- Battle UI: engaged pairs are joined by an orange line; foes the active Pokémon would combo get a gold corner mark and a "Combo target" info line.
- Enemy AI values Bond gains and only Blocks when another ally can reach the pinned foe next round.

### Tutorial map, deploy slots, bigger party (2026-10-25)
- Map AI levels: Route 2 & Viridian Forest = "tutorial" (no kill/status/ultimate interest, slack 0.8), Pewter & Route 3 = "novice" (no combos/buffs, slack 0.5), later maps "normal".
- Deploy slots grow with progression: Route 2 → 3, Route 3 → 4, later (after a badge) → 5. Wild groups are capped at the slots (and at the healthy party size).
- Party size 6 → 10; the PC storage stays unlimited. Non-deployed party members get 50% of the battle XP (Exp. Share). Reason: no fixed "core three", benched Pokémon stay usable for type matchups and later camp jobs, while fighting still pays more.

### Content + mastery overhaul (2026-10-25)
- Spawn panel on the overworld ("Wild Pokémon here", key I): species, share %, levels, max per group; unmet species show as ???. `GameState.seen` records species met in battle.
- New species: third stages at Lv 20 (Venusaur, Charizard, Blastoise, Pidgeot, Golem, Vileplume), Raichu (Lv 16), Clefairy/Clefable, Paras/Parasect, Abra line, Gastly line, Seel/Dewgong, Dratini line. 18 new moves, abilities Levitate, Cute Charm, Thick Fat.
- Mt. Moon map (normal AI, 4 deploy slots) with biomes moon-cave, moon-crater, moon-lake; opened from Route 3. Rare spawns: Gastly (cave), Abra (crater), Dratini (lake).
- Masteries renamed to authentic Pokémon move/ability names; dead talents removed (bulldozer, opening-blow, quick-step, ambush).
- Status duration bonus capped at +2 (`rules.statusBonusCap`); Freeze and Paralysis never extended.
- "vs any status" masteries now reward only an ally's status (vsSetupDamage): Controller passive, Hex, Inferno, Corrosion, Infestation.
- Role capstones: Mean Look (Tank), Beast Boost (Striker), Lingering Aroma (Controller), Speed Boost (Skirmisher), Mind Reader (Sharpshooter).
- Tank passive pinDamage 1.1; Ingrain (heal while engaged), Pursuit (free strike +50%, +1 Bond). Controller gets Prankster instead of Analytic.
- New mods: pinDamage, strikeDamage, vsMudDamage, surroundedDamage, statusedDamage, fullHpDamageTaken, vsStatusIdDamage, koAttackBoost, koMove, koRefreshBasic, koResetCooldowns, statusSpreadOnKo, healWhileEngaged, bondOnStrike, furyCutter, statusedMove, statusCooldownReduction, shedStatuses, sturdy, noEscape.
- Research notes (Wartales / Battle Brothers): docs/design/perk-research.md.

### Gen 1 masteries, slimmer trees, Kanto to the Elite Four (2026-10-26)
- Mastery names are strictly Gen 1 move names (user decision). Type trees: 5 nodes, 3 points (Lv 6/12/18); role trees
  6–7 nodes, 5 points. 13 non-Gen-1 skill moves renamed (Block→Bind, Protect→Barrier, Lock-On→Screech, …).
- Compensation: every type mastery +1 to the type's main attacking stat; role capstones +3 stats; Controller ally-setup
  bonus 25%, Sleep Powder (+1 status turn, faster status recharge).
- Playtest: the simulated player now refreshes its loadout, equips type-boosting held items, buys them in town with
  battle money, and spends Candy; the campaign runs through every map to Indigo Plateau.
- All 151 Gen 1 species with PMDCollab sprites and Gen 1 cries (PokeAPI "legacy"); synthesised battle/menu SFX; M mutes.
- Kanto maps up to Indigo Plateau (docs/design/kanto-maps.md): cerulean, vermilion, rock-tunnel, celadon, fuchsia,
  cinnabar, indigo; biomes per region in src/content/biomes/, maps auto-registered from src/content/worlds/.
- Every species is obtainable (wild, evolution or starter); trade/stone/gift species are rare spawns near their canon place.
- Known overlap: some mastery names equal Gen 1 move names that now exist as moves (e.g. Clamp, Slash, Cut).

### Type-fitting mastery names (2026-10-26)
- Replaces the "strictly Gen 1 move names" rule: a mastery's name must fit the Pokémon's type. Passives use plain
  English or a fitting canon ability name (Flame Body, Static, Guts); skills are named after the move they teach.
- Role skills come in a version per type (src/content/skillVariants.json → generated `<move>--<type>` moves): a Fire
  Pokémon's heavy strike is Flame Wheel, a Water one's Aqua Tail; damaging versions take the Pokémon's type.
  Types without a fitting canon name keep the neutral base move (Mega Punch, Protect, Fall Back…).
