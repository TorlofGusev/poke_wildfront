# Wartales / Battle Brothers perk research (2026-10-25, web-sourced)

The wikis refused automated access (HTTP 401/402/403). Battle Brothers numbers come from the Gamer of Passion perk guide;
Wartales from gamepretty, Steam threads and search excerpts. [NV] = not verified.

Sources:
- https://gamerofpassion.com/battle-brothers-perk-guide/ (BB, all tiers, exact numbers)
- https://gamepretty.com/wartales-all-skill-mastery-bonuses/
- https://steamcommunity.com/app/1527950/discussions/0/6169410373943658806
- https://steamcommunity.com/app/1527950/discussions/0/4032476115582171920
- https://www.itechguides.com/wartales-beginners-guide-to-classes-skills-and-party-builds/
- https://steamdb.info/patchnotes/15914766

## Wartales
- Specialisation milestones at about Lv 2/3/5/8/10/12 [NV]: at each one, pick 1 of 2–4 options. Some options are passives (often granting Valour when a condition holds), others active skills (often costing Valour).
- The first specialisation that grants a skill renames the class (e.g. Warrior → Berserker / Executioner / Barbarian / Sentinel).
- Skill Mastery Books are rare items. The player chooses which unit's skill to upgrade with one.
- Respec costs money at the Brotherhood. Hidden specialisations come from quests.
- Core patterns:
  - **Status chains:** Bleed → Assassin deals double damage; Bleed/Burn → Fever; Bleed → Poison stacks (Smasher).
  - **Engagement manipulation as the main currency:**
    - Strategist and Thunderous Blow force a disengage, so the target draws the opportunity attacks.
    - Pikeman: the first enemy to step in takes a strike and loses its remaining movement.
  - **Riposte:** an engaged target struck directly hits back, at most once per turn after the patch nerf.
  - **Valour from positioning:** e.g. +1 for ending a turn next to a foe without being engaged.

## Battle Brothers
- Levels 2–11 give 1 perk each, so 10 perks out of about 50, spread over 7 tiers. Student gives +1 perk at Lv 11.
- Rule-changing perks define builds; stat perks are glue.
- Notable perks (exact):

| Perk | Effect |
|---|---|
| Footwork | 3 AP: leave the Zone of Control without free attacks |
| Rotation | 3 AP: swap places with an ally, ignoring the Zone of Control |
| Taunt | the target can't use Riposte, Shieldwall, Rotation or pushes against the taunter until its next action |
| Indomitable | 5 AP: −50% damage until its next turn; immune to stun and displacement |
| Nine Lives | once per battle, survives a fatal blow with 11–15 HP and clears Bleed and Poison |
| Berserk | once per turn, +4 AP on a kill |
| Killing Frenzy | +25% damage for 2 turns after a kill; a new kill resets the timer, it does not stack |
| Executioner | +20% damage against injured targets |
| Overwhelm | each attack on a target that acts later gives it −10% skill (hit chance) for 1 turn; stacks without cap, also on a miss |
| Underdog | removes the surround defence penalty |
| Lone Wolf | +15% to all main stats while no ally is within 3 tiles |
| Anticipation | extra ranged defence per tile of distance |
| Reach Advantage | +5 melee defence per two-handed hit, stacks to 5 |

- **Nimble vs Battle Forged:** in practice the two exclude each other through gear (light vs heavy armour).

## Lessons for Wildfront (applied 2026-10-25)
- Fewer, heavier picks:
  - Role trees: 5 points (Lv 4/8/12/16/20) over 6–7 nodes.
  - Type trees: 3 points (Lv 6/12/18) over 5 nodes.
  - That is 8 picks in total, close to Battle Brothers' 10.
- Rule changers at the skills and capstones; filler removed.
- Status chains and ally-setup payoffs (vsSetupDamage, vsStatusIdDamage) instead of self-setup.
- Paid respec at the Pokémon Center fits the Brotherhood model (already in the backlog).

## Candidates (not built yet)
- Riposte → "Counter"-style: once per turn, the engaged partner strikes back when hit. Needs a new mod.
- Forced disengage → Roar / Whirlwind: the foe is pushed out of its engagement and the ally it was engaged with gets a free strike.
- Pikeman zone → Bind-style: the first foe to step next to it takes a strike and its movement drops to 0.
- Taunt (Battle Brothers form) → its target can't disengage from or push the taunter.
- Rotation → swap places with an ally; the engagement passes to the unit that swapped in.
- Indomitable / Nine Lives → Withdraw / Endure variants.
- Killing Frenzy (timed, resetting) as an alternative to Beast Boost.
- Executioner → +20% against foes below half HP.
- Valour from positioning → +1 Bond for ending a turn next to a foe without engaging it.
- Skill-mastery books (TMs) as rare loot for upgrading a skill.
