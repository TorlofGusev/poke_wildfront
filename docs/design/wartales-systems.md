# Wartales-style systems: crafting, gear, minigames, camp

Status: **proposal, not started** (discussed 2026-10-26). Pick up from here when the next system is chosen.
In-game text stays English; this file is the design reference.

## Goals

- Bring Wartales' "gather → build → spend" loop into the game without breaking the Pokémon feel.
- Give money a sink: a full campaign simulation ends around ₽56k with little to buy.
- Every addition must be a real choice (what to craft, which upgrade to buy), not busywork.

## 1. Materials and crafting (recommended, first)

Canon anchor: Kurt's Apricorn balls (Gen 2), berry blending, item crafting in Legends: Arceus.

**Materials** (key-item style stacks in the bag, no weight limit):
- *Apricorns* (Red, Blue, Yellow, Green, Pink, White, Black): picked from trees on routes; regrow after rests.
- *Berries*: already exist as food; also crafting inputs.
- *Minerals*: Iron Ore, Hard Stone shards, Fire/Water/Thunder/Leaf Stone shards; from caves, Diglett Cave, Mt. Moon.
- *Pokémon drops*: Shed Skin, Feather, Fang, Spore, Scale; from wild battles by the foes' types
  (a Bug drops Silk/Shed Skin, a Bird a Feather). Gives wild battles a reward beyond XP.

**Recipes** (crafted at the camp Workbench, see §4):
| Output | Inputs (example) | Notes |
|---|---|---|
| Fast / Heavy / Lure / Level / Love / Friend / Moon Ball | 3 Apricorns of a colour + 1 Iron Ore | Better capture odds under conditions (fast, heavy, water, lower level…) |
| Type booster (Charcoal, Mystic Water…) | Stone shard + 2 drops of that type | Same as shop items, cheaper; base for upgrades |
| Remedies (Revival Herb, status heals) | Berries + Spore/herbs | |
| Meals | Berries + food (existing meal system moves here) | |

Recipes are learned: a few known from the start, more from NPCs (Kurt-like crafter in a city, Celadon herbalist),
gym rewards and quests.

## 2. Gear variety and quality (recommended, with crafting)

Keep one canon **held item** slot per Pokémon. Depth comes from quality and affixes instead of more slots.

- **Quality tiers**: Common (shop) → Fine → Masterwork (crafted only).
  Example: Charcoal +15% Fire → Fine Charcoal +20% → Masterwork Charcoal +20% and one affix.
- **Affixes** (one, rolled or chosen when crafting a Masterwork item): +1 movement, +1 range, Burn on contact,
  +10% vs engaged foes, start with +1 Bond… reusing existing battle modifiers.
- **Upgrade**: a Common item + materials → Fine at the Workbench.
- Optional later: a team-wide **Trainer gear** slot (Exp. Share, Amulet Coin, Scope Lens, Silph Scope) — one or two
  per team, team effects.

## 3. Crafting minigame (only one, small)

Wartales has smithing minigames; one short one is enough here:
- **Apricorn polishing**: a timing bar (tap when the marker is in the zone, 3 taps). Result sets quality:
  0–1 hits Common, 2 Fine, 3 Masterwork (Masterwork also needs the recipe's extra material).
- Can be skipped (auto-result Common) so it never becomes mandatory busywork.
- Not planned: more minigames; they break the tactics rhythm.

## 4. Camp furniture / upgrades (recommended, small set)

Bought once with money + materials; shown as objects on the camp screen.
| Upgrade | Effect |
|---|---|
| Workbench | Unlocks crafting (§1). Level 2: Fine items; level 3: Masterwork. |
| Cooking Pot | Better meals (current meal system); level 2 unlocks two-buff meals. |
| Berry Planter | Plant a berry; it yields several after N rests (Gen 3 berry planting). |
| Training Dummy | Bench Pokémon (not deployed) gain a little XP each rest. |
| Care Tent | Slowly treats knockout marks for free over rests (instead of paying ₽150 per mark). |
| Tent upgrades | Less fatigue per day / +1 rest slot. |

## Not planned (poor fit for Pokémon)

- Crime / bandit reputation, prisoners, selling captives.
- Wages and morale paid to Pokémon (Bond and fatigue already cover this role).
- Weight-limited inventory.

## Suggested order

1. Materials + drops + Workbench (camp) + Apricorn balls and type-booster recipes.
2. Quality tiers and Workbench levels.
3. Other camp upgrades (Cooking Pot, Berry Planter, Training Dummy, Care Tent).
4. Polishing minigame, if still wanted.

## Open questions

- Should drops be random or fixed per species (e.g. every Caterpie drops Silk)?
- Should crafting happen only in camp, or also at city crafter NPCs (for a fee)?
- Should Masterwork affixes be rolled or chosen?
