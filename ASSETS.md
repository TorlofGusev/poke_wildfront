# Asset and licence inventory

| Asset | Source | Licence | Used in |
|---|---|---|---|
| Phaser 4 (engine, npm dependency) | https://phaser.io | MIT | whole game |
| Map tiles, UI shapes | drawn in code by this project | MIT (project code) | battle and overworld |
| Pokémon sprites and portraits (`src/assets/sprites/`) | [PMDCollab SpriteCollab](https://github.com/PMDCollab/SpriteCollab), fetched by `tools/fetch-sprites.mjs` | CC BY-NC 4.0, per-artist credits in [CREDITS.md](CREDITS.md) and in-game (Title → Credits) | battle, overworld, party |

No audio or fonts are included yet. The game uses the system monospace font.

The sprite licence is **non-commercial**, which matches this project's no-monetization rule. Sprites credited to CHUNSOFT come from *Pokémon Mystery Dungeon*; the CC licence cannot grant rights the artists do not hold, so they carry the same IP risk as the rest of the fan game.

Pokémon names, species, moves and the Kanto setting belong to Nintendo, Game Freak, Creatures Inc. and The Pokémon Company. This is an unofficial fan project; the MIT licence of this repository covers only the project's original code and grants no rights to Pokémon intellectual property.
