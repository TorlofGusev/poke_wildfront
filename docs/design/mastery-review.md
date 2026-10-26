# Mastery review (2026-10-25)

Verified engine facts the review relies on:
- `statusDurationBonus` stacks with no cap and applies to every status (freeze and paralysis included). Poison stacks its turns.
- `vsStatusDamage` triggers on any status, the user's own or a foe's buff included. Only `vsSetupDamage` requires an ally's status. So every "+X% vs status" mastery rewards self-setup.
- `moveBonus` is added after the moveMax cap. When there are several sources of `contactStatus`, the last one wins.
- Talents in no tree (dead content): `bulldozer`, `opening-blow`, `quick-step`, `ambush`.
- The Tank role has no passive mod.

## What works
- Role-tree engagement and combo skills create real setup → payoff decisions: Block, Leer, Lock-On, U-turn, Teleport, Backstab, Feint Attack.
- Type-tree roots amplify the type mechanic: Water push, Fighting flank, Bug swarm, Psychic pull, Rock thorns.
- Two trees (role and type) give build variety. The signature skill at Lv 14 is a canon gen-1 move.

## Weaknesses
- Too much filler: about 11 × −10% damage taken and about 15 × "+20% type damage". All five role capstones (Lv 20) are plain stat packs.
- Duplicates:
  - shared between roles: rally, momentum, steadfast, exploit;
  - within a tree: inferno, relentless, undertow, miasma, nightmare, deadeye, pack-fighter;
  - koHeal three times: moxie, outrage, soul-feast;
  - low-HP damage three times: last-stand, guts, dragon-fury.
- Dead or rarely relevant: Ground impact and push (Ground moves don't push), permafrost, immunity.
- The self-setup `vsStatusDamage` undermines combos as teamwork: Controller passive, type-ghost, scorch, corrode, pest, nightmare, shatter.
- The Tank has no payoff for holding the line.
- Outliers:
  - Ice/Controller freeze grows from 1 to 5 turns;
  - Poison/Controller Toxic reaches 9 turns per application;
  - Sharpshooter gets ×1.59 at 3+ tiles;
  - Water heals 10% per turn (hydration + rain-dish).
- Canon mismatches: Moxie, Guts, Calm Mind, Outrage, Foresight, Hydration, Sturdy-core.

## Top proposals (by impact)
1. Cap status duration bonuses at +2 total. Freeze and paralysis get no bonus.
2. Switch `vsStatusDamage` to `vsSetupDamage` (ally status only) in the Controller passive and in the type masteries.
3. Make the role capstones identity masteries. Examples:
   - Bastion: a foe it engages takes +15% from others.
   - Marksman: a Marked KO resets Lock-On.
   - Killer Instinct: a KO on an engaged foe grants +1 move.
   - Phantom Step: moves past engaged foes, +1 Bond.
   - Mastermind: its statuses spread on KO.
4. Tank payoff:
   - Regrowth heals only while engaged.
   - Second Wind becomes "+1 Bond when an engaged foe draws its free strike".
5. Rebuild the Ground tree around mud terrain. Example: foes on mud take +15%.
6. Replace the duplicates with unique effects. Examples:
   - Undertow: a push breaks the engagement, and pushing a foe into an ally hurts both.
   - Relentless: consecutive hits on the same foe deal more.
7. Canon fixes that also add a decision:
   - Moxie: +1 Attack on KO.
   - Guts: +30% while statused.
   - Sturdy: survives once at 1 HP.
8. Split the Sharpshooter range stack. Example: Deadeye gives +1 range and ignores line of sight against Marked foes.
