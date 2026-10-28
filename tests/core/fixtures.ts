import typeChart from "../../src/content/typeChart.json";
import type { BattleContent } from "../../src/core/battle";

/** Small, hand-tuned content set for rule tests. Numbers are deliberately round. */
export const content: BattleContent = {
  typeChart,
  terms: { bond: "Bond", bondDescription: "", food: "Food", healCenter: "Center", healCenterDescription: "" },
  abilities: {},
  // Profiles are unused by rule tests (species set their stats directly); no type mechanics by default.
  types: Object.fromEntries(Object.keys(typeChart.chart).map((t) => [t, { profile: { hp: 5, attack: 5, defense: 5, speed: 5, willpower: 0, crit: 0 } }])),
  rules: { roleSpeed: { melee: 0, ranged: 0 }, zones: { turns: 2, fireDamage: 0.1, poisonDuration: 2 }, statusBonusCap: 2, engagement: { fallbackPower: 0.5 }, melee: { closeBonus: 1, engagedRangedPenalty: 1 }, momentum: { speedPerStep: 4, stepBonus: 0, max: 0 }, hpPerLevel: 0, hpPerLevelPerDefense: 0, combos: { pincer: { name: "Pincer", engaged: true, damage: 1 }, hex: { name: "Hex", damage: 1 } }, movePower: { max: 100, scale: 4.6, exponent: 0.63, round: 5, basic: 0.85, paid: 1.1, range2: 0.9, range3: 0.85, burst1: 0.8, burst2: 0.7, line: 0.85, cone: 0.8, delayed: 1.3 }, crit: { base: 0, perPoint: 0, damage: 1.5, damagePerPoint: 0 }, willpower: { spiritMax: 100, perHit: 0, perKnockout: 0, perAllyKnockout: 0, perPoint: 0, pumpedTurns: 1, resistPerPoint: 0 },
    // Offsets of 0 keep the arithmetic in tests simple: damage = power × Atk / Def / 4, HP = HP stat.
    hpBase: 0,
    hpPerPoint: 1,
    statOffset: 0,
    damageDivisor: 4,
    // Slow (30) walks 2.9, Mid (70) 4.1, Fast (100) 5.
    movement: { base: 2, perSpeed: 0.03, max: 5 },
    impactDamage: 5,
    bond: { start: 2, max: 6, perKnockout: 1 },
  },
  balls: {
    "poke-ball": { id: "poke-ball", name: "Poké Ball", multiplier: 1 },
    "ultra-ball": { id: "ultra-ball", name: "Ultra Ball", multiplier: 2 },
  },
  capture: { hpThreshold: 0.5, minChance: 0.05, maxChance: 0.95, statusBonus: 1.25, throwRange: { min: 1, max: 3 } },
  statuses: {
    poison: { id: "poison", name: "Poison", damagePerTurn: 0.125 },
    slow: { id: "slow", name: "Slow", movePenalty: 2 },
  },
  species: {
    fast: { id: "fast", name: "Fast", types: ["normal"], stats: { hp: 40, attack: 40, defense: 40, speed: 100, willpower: 0, crit: 0 }, moves: ["tackle", "shove", "zap", "nova"], captureBase: 0.5 },
    mid: { id: "mid", name: "Mid", types: ["water"], stats: { hp: 40, attack: 40, defense: 40, speed: 70, willpower: 0, crit: 0 }, moves: ["tackle", "spray", "toxin", "mend", "lasso"], captureBase: 0.5 },
    slow: { id: "slow", name: "Slow", types: ["grass"], stats: { hp: 40, attack: 40, defense: 40, speed: 30, willpower: 0, crit: 0 }, moves: ["tackle", "ember"], captureBase: 0.5 },
  },
  moves: {
    struggle: { id: "struggle", name: "Struggle", type: "normal", kind: "basic", power: 0, range: { min: 1, max: 1 }, requiresLineOfSight: false, shape: { kind: "single" }, affects: "enemies" },
    tackle: { id: "tackle", name: "Tackle", type: "normal", kind: "basic", power: 40, range: { min: 1, max: 1 }, requiresLineOfSight: false, shape: { kind: "single" }, affects: "enemies" },
    ember: { id: "ember", name: "Ember", type: "fire", kind: "basic", power: 40, range: { min: 1, max: 4 }, requiresLineOfSight: true, shape: { kind: "single" }, affects: "enemies" },
    shove: { id: "shove", name: "Shove", type: "normal", kind: "special", power: 20, cooldown: 2, range: { min: 1, max: 1 }, requiresLineOfSight: false, shape: { kind: "single" }, affects: "enemies", effects: [{ kind: "push", distance: 2 }] },
    lasso: { id: "lasso", name: "Lasso", type: "normal", kind: "special", power: 0, cooldown: 2, range: { min: 2, max: 4 }, requiresLineOfSight: true, shape: { kind: "single" }, affects: "enemies", effects: [{ kind: "pull", distance: 5 }] },
    zap: { id: "zap", name: "Zap", type: "electric", kind: "special", power: 40, cooldown: 2, range: { min: 1, max: 3 }, requiresLineOfSight: false, shape: { kind: "line", length: 3 }, affects: "enemies" },
    spray: { id: "spray", name: "Spray", type: "water", kind: "special", power: 20, cooldown: 3, range: { min: 2, max: 4 }, requiresLineOfSight: true, shape: { kind: "burst", radius: 1 }, affects: "enemies" },
    toxin: { id: "toxin", name: "Toxin", type: "poison", kind: "special", power: 0, cooldown: 3, range: { min: 1, max: 3 }, requiresLineOfSight: true, shape: { kind: "single" }, affects: "enemies", effects: [{ kind: "status", status: "poison", duration: 3 }, { kind: "status", status: "slow", duration: 1 }] },
    mend: { id: "mend", name: "Mend", type: "normal", kind: "special", power: 0, cooldown: 2, range: { min: 0, max: 3 }, requiresLineOfSight: true, shape: { kind: "single" }, affects: "allies", effects: [{ kind: "heal", amount: 15 }] },
    nova: { id: "nova", name: "Nova", type: "normal", kind: "ultimate", power: 80, range: { min: 1, max: 2 }, requiresLineOfSight: false, shape: { kind: "burst", radius: 1 }, affects: "enemies" },
  },
};

