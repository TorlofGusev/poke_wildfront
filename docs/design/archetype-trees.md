# Archetype mastery trees (Let's Go style)

Owner decisions (2026-10-27), replacing the one-tree-per-line design of `mastery-trees.md`:

- **Types are modern (Let's Go Pikachu/Eevee):** 18 types, the Gen 6+ chart (canon "no effect" pairs are a
  ×0.5 resist here), Let's Go typings of the 151 (Clefairy line Fairy, Jigglypuff line Normal/Fairy, Mr. Mime
  Psychic/Fairy, Magnemite line Electric/Steel). Dark, Steel and Fairy moves exist where a line can learn them.
- **One definition per move, canon name and canon type.** A move is defined once (`moves.json` or
  `mastery/moves.json`, id = the PokeAPI slug, e.g. `flamethrower`) and every tree uses that definition. No
  retyped moves, no per-line copies, no character names for moves. Power follows the canon power formula
  (`powerFromCanon`).
- **A line only gets moves it can learn in canon** (any modern game: level-up, TM, tutor, egg).
- **Passives are shared** (`mastery/passives.json`): plain descriptive names ("Thick Hide", "Deep Roots"),
  one id per effect; capstones use canon ability names where one fits (Thick Fat, Swift Swim, Static).

## Trees

29 archetype trees (`mastery/archetypes/<id>.json`): lines grouped by primary type and role. A tree has the
shared rows; every line in it brings its own **Lv 3 focus** (three Bond skills from its own canon moves, each
with Attack, Defense or Vitality).

**Moves come only from the tree.** A Pokémon starts with a basic attack and one typed move (species.json; an
evolution adds none, levelling up teaches none); every other move is a tree skill. A move has one definition and
one source: a line's tree never offers a move its species start with (tested). Wild and trainer Pokémon grow their
tree too (wild ones pick by encounter, a group alike).

**No empty names.** Every move in the library deals damage or has an effect (tested). Moves built on mechanics
the game lacks (held items, weather, team rounds, switching partners, IVs) are left out (`EXCLUDED` in
tools/build-move-library.mjs); terrain moves are out for now. Canon effects map onto ours: U-turn / Flip Turn /
Volt Switch end the engagement, Dream Eater and Nightmare only aim at sleepers, Pollen Puff damages a foe or heals
an ally, Taunt disables, Perish Song curses around the user. Pursuit is a tank passive (+50% free strikes).

**Own options.** Each line adds one option of its own to every skill row (`lines[].rows`): a move of its other
types or a coverage type the row lacks, at a power fitting the row (`tools/line-options.mjs` suggests and can fill
them). Tested: every skill row offers two types, every type of the line appears, at most two Normal attacks
(Normal lines excepted).

**Bond moves.** Every focus skill and every row skill of canon power ≥ 100 (`progression.bondCanonPower`) teaches
a Bond move (Bond cost 3 from canon 100 up, else 2), so a tree's big hits can't be spammed. Iconic moves now sit in
focuses: Spore (Paras), Bonemerang (Cubone), Crabhammer (Krabby), Withdraw (Shellder), Recover (Staryu), Sing
(Jigglypuff), Petal Dance (Oddish).

| Type | Tree | Lines (first species) |
|---|---|---|
| Normal | Brawler | rattata, tauros, kangaskhan, meowth |
| Normal | Bird | pidgey, spearow, doduo, farfetchd |
| Normal | Heavyweight | snorlax, lickitung, chansey |
| Normal | Oddball | porygon |
| Normal | Copycat | ditto (`mimic`: copies any move, own passives and focus moves) |
| Normal | Eevee | eevee (forms: vaporeon, jolteon, flareon) |
| Fairy | Fairy | clefairy, jigglypuff |
| Water | Shell | squirtle, shellder, krabby, slowpoke |
| Water | Striker | magikarp, goldeen, horsea, poliwag, psyduck |
| Water | Tide | staryu, lapras, seel, tentacool |
| Fire | Blaze | charmander, growlithe, ponyta |
| Fire | Flame Caster | vulpix, magmar, moltres |
| Grass | Bloom | bulbasaur, oddish, tangela |
| Grass | Thicket | bellsprout, exeggcute |
| Bug | Swarm | weedle, venonat, caterpie |
| Bug | Blade | scyther, pinsir, paras |
| Poison | Venom | ekans, grimer, koffing, zubat |
| Poison | Nido | nidoran-f, nidoran-m |
| Electric | Spark | pikachu, electabuzz, zapdos |
| Electric | Machine | magnemite, voltorb |
| Psychic | Mind | abra, mewtwo, mew |
| Psychic | Trickster | drowzee, mr-mime |
| Rock | Fossil | omanyte, kabuto, aerodactyl |
| Rock | Boulder | geodude, onix |
| Ground | Earth | cubone, diglett, rhyhorn, sandshrew |
| Fighting | Fighter | machop, mankey, hitmonchan, hitmonlee |
| Ice | Frost | articuno, jynx |
| Ghost | Ghost | gastly |
| Dragon | Dragon | dratini |

Rows keep the old rhythm (Lv 4 passive, 6 skill, 9 passive, 12 skill, 15 passive, 18 big skill, 21 passive,
24 late skill, 27 passive, 30 capstone), two options each. A row skill must be learnable by **every** line in
the tree; when no common move fits, the tree uses a passive there instead.
