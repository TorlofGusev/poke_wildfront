# Project Brief: Open-Source Pokémon Tactical RPG

## 1. Project Vision

Build a free, open-source, single-player Pokémon tactical RPG inspired by the tactical combat, party management, exploration, and expedition systems of Wartales.

The game should combine:

- Pokémon collection, capture, evolution, types, and moves.
- Wartales-style grid-based tactical combat.
- A mandatory pre-battle deployment phase.
- An explorable overworld with biome-specific wild encounters.
- Expedition fatigue, camping, and sleeping.
- Permanent Pokémon death after three combat knockouts.
- A six-Pokémon party limit, with a smaller active combat roster.
- A browser-playable build.

This is a hobby project intended for personal enjoyment and community development. Monetization is not a goal.

## 2. Intellectual Property and Project Philosophy

The project deliberately uses the Pokémon IP, including Pokémon names, characters, and the Kanto setting. This is a conscious decision to create an unofficial fan game, not a request to replace Pokémon with original creatures.

The project must:

- Remain free to play.
- Avoid advertising, paid content, and monetization systems.
- Be developed with public source code and community contributions in mind.
- Clearly identify itself as an unofficial, unaffiliated fan project.
- Keep the original project code and third-party assets/licences documented separately.

The developer understands that non-commercial distribution and open-source code do not grant permission to use Pokémon IP. There is a risk of takedown or other action by the relevant rights holders. Do not derail development by proposing an original-IP replacement unless explicitly requested.

Before publishing, audit all third-party code, graphics, audio, fonts, and other assets. Do not assume that assets distributed by fan communities are freely reusable.

## 3. Target Platform and Technology

**The browser is the only target platform.** There is no installable desktop or mobile build. Anyone must be able to open a link and play immediately.

Selected stack:

- **Engine:** Phaser (latest stable release).
- **Language:** TypeScript.
- **Build tool:** Vite.
- **Maps:** Tiled map editor (JSON export), loaded natively by Phaser.
- **Content data:** JSON files validated against typed schemas.
- **Tests:** Vitest, running headless against pure game logic.
- **Saves:** Browser storage (localStorage / IndexedDB) using a versioned JSON format.

Target rendering:

- 2D top-down or lightweight isometric presentation.
- Pixel art is acceptable and preferred for a manageable hobby scope.
- Grid-based tactical battles.
- Must run on current desktop browsers; mobile browser support is a goal (touch input, responsive scaling).

Keep the initial download small and load assets on demand. Avoid dependencies that require a backend or native code.

The project should be easy to clone, install (`npm install`), run (`npm run dev`), test, and build by contributors.

Hosting:

- GitHub for source code, issues, documentation, and community contributions.
- Static web hosting for the playable build (provider to be decided later; GitHub Pages and itch.io are candidates).

No multiplayer, persistent online world, backend account system, or server infrastructure is required for the initial version.

### Engine decision record

Godot 4 was originally preferred. It was replaced by Phaser + TypeScript because the browser became the sole target:

- Godot web exports carry a ~30-40 MB engine payload; a Phaser game loads in a fraction of that.
- Godot 4 web exports remain unreliable on some mobile browsers (notably iOS Safari).
- A web-native stack needs no export step and deploys as a static site on every push.
- TypeScript is familiar to a much larger pool of potential contributors.

Accepted trade-offs: no integrated visual scene editor (Tiled covers maps; UI is built in code), and more infrastructure (scene flow, saving, input) must be written by the project.

## 4. World and Scope

The initial game content is limited to the Kanto region and the original 151 Pokémon.

The game should feature an explorable overworld with:

- Routes and interconnected areas.
- Forests, caves, mountains, water-adjacent areas, and settlements.
- Wild Pokémon encounters.
- Trainer encounters.
- Hand-authored named encounters and unique battles.
- Biome-specific spawn tables for ordinary wild Pokémon.
- Camping locations or opportunities for safe camping.
- Progression and exploration rewards.

Do not attempt to implement the entire region immediately. Start with a small, playable vertical slice and expand only after the core combat is fun.

Design content systems so community contributors can add or modify Pokémon definitions, abilities, encounters, maps, and other data without rewriting the combat engine.

## 5. Core Party Rules

- Maximum party size: 6 Pokémon.
- Maximum active Pokémon in battle: 3 initially.
- Remaining party members are reserves.
- The active roster is selected during the pre-battle deployment phase.
- Captured Pokémon can be added to the party if a slot is available.
- If the party is full, the player must make a meaningful roster decision.
- A separate storage system may be considered, but it should not become a prerequisite for the first prototype.

The roster limit must be enforced consistently in gameplay, saving, loading, capture, and UI.

## 6. Team Composition and Synergy

Do not require multiple Pokémon of the same type to activate team synergies.

The preferred design rewards complementary roles and tactical combinations between different Pokémon.

Examples of useful roles:

- Tanking and protecting allies.
- Area denial and battlefield control.
- Displacement, pushing, and pulling.
- Flanking and mobility.
- Ranged attacks.
- Healing and support.
- Status effects and debuffs.
- Terrain manipulation.
- Area-of-effect damage.

