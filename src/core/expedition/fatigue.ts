export interface FatigueLevel {
  readonly minFatigue: number;
  readonly name: string;
  readonly movePenalty: number;
  readonly damageMultiplier: number;
}

export interface FatigueRules {
  readonly max: number;
  /** Sorted by minFatigue descending. */
  readonly levels: readonly FatigueLevel[];
}

export function fatigueLevel(rules: FatigueRules, fatigue: number): FatigueLevel {
  const level = rules.levels.find((l) => fatigue >= l.minFatigue);
  if (!level) throw new Error(`no fatigue level for ${fatigue}`);
  return level;
}

/** Fatigue after entering one tile with the given travel cost. */
export function addTravelFatigue(rules: FatigueRules, fatigue: number, travelCost: number): number {
  return Math.min(rules.max, fatigue + travelCost);
}
