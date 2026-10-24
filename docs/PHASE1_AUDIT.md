# Phase 1: Repository and Feasibility Audit

Audit date: 2026-10-24. Stack per [PROJECT_BRIEF.md](PROJECT_BRIEF.md) §3: **browser-only, Phaser + TypeScript**.

## 1. Proposed architecture (summary)

Three strictly layered parts; dependencies point downward only.

```
src/content/   JSON data (species, moves, types, balls, encounters, maps)  ← contributors edit this
      ↓ loaded + validated by
src/core/      Pure TypeScript game rules. No Phaser, no DOM, no Math.random.
               grid, pathfinding, battle state, turn order, abilities, damage,
               status, capture, party, knockouts, fatigue, encounters, AI, save format
      ↓ driven by
src/game/      Phaser scenes, rendering, input, UI, audio, browser storage
```

Key principles:

- **Battle as a pure state machine.** `BattleState` + `applyAction(state, action) → { state, events[] }`. The renderer only plays back `events` (move, hit, faint, capture…). This makes combat fully testable headless and replayable.
- **Seeded RNG** injected into core (`Rng` interface). Combat itself is deterministic; RNG is used only for capture rolls and encounter generation, so tests can fix the seed.
- **Data over code.** Abilities are composed from data-defined effects (damage, push, pull, status, terrain, heal) and target shapes (single, line, cone, burst, self). New moves rarely need new code.
- **Versioned saves.** `{ version: n, ... }` JSON with a migration chain `migrate_n_to_n+1`, stored in IndexedDB/localStorage, with export/import to file.

## 2. Candidate repository comparison

All repositories were cloned at their default branch on 2026-10-24.