Synergies should emerge from individual abilities and positioning rather than arbitrary same-type party bonuses.

Type effectiveness remains relevant but should not completely dominate tactical decisions. A Pokémon's movement, ability geometry, utility, and position should all matter.

Do not implement mandatory duplicate-type bonuses.

## 7. Tactical Combat

Combat uses a discrete square grid in a 2D or lightweight isometric presentation.

Every battle **MUST** begin with a deployment phase.

### Deployment phase

Before the first combat turn:

1. Reveal the visible enemy formation.
2. Let the player inspect available information about enemy units.
3. Select up to three active Pokémon from the party.
4. Place them within the player's deployment zone.
5. Allow the player to react to enemy composition, terrain, and likely threats.
6. Lock the deployment and begin combat.

Enemy information may be incomplete in appropriate encounters. Do not reveal hidden information automatically if scouting or discovery could become a meaningful mechanic.

### Combat mechanics

The tactical system should support:

- Movement and pathfinding.
- Occupied and blocked tiles.
- Movement ranges.
- Ability ranges and targeting shapes.
- Line of sight where appropriate.
- Terrain effects and obstacles.
- Turn order or initiative.
- Status effects.
- Push/pull and displacement.
- Area-of-effect abilities.
- Enemy AI.
- Battle victory and defeat resolution.

Avoid random hit chance. If an attack's targeting requirements are satisfied, it should resolve predictably unless a specific, clearly communicated ability rule says otherwise.

Randomness may still be used for encounter generation or other systems where it adds value, but core tactical combat should emphasize deterministic decision-making.

The AI should make reasonable tactical choices based on unit roles, targets, threat, positioning, and ability availability. It does not need to be computationally sophisticated in the first version.

## 8. Fatigue, Camping, and Sleeping

Fatigue represents travel and expedition exhaustion, not general activity.

Rules:

- Only overworld travel/marching accumulates fatigue.
- Tactical combat does not directly accumulate marching fatigue.
- Capturing Pokémon and interacting with objects do not directly accumulate marching fatigue.
- Camping and sleeping restore fatigue.
- Fatigue may influence combat performance once it has accumulated, but its effects must be clearly communicated.
- The player should be able to make meaningful choices about when to continue travelling and when to rest.

Do not introduce hunger, thirst, or complex survival mechanics unless they are proven necessary. The goal is medium-depth party management, not a survival simulator.

Camping should become a meaningful expedition-management decision without requiring constant micromanagement.

## 9. Permanent Pokémon Death

Adopt a three-knockout permanent-death system inspired by Zero Company.

Each Pokémon has a persistent combat knockout counter:

- 0/3: no recorded knockouts.
- 1/3: first knockout.
- 2/3: final warning.
- 3/3: permanent death.

Rules:

- A genuine combat knockout increments the counter by one.
- On the third knockout, the Pokémon is permanently removed from the available roster.
- Healing and resting do not reset the counter.
- Evolution does not reset the counter.
- Ordinary defeat should not automatically increment the counter for every Pokémon in the party; only actual knockouts count.
- Permanent death must persist through saving and loading.
- A permanently lost Pokémon must not be recoverable through ordinary healing.

Display the counter clearly enough for the player to understand the risk before committing to another battle.

The exact handling of scripted battles, retreats, simultaneous knockouts, and exceptional defeat conditions should be explicitly specified and tested.

## 10. Pokémon Capture

Capture follows a Wartales-inspired prisoner-collection model.

Rules:

- Wild Pokémon are encountered as enemies in tactical combat.
- Capture becomes available after the target falls below 50% HP.
- The player must carry Poké Balls into the battle.
- Using a Poké Ball consumes an item.
- Capture has a probability of success.
- Better Poké Ball types increase the probability.
- Lower target HP increases the probability.
- An unconscious or equivalent incapacitated state may provide an additional bonus.
- Every Pokémon species must be capturable in principle.
- Some species may be more difficult to capture, but no species should be categorically excluded from capture.
- A successful capture must respect the six-Pokémon party limit.

Use a configurable capture formula. Keep species capture difficulty, ball modifiers, HP modifiers, and incapacitation modifiers in data rather than hardcoding them throughout the combat logic.

Define capture failure behavior explicitly. The player should understand that a failed attempt consumes the ball unless a deliberate game rule says otherwise.

Do not implement breeding, competitive PvP, trading, or a complete simulation of every mainline Pokémon mechanic in the initial prototype.

## 11. Biome-Specific Encounters

Ordinary wild encounters should be determined by biome and encounter data.

Examples:

- Forests and tall grass.
- Caves.
- Mountains.
- Water-adjacent environments.
- Other appropriate Kanto habitats.

Named trainers, rivals, bosses, and unique encounters should use deliberately designed enemy rosters rather than generic biome spawn rules.

Keep encounter tables data-driven and easy to extend. Encounter generation must respect the intended progression and should not produce obviously inappropriate enemy compositions.

## 12. Technical Architecture

Separate game logic from visual presentation.

Suggested systems:

