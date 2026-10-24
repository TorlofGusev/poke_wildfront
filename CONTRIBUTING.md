# Contributing to Pokémon Wildfront

Thanks for helping! This is an unofficial, non-commercial fan project. Please read the [project brief](docs/PROJECT_BRIEF.md) first; it explains the goals and the rules we do not bend (no monetization, no ripped game assets).

## Setup

Requirements: Node.js 22 LTS.

```bash
npm install
npm run dev         # play locally with hot reload (http://localhost:5173)
npm test            # rule tests (fast, headless)
npm run typecheck
npm run build:single && npm run test:e2e   # production build + browser smoke test
```

## Where things live

| Folder | What | Rules |
|---|---|---|
| `src/core/` | Game rules (grid, battle, capture, party, fatigue, saves) | No Phaser, DOM or `Math.random`. Every rule change needs a test in `tests/core/`. |
| `src/content/` | Data: species, moves, types, balls, biomes, maps | Most new content is JSON only. `tests/content.test.ts` checks references. |
| `src/game/` | Phaser scenes and UI | Presentation only; call into `src/core`. |
| `docs/design/` | Design notes per phase | Update when a rule changes. |

## Adding content

- **A Pokémon**: add an entry to `src/content/species.json` (base stats from the original games are fine; do not copy data dumps), give it at least one `basic` move and a `captureBase`. Add it to a biome's `encounters` in `src/content/biomes.json`.
- **A move**: add it to `src/content/moves.json`. Moves always hit; make them interesting through range, shape (single, burst, line), effects (push, pull, status, heal) and cooldown.
- **A map area**: edit `src/content/worlds/*.json` (ASCII rows, one character per biome) and its spawn zones.

Run `npm test` after any content change.

## Saves

The save format is versioned (`src/core/save/save.ts`). If you change `GameState`, bump `SAVE_VERSION` and add a migration step plus a test, so players keep their progress.

## Assets and licences

Only add art, audio or fonts you have the right to share, and record each one in [ASSETS.md](ASSETS.md) with its source and licence. Do not add assets ripped from official games, and do not assume fan-community assets are free to reuse.

## Pull requests

Keep them small and focused, describe what changed and how you tested it, and make sure `npm test`, `npm run typecheck` and the e2e smoke test pass.