| | GDQuest Open RPG | Tactical Slash | wooftactics ("Tactics") | PokéSurvivor |
|---|---|---|---|---|
| Commit | `d59f2f7` (2026-10-13) | `8bf8d83` (2026-07-14) | `00b59f5` (2026-10-17) | `d567c6d` (2026-10-23) |
| Engine / language | Godot 4.7, GDScript | Godot 4.7, GDScript, **3D** | Godot 4.7, **C# / .NET 9** | Vanilla JS + Canvas 2D (+ Firebase) |
| Code licence | MIT | MIT | Apache-2.0 | **PolyForm Noncommercial 1.0.0** since 2026-10-14; MIT only up to commit `b297089` |
| Asset licence | Separate `CREDITS.md`, mostly CC0 (Kenney, Zane Little) | `THIRD_PARTY_ASSETS.md`, all CC0 (KayKit, Kenney, Poly Haven) with hashes | CC BY 4.0 for listed assets only (`ASSET_LICENSE.md`); AI-generated art; separate `TRADEMARKS.md` | Sprites from PMD SpriteCollab, **CC BY-NC 4.0**, many derived from Chunsoft originals |
| Genre fit | JRPG overworld + turn-based (non-grid) combat | Grid tactics, 10×10, LoS, class AI, deployment absent | Deterministic grid tactics, statuses, AI, roguelike run, versioned saves | Bullet-heaven, not tactics |
| Usable with our stack | No (Godot) | No (Godot, 3D) | No (Godot C#) | Technically yes (JS), but different genre |
| Value | Overworld/dialogue/scene-flow architecture reference | Small, readable reference for grid tactics + LoS + AI | **Best architectural reference**: pure core → application → engine adapter, deterministic RNG, save versioning, regression tests | Shows a Pokémon browser game at scale; sprite sourcing and licence pitfalls |
| Recommendation | Learn only | Learn only | Learn only (design patterns) | Do not copy code (NC licence + different genre) |

### Kanto Tactics

No public source repository or technical documentation was found. Public information is a press article describing it as a browser-based, grid-based Pokémon battler inspired by Teamfight Tactics (auto-battler), planned as free. **Not usable as a foundation**; at most a design reference once playable.

### Notes

- **Learning vs copying.** No code will be copied from any candidate. Ideas (layering, event-driven battle playback, provenance manifests) are not copyrightable and may be reimplemented. If a specific snippet is ever adapted from an MIT/Apache project, its notice goes into `THIRD_PARTY_NOTICES.md`.
- **PokéSurvivor licence change** is a good warning: licences can change between commits, so the audit records the exact commit.
- **Pokémon sprites.** PMD SpriteCollab (CC BY-NC 4.0) is the most common community source. NC is compatible with our non-commercial goal, but many sprites are derived from Chunsoft/Nintendo originals, so the licence covers only the artists' own rights. Decision pending (see §6).

## 3. Recommendation for the initial codebase

**Build a clean, focused implementation; adopt no candidate as a foundation.**

Reasons: three candidates are Godot (incompatible with the browser-only Phaser stack), the fourth is a different genre with a non-commercial code licence. Our required core (deployment, deterministic grid combat, capture, 3-KO death) is small enough that a clean TypeScript core is faster than porting.

Stack (versions verified on npm 2026-10-24):

| Tool | Version |
|---|---|
| Node.js | 22 LTS |
| Phaser | 4.2.x |
| TypeScript | 5.x |
| Vite | 8.x |
| Vitest | 5.x |
| Playwright | for browser smoke tests |
| Tiled | map editor, JSON export |

Code licence proposal: **MIT** for original code (simple, community-friendly; no dependency requires otherwise). Original assets: CC BY 4.0. The README and in-game title screen state that the project is unofficial and that no licence grants rights to Pokémon IP.

## 4. Proposed directory structure

```
pokemon_wildfront/
├─ docs/                    brief, audit, design notes, decisions (ADR)
├─ src/
│  ├─ core/                 pure rules, no Phaser imports (enforced by lint rule)
│  │  ├─ grid/              Grid, terrain, pathfinding, line of sight
│  │  ├─ battle/            BattleState, actions, turn order, deployment, resolver
│  │  ├─ abilities/         target shapes, effects
│  │  ├─ rules/             types chart, damage, status effects
│  │  ├─ capture/
│  │  ├─ party/             roster, knockouts, permadeath
│  │  ├─ expedition/        fatigue, camping, encounters
│  │  ├─ ai/
│  │  ├─ save/              schema, migrations
│  │  └─ rng.ts
│  ├─ content/              JSON data + loaders/validators
│  │  ├─ species/  moves/  types.json  balls.json  encounters/  battles/
│  └─ game/                 Phaser
│     ├─ scenes/            Boot, Title, Deployment, Battle, Overworld, Camp
│     ├─ ui/  render/  input/  storage/
├─ public/assets/           sprites, tiles, audio, maps (Tiled JSON)
├─ tests/                   Vitest (core) + scenarios/ (reproducible battles) + e2e/ (Playwright)
├─ .github/                 workflows (test + deploy to Pages), issue templates
├─ ASSETS.md                asset + licence inventory
├─ THIRD_PARTY_NOTICES.md
├─ CONTRIBUTING.md  README.md  LICENSE
└─ package.json  tsconfig.json  vite.config.ts
```

## 5. Minimal vertical slice (Phase 2 target)

One playable battle, deployed to a public GitHub Pages link:

- 10×8 square grid, Tiled map with walls (block movement + LoS) and tall grass (terrain effect, e.g. hides unit from ranged targeting).
- Player party of 4–6 known Pokémon (e.g. Bulbasaur, Charmander, Squirtle, Pikachu, Geodude, Pidgey); choose 3 in deployment.
- Deployment phase: visible enemy formation, inspect enemy, place 3 units in deployment zone, lock.
- 3–4 enemies with distinct roles (e.g. Rattata flanker, Zubat ranged/debuff, Geodude tank, Oddish status).
- Each Pokémon: movement range + 2 moves with defined shape/range; no hit chance.
- Initiative turn order based on Speed, shown as a timeline.
- Effects: damage with type effectiveness (capped so it doesn't dominate), push 1 tile, one status (e.g. poison or slow).
- Simple utility-scoring enemy AI.
- Victory / defeat screen.
- Placeholder art (coloured shapes or CC0 tiles) until the sprite decision is made.

## 6. Unresolved decisions and risks

### Decisions needed

1. **Sprite source.** Options: (a) placeholder shapes for now, (b) PMD SpriteCollab (CC BY-NC, attribution per artist), (c) own/commissioned pixel art. Recommendation: (a) for Phase 2, decide before first public link with Pokémon visuals.
2. **Type effectiveness strength.** Mainline 2×/0.5×/0× or softened (e.g. 1.5×/0.75×, no immunities)? Recommendation: softened, data-configurable.
3. **Turn structure.** Per-unit initiative timeline (Wartales-like) vs. side-based phases. Recommendation: per-unit initiative.
4. **Move set size and data source.** Write our own move definitions (tactical shapes don't exist in mainline). Species base stats are facts and may be entered by hand; no scraped data dumps.
5. **Knockout edge cases.** Retreat, scripted battles, simultaneous KOs, whole-party wipe. Proposal to be written in `docs/design/knockouts.md` before Phase 3.
6. **What happens on party wipe** (game over vs. return to last camp).
7. **Code licence** final confirmation (MIT proposed).

### Technical risks

- **IP takedown** (accepted risk). Mitigation: no ripped assets, clear disclaimer, no monetization, keep code IP-free so the engine survives a content takedown.
- **Mobile browser UX**: small screens and touch on a tactics grid. Mitigation: design camera/zoom and tap-to-confirm from Phase 2.
- **Phaser 4 is a recent major version**; fewer tutorials than Phaser 3. Mitigation: keep Phaser usage confined to `src/game/`.
- **Browser storage can be wiped** by the user/browser. Mitigation: save export/import to file.
- **Balance and fun** are the main project risk, not technology. Mitigation: reproducible scenario files and a headless battle simulator for quick iteration.

## 7. Step-by-step implementation plan

1. **Scaffold** — Vite + TS + Phaser + Vitest, ESLint rule forbidding Phaser in `src/core`, GitHub Actions: test + deploy to Pages. Result: empty game reachable by link.
2. **Grid core** — grid, terrain, movement range, A* pathfinding, LoS + tests.
3. **Battle core** — units, initiative, actions (move/ability/wait), deterministic resolver, events + tests.
4. **Abilities & rules** — target shapes, damage, type chart, push, one status + tests.
5. **Deployment** — deployment zone, party selection (max 3 of 6), lock + tests.
6. **AI** — utility-based target/move scoring + scenario tests.
7. **Battle scene** — Phaser rendering of grid/units, input, event playback, turn timeline, unit inspection, victory/defeat.
8. **Content** — 6 player + 4 enemy species, ~12 moves, one Tiled map.
9. **Playtest & tune** — public link, collect feedback. End of Phase 2.
10. Phases 3–6 as in the brief, each starting with a short design note in `docs/design/`.

## Sources

- https://github.com/gdquest-demos/godot-open-rpg
- https://github.com/sion-rgb/tactical-slash
- https://github.com/cty41/wooftactics
- https://github.com/JPTER78/pokesurvivor
- Kanto Tactics: https://retrododo.com/kanto-tactics-combines-pokemon-with-teamfight-tactics-gameplay/
- Phaser releases: https://phaser.io/download/stable ; npm `phaser@latest` = 4.2.1

## Decisions log

- 2026-10-24: **Placeholder art** (coloured shapes) for Phase 2; final sprite source decided before the first public build with Pokémon visuals.
- 2026-10-24: **Softened type chart**: 1.5× super-effective, 0.75× not very effective, no immunities; values live in data.
- 2026-10-24: Clean implementation, no candidate adopted as a foundation. Code licence MIT.