- World/overworld controller.
- Encounter manager.
- Tactical battle controller.
- Grid and pathfinding.
- Turn manager.
- Deployment manager.
- Ability resolver.
- Type-effectiveness rules.
- Status-effect system.
- Pokémon data and progression.
- Capture manager.
- Party and roster manager.
- Fatigue and camping.
- Permanent-death handling.
- Save/load system.
- UI and battle feedback.
- Enemy AI.

Pokémon, moves, capture modifiers, encounter tables, and other content should use typed JSON data files (or another appropriate data-driven representation).

Avoid embedding all rules in scene scripts. The core combat rules should be testable independently from animations and UI.

Design the save format so it can be versioned and migrated as the project evolves.

## 13. Open-Source and Community Requirements

The project should be suitable for public development on GitHub.

Requirements:

- Clear setup instructions.
- Documented Node.js and Phaser versions.
- Reproducible project structure.
- A documented build and deployment process.
- A test suite for core rules.
- A contribution guide.
- Issue templates or an equivalent lightweight bug-reporting process.
- An asset and licence inventory.
- A clear separation between engine code, game content, and third-party resources.

Choose an appropriate licence for the project's original code after auditing dependencies and considering the intended community workflow. Do not claim that a code licence grants rights to Pokémon IP.

The project should be community-friendly, but the initial development target remains a small, maintainable single-player game.

## 14. Testing and Quality

The following must have automated tests where practical:

- Movement legality and pathfinding.
- Ability range and targeting.
- Type-effectiveness calculations.
- Damage and status resolution.
- Turn order.
- Capture probability and capture eligibility.
- Party size limits.
- Knockout counters and permanent death.
- Fatigue accumulation and rest recovery.
- Save/load persistence.
- Encounter generation constraints.

Prefer deterministic combat simulation tests that can run without rendering the game.

Create reproducible battle scenarios for debugging and balance analysis.

The production build should be smoke-tested in a real browser (e.g. automated with Playwright) in addition to the headless rule tests.

## 15. Existing Project Investigation

Before implementing the game, investigate these candidate projects:

1. GDQuest Open RPG: https://github.com/gdquest-demos/godot-open-rpg
2. Tactical Slash: https://github.com/sion-rgb/tactical-slash
3. wooftactics: https://github.com/cty41/wooftactics
4. PokéSurvivor: https://github.com/JPTER78/pokesurvivor

Also investigate whether Kanto Tactics has a publicly available source repository or reusable technical documentation.

For every candidate:

- Verify the current repository and commit.
- Inspect the actual licence at the intended commit.
- Determine whether it is technically compatible with the selected stack (Phaser + TypeScript, browser-only). Godot projects can only serve as architectural references, not as code sources.
- Identify reusable architecture and systems.
- Check whether code, art, sound, and other assets have separate licences.
- Distinguish learning from a reference implementation from actually copying code.
- Evaluate whether adopting the project would save more work than building a clean, focused implementation.

Do not assume a project is reusable simply because its source is publicly visible.

Do not copy proprietary Pokémon game assets or data dumps from commercial games.

Deliver a comparison matrix and a recommendation before committing to a foundation.

## 16. Development Workflow

Work in the following order.

### Phase 1: Repository and feasibility audit

- Inspect the candidate projects.
- Verify licences and technical compatibility.
- Recommend the engine architecture.
- Define the smallest viable prototype.
- Identify unresolved design questions.

### Phase 2: Tactical combat prototype

Build one small battle map with:

- A square grid.
- Three controllable Pokémon.
- Several distinct enemy units.
- Mandatory deployment.
- Movement and deterministic attacks.
- Ability ranges and basic terrain.
- Turn management.
- A simple enemy AI.

The combat prototype should be playable before the overworld is developed.

### Phase 3: Capture and death

- Poké Ball inventory.
- HP-based capture chance.
- Multiple Poké Ball types.
- Capture and party-limit handling.
- Three-knockout permanent death.
- Save/load persistence.

### Phase 4: Expedition systems

- A small explorable map.
- Biome-specific wild encounters.
- Marching fatigue.
- Camping and sleeping.
- Basic progression and healing.

### Phase 5: Browser release

- Automated deployment to GitHub Pages is set up from Phase 2 onward; this phase hardens it.
- Test on current desktop browsers and at least one mobile browser.
- Document how to run locally and how to build and deploy.
- Publish a stable, shareable link to the playable build.

### Phase 6: Expand Kanto

Only after the vertical slice is fun and stable should the project expand with additional Pokémon, locations, encounters, quests, and community contributions.

## 17. Expected First Deliverables

Do not immediately implement the entire game.

The first response should contain:

1. A concise summary of the proposed architecture.
2. A verified comparison of the candidate repositories and their licences.
3. A recommendation for the initial codebase.
4. A proposed project directory structure.
5. A minimal vertical-slice feature list.
6. A list of unresolved decisions and technical risks.
7. A step-by-step implementation plan.

After approval, begin implementation incrementally. Keep the project runnable at each milestone, and report concrete file changes, tests performed, and outstanding issues.

The primary success criterion is a fun, tactical, browser-playable prototype that can grow into a community-developed Kanto Pokémon game.
