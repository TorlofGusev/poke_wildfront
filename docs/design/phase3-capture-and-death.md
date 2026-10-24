# Phase 3 design: capture, knockouts, roster and saving

Decisions confirmed by the project owner on 2026-10-24.

## Roster

- **Party**: max 6. Only party members can be deployed (max 3 per battle).
- **Storage (PC box)**: unlimited. A capture with a full party goes to storage. The player can swap between party and storage at camp.
- **Fallen**: Pokémon that reached 3/3 knockouts. Shown in a memorial list; never deployable, never healable, never movable back.
- The party may never exceed 6, enforced in capture, swapping, loading and UI.

## Knockout counter

- A player Pokémon whose HP reaches 0 during a battle gets **+1 KO** when the battle is resolved, whatever the outcome (victory, defeat, retreat).
- Each Pokémon can be knocked out at most once per battle (there is no in-battle revive), so simultaneous knockouts simply count once per Pokémon.
- At **3/3** the Pokémon moves to *Fallen* immediately after the battle.
- Healing, resting and evolution never change the counter.
- Pokémon that were not deployed are never affected.
- Scenarios may set `countsKnockouts: false` (scripted/tutorial battles); then no counter changes.

## Battle endings

| Ending | Trigger | Result |
|---|---|---|
| Victory | no enemies left (fainted or captured) | survivors keep current HP |
| Defeat | all deployed player Pokémon fainted | KOs recorded; party returns to the last camp (prototype: full rest at camp) |
| Retreat | player chooses *Retreat* on any player turn | KOs already suffered are recorded; no rewards; survivors keep current HP |

## Capture

- Available only in battles with `captureAllowed: true` (wild encounters), against enemy Pokémon **below 50% HP**.
- Throwing a ball is the unit's **action** for the turn, range **1–3**, needs line of sight. Grass concealment applies (target must be adjacent if it hides in tall grass).
- The ball is **always consumed**, success or failure.
- Success removes the target from the battle (counts towards victory) and adds it to the roster after the battle at its current HP.
- Failure: nothing else happens; the shown chance was the real chance.

Formula (all numbers in `src/content/capture.json` and species data):

```
hpFactor   = 1 + (threshold - hpFraction) / threshold      // 1.0 at 50% HP → ~2.0 near 0 HP
statusMult = statusBonus if the target has any status, else 1
chance     = clamp(speciesCaptureBase × ballMultiplier × hpFactor × statusMult, minChance, maxChance)
```

`minChance > 0` guarantees every species is capturable in principle. The roll uses the battle's seeded RNG, so a battle replayed with the same seed and actions gives the same result.

## Saving

- One autosave slot in browser storage, written after every battle and roster change.
- Format: `{ "version": 1, "savedAt": ISO date, "roster": … , "inventory": … }`.
- Loading runs `migrate(save)` step by step up to the current version, then validates (party ≤ 6, unique ids, fallen never in party/storage, KO counts 0–3). An invalid save is rejected with a readable error instead of being loaded half-broken.
