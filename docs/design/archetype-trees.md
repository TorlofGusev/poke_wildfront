# Archetype mastery trees (Let's Go style)

Owner decisions (2026-10-27), replacing the one-tree-per-line design of `mastery-trees.md`:

- **Types are modern (Let's Go Pikachu/Eevee):** 18 types, the Gen 6+ chart (canon "no effect" pairs are a
  ×0.5 resist here), Let's Go typings of the 151 (Clefairy line Fairy, Jigglypuff line Normal/Fairy, Mr. Mime
  Psychic/Fairy, Magnemite line Electric/Steel). Dark, Steel and Fairy moves exist where a line can learn them.
- **One definition per move, canon name and canon type.** A move is defined once (`moves.json` or
  `mastery/moves.json`, id = the PokeAPI slug, e.g. `flamethrower`) and every tree uses that definition. No
  retyped moves, no per-line copies, no character names for moves. Power follows the canon power formula
  (`powerFromCanon`).
- **A line only gets moves it can learn in canon** (any modern game: level-up, TM, tutor, egg;
  `tools/data/learnsets.json`). Where several fit, a move the line learns in Let's Go Pikachu/Eevee goes first
  (`tools/data/learnsets-lgpe.json`, its signature moves there: Paras' Spore, X-Scissor). One exception fills a
  hole: when a line can learn no Bond move of one of its types that fits its role, its focus may teach one it
  cannot learn (Bug has no canon melee Bond move for Scyther, Pinsir, Beedrill or Paras: First Impression,
  Megahorn; Paras gets Leaf Blade, Aerodactyl Head Smash). Tested.
- **Passives are shared** (`mastery/passives.json`): plain descriptive names ("Thick Hide", "Deep Roots"),
  one id per effect; capstones use canon ability names where one fits (Thick Fat, Swift Swim, Static).

## Trees

29 archetype trees (`mastery/archetypes/<id>.json`): lines grouped by primary type and role. A tree has the
shared rows; every line in it brings its own **Lv 3 focus** (three Bond moves it can learn, at least one of its
own type where canon allows; Articuno has two), each with Attack, Defense or Vitality.

**Moves come only from the tree.** A Pokémon starts with a basic attack and one typed move (species.json; an
evolution adds none, levelling up teaches none); every other move is a tree skill. A move has one definition and
one source: a line's tree never offers a move its species start with (tested). Wild and trainer Pokémon grow their
tree too (wild ones pick by encounter, a group alike).

**Focus stats.** A line's three focuses all grow its main stat (Attack, Defense or Vitality, from its final
form's stats; Slowbro, Weezing and Sandslash are Defense, Tentacruel Vitality, Eevee's forms Attack). Two are pure
(+2 when chosen, then +1 every 2 levels); one is mixed with the line's second stat (+1/+1, then in turns). A
Charizard never becomes a tank; a Snorlax stays one. Tested.

**No empty names.** Every move in the library deals damage or has an effect (tested). Moves built on mechanics
the game lacks (held items, weather, team rounds, switching partners, IVs) are left out (`EXCLUDED` in
tools/build-move-library.mjs); terrain moves are out for now. Canon effects map onto ours: U-turn / Flip Turn /
Volt Switch end the engagement, Dream Eater and Nightmare only aim at sleepers, Pollen Puff damages a foe or heals
an ally, Taunt disables, Perish Song curses around the user. Pursuit is a tank passive (+50% free strikes).

**One kind per row (v0.101).** A move's kind is its own (move data), not where it is taught: **Bond** = canon
power 85+ (Bond cost 3 from 100, else 2), **basic** = already basic, or canon power ≤ 60 with no extra effect, one
target and not a starting skill, **special** = the rest, every utility included. Each skill row offers one kind:

| Row | Offers |
|---|---|
| Lv 3 focus | Bond moves |
| Lv 6 | one special (shared) + a control utility of the line's own (Disable, Encore, Leer, Yawn…) |
| Lv 12 | one special (shared) + a support utility of the line's own (Helping Hand, Ally Switch, Protect, Knock Off…) |
| Lv 18 | two basic attacks (one of the line's type where it has one, one for coverage, Normal allowed), so the basic can be swapped mid-run; lines with too few canon basics (Magmar, Jynx, Voltorb, Porygon, Squirtle, Seel, Mr. Mime, Koffing) get specials |
| Lv 24 | Bond moves |

The loadout stays 1 basic + 2 specials + 1 Bond. Every option is canon-learnable by its line and fits its role (a
shared option fits every line of the tree; a line's own options sit in `lines[].rows`, one id or a list). A type
of the line that no row offers gets a special of it at Lv 6 or 12. Utilities never sit in a Bond row. Tested.

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
