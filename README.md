# Pokémon Wildfront

A free, open-source, browser-only Pokémon tactical RPG fan game inspired by Wartales: grid-based tactics, mandatory deployment, capture, expedition fatigue and three-knockout permadeath.

> **Unofficial fan project.** Not affiliated with or endorsed by Nintendo, Game Freak, Creatures Inc. or The Pokémon Company. Pokémon names and characters are their property. The code licence below covers only this project's original code and grants no rights to Pokémon IP. No monetization, ever.

## Play

No public build yet; hosting will be chosen later. Run it locally (see below).

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
