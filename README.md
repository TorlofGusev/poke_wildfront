# Pokémon Wildfront

A free, open-source, browser-only Pokémon tactical RPG fan game inspired by Wartales: grid-based tactics, mandatory deployment, capture, expedition fatigue and three-knockout permadeath.

> **Unofficial fan project.** Not affiliated with or endorsed by Nintendo, Game Freak, Creatures Inc. or The Pokémon Company. Pokémon names and characters are their property. The code licence below covers only this project's original code and grants no rights to Pokémon IP. No monetization, ever.

## Play

No public build yet; hosting will be chosen later. Run it locally (see below).

## Current state

Phase 3 prototype:

- **Camp**: party (max 6) and unlimited storage, rest to restore HP, pick a battle. Autosaves to browser storage.
- **Battle** (*Viridian Forest Ambush*): mandatory deployment (3 of your party), initiative order, Wartales-style turns (split movement + one action), cooldown specials, once-per-battle ultimates, push/pull, poison/slow, tall-grass concealment, hidden enemies, simple enemy AI, combat log.
- **Capture**: Poké/Great/Ultra Balls, usable as the turn's action on wild Pokémon below 50% HP (range 1–3); the chance is shown before throwing and the ball is always used up. A full party sends captures to storage.
- **Permadeath**: every Pokémon that faints gets a knockout (●○○). At 3/3 it is gone for good. Resting never clears knockouts.
- **Retreat** at any time; knockouts already suffered still count. Defeat sends the team back to camp to rest.

Placeholder art only. Design notes: [docs/design](docs/design).

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
- `docs/` – [project brief](docs/PROJECT_BRIEF.md), [Phase 1 audit](docs/PHASE1_AUDIT.md)

## Licence

Original code: [MIT](LICENSE). Third-party assets and their licences are listed in `ASSETS.md` (added together with the first assets).
