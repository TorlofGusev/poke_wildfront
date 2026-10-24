# Pokémon Wildfront

A free, open-source, browser-only Pokémon tactical RPG fan game inspired by Wartales: grid-based tactics, mandatory deployment, capture, expedition fatigue and three-knockout permadeath.

> **Unofficial fan project.** Not affiliated with or endorsed by Nintendo, Game Freak, Creatures Inc. or The Pokémon Company. Pokémon names and characters are their property. The code licence below covers only this project's original code and grants no rights to Pokémon IP. No monetization, ever.

## Play

No public build yet; hosting will be chosen later. Run it locally (see below).

## Current state

Prototype (Route 2 & Viridian Forest):

- **Overworld**: click to travel across route, forest, mountain and cave. Wild groups are visible red markers (the number is the group size); walking into one starts a battle, or you can go around. Item pickups give Poké Balls.
- **Fatigue**: only travel tires the team (route 1, forest/cave 2, mountain 3 per tile). No penalty until it reaches 100; then the team is Exhausted (−1 movement, −20% damage in battle) until it camps. The path preview shows the cost before you move.
- **Camp anywhere**: making camp restores HP and fatigue, wild groups move, and you can manage party and storage. Defeat carries the team back to the last camp (tent marker).
- **Battles**: mandatory deployment (3 of your party), initiative order, Wartales-style turns, cooldown specials, once-per-battle ultimates, push/pull, statuses, tall grass, hidden enemies, enemy AI, colour-coded combat log and move rules.
- **Capture**: Poké/Great/Ultra Balls on wild Pokémon below 50% HP; the chance is shown and the ball is always used. A full party sends captures to storage.
- **Permadeath**: each faint adds a knockout (●○○); at 3/3 the Pokémon is gone for good. Defeat carries the team back to the last camp.
- **Progression**: XP and levels, a role at level 5 (Tank, Striker, Controller, Skirmisher) and a talent every level after, learnable moves with a 3-move loadout, evolutions, one held item per Pokémon.
- **Money and Poké Mart**: victories pay Pokédollars; the town sells balls, potions and held items.
- Autosave in browser storage (save format v4, migrates older saves). Plays on phones in landscape (fullscreen button, larger text, touch log scrolling).

Pokémon sprites from PMDCollab SpriteCollab (CC BY-NC 4.0, see [CREDITS.md](CREDITS.md)); map and UI are drawn in code. Design notes: [docs/design](docs/design).

Controls: click a tile to move, click a move (or a ball) then a highlighted tile to use it (hover a move for its rules), right-click/Esc to cancel, Space to end the turn, L for the full combat log.

## Develop

Requirements: Node.js 22 LTS.

```bash
npm install
npm run dev        # local dev server with hot reload
npm test           # headless rule tests (Vitest)
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build locally
```

## Project layout

- `src/core/` – pure game rules, no Phaser/DOM/`Math.random` (enforced by `tests/architecture.test.ts`)
- `src/content/` – data files (species, moves, encounters…)
- `src/game/` – Phaser scenes, rendering, input, UI
- `docs/` – [project brief](docs/PROJECT_BRIEF.md), [Phase 1 audit](docs/PHASE1_AUDIT.md), [design notes](docs/design), [building and hosting](docs/BUILD.md)

See [CONTRIBUTING.md](CONTRIBUTING.md) to help, and [ASSETS.md](ASSETS.md) for licences.

## Licence

Original code: [MIT](LICENSE). Third-party assets and their licences are listed in `ASSETS.md` (added together with the first assets).
