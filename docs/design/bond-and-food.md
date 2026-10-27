# Bond and food

Approved by the owner on 2026-10-24. "Bond" is the in-game name of the Wartales-style Valour/vigor resource; it lives in `src/content/terms.json` (with the food term) so the setting can be swapped without code changes.

## Bond (team-wide)

- One pool per side, shown above the move buttons. Default: starts at **2**, cap **6** (`rules.json` → `bond`).
- **Gains**: +1 for each foe knocked out (+ the attacker's *Rally*), +2 when a Pokémon with *Second Wind* faints.
- **Start and cap** are raised by the deployed Pokémon's team talents (*Steadfast* +1 start, *Deep Bond* +1 cap) and by the current meal.
- **Move kinds** (one action per turn): *basic* (free), *special* (cooldown), *ultimate* (once per battle) and **bond** (costs team Bond: Solar Beam 3, Thunder 3, Fire Blast 3, Hydro Pump 2, Rage 1). *Momentum* makes its user's bond moves 1 cheaper (minimum 1).
- Enemies have their own pool and the AI weighs the cost before spending.

## Talents

The stat-filler nodes of the talent trees were replaced by Bond talents: Steadfast, Deep Bond, Rally, Second Wind, Momentum.

## Food and meals

- Food items (berries) come from the Poké Mart (₽60), from foraging after each won wild battle (per biome, `biomes.json` → `forage`) and the starting bag.
- **Resting is a choice at camp** ("Rest here…"): cook one of the meals (`meals.json`) or rest hungry (`camp.json`).
  - A meal uses its ingredients, fully restores HP and fatigue, and its effect lasts until the next rest (e.g. Big Malasada: battles start with +1 Bond; Rage Candy Bar: +10% damage; Old Gateau: +1 Bond cap and −10% damage taken).
  - Resting hungry restores only 50% HP, leaves fatigue at 40 and the team starts battles with −1 Bond.
- Either way wild groups move and the camp becomes the respawn point.