import type { PartyMember } from "../../src/core/party";
import type { ProgressionContent } from "../../src/core/progression";

/** Minimal progression rules for tests. */
export const prog: ProgressionContent = {
  talents: {
    power: { id: "power", name: "Power", description: "", stats: { attack: 20 } },
    brutal: { id: "brutal", name: "Brutal", description: "", mods: { damageDealt: 2 } },
    shell: { id: "shell", name: "Shell", description: "", mods: { damageTaken: 0.5 } },
  },
  items: {
    potion: { id: "potion", name: "Potion", description: "", kind: "potion", price: 100, heal: 20 },
    claw: { id: "claw", name: "Claw", description: "", kind: "held", price: 300, mods: { moveBonus: 1 } },
  },
  trees: {},
  rules: { bondCanonPower: 100, focusLevel: 5, focusBonus: 2, focusGrowthEvery: 2, respecCostPerLevel: 10, maxLevel: 30, xpPerLevel: 10, pointsPerLevel: 1, evolutionPoints: 2, candiesPerVictory: 1, statOffer: { size: 3, doubleChance: 0 }, ev: { upgradeCost: 4, offerCost: 3, wildWin: 1, trainerWin: 3, badge: 10, quest: 2 }, xpPerEnemyLevel: 5, benchXpShare: 0.5, moneyPerEnemyLevel: 10, maxActiveMoves: 3 },
};

/** A party member with default progression fields. */
export const pm = (uid: string, speciesId: string, knockouts = 0, hp = 40, extra: Partial<PartyMember> = {}): PartyMember => ({
  uid, speciesId, hp, knockouts, level: 1, xp: 0, focus: null, talents: [], heldItem: null,
  knownMoves: content.species[speciesId]?.moves ?? [], activeMoves: [],
  statPoints: { hp: 0, attack: 0, defense: 0, speed: 0, willpower: 0, crit: 0 }, unspentPoints: 0, ...extra,
});
