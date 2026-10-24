import typeChart from "../../src/content/typeChart.json";
import type { BattleContent } from "../../src/core/battle";

/** Small, hand-tuned content set for rule tests. Numbers are deliberately round. */
export const content: BattleContent = {
  typeChart,
  rules: {
    hpMultiplier: 1,
    damageDivisor: 4,
    impactDamage: 5,
    movementBySpeed: [
      { minSpeed: 90, move: 5 },
      { minSpeed: 60, move: 4 },
      { minSpeed: 0, move: 3 },
    ],
  },
  statuses: {
    poison: { id: "poison", name: "Poison", damagePerTurn: 0.125 },
    slow: { id: "slow", name: "Slow", movePenalty: 2 },
  },
  species: {
    fast: { id: "fast", name: "Fast", types: ["normal"], stats: { hp: 40, attack: 40, defense: 40, speed: 100 }, moves: ["tackle", "shove", "zap", "nova"] },
    mid: { id: "mid", name: "Mid", types: ["water"], stats: { hp: 40, attack: 40, defense: 40, speed: 70 }, moves: ["tackle", "spray", "toxin", "mend", "lasso"] },
    slow: { id: "slow", name: "Slow", types: ["grass"], stats: { hp: 40, attack: 40, defense: 40, speed: 30 }, moves: ["tackle", "ember"] },
  },
  moves: {
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
