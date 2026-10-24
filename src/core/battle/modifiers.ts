/**
 * Everything that changes how one unit fights, from any source: fatigue, held items,
 * talents. Multipliers start at 1, bonuses at 0; sources are combined with `combineModifiers`.
 */
export interface UnitModifiers {
  /** Added to movement points (fatigue −1, Quick Claw +1). */
  readonly moveBonus: number;
  /** Multiplies all damage this unit deals. */
  readonly damageDealt: number;
  /** Multiplies all damage this unit receives. */
  readonly damageTaken: number;
  /** Extra multiplier for moves of a type, e.g. Charcoal: { fire: 1.2 }. */
  readonly typeDamage: Readonly<Record<string, number>>;
  /** Multiplier against targets that have any status effect. */
  readonly vsStatusDamage: number;
  /** Multiplier against targets at full HP. */
  readonly fullHpTargetDamage: number;
  /** Multiplier while this unit is below half HP. */
  readonly lowHpDamage: number;
  /** Fraction of max HP healed at the start of each of its turns. */
  readonly healPerTurn: number;
  /** Extra turns on statuses this unit inflicts. */
  readonly statusDurationBonus: number;
  /** Extra damage when this unit pushes a target into an obstacle. */
  readonly impactBonus: number;
  /** Added to the Fighting flank multiplier. */
  readonly flankBonus: number;
  /** Added to the Bug swarm bonus per helper. */
  readonly swarmBonus: number;
  /** Added to the Grass drain fraction. */
  readonly drainBonus: number;
  /** Extra tiles on pushes / pulls this unit causes. */
  readonly pushBonus: number;
  readonly pullBonus: number;
  /** Per-type damage multipliers that only apply below half HP (Blaze, Torrent…). */
  readonly lowHpTypeDamage: Readonly<Record<string, number>>;
  /** Extra team Bond when this unit knocks out a foe. */
  readonly bondOnKo: number;
  /** Team Bond gained when this unit faints. */
  readonly bondOnFaint: number;
  /** Its bond moves cost this much less (minimum 1). */
  readonly bondCostReduction: number;
  /** Status ids this unit cannot receive ("*" = all). */
  readonly statusImmune: readonly string[];
}

export const NO_MODIFIERS: UnitModifiers = {
  moveBonus: 0, damageDealt: 1, damageTaken: 1, typeDamage: {}, vsStatusDamage: 1, fullHpTargetDamage: 1,
  lowHpDamage: 1, healPerTurn: 0, statusDurationBonus: 0, impactBonus: 0,
  flankBonus: 0, swarmBonus: 0, drainBonus: 0, pushBonus: 0, pullBonus: 0, lowHpTypeDamage: {}, bondOnKo: 0, bondOnFaint: 0, bondCostReduction: 0, statusImmune: [],
};

export function combineModifiers(...parts: readonly Partial<UnitModifiers>[]): UnitModifiers {
  return parts.reduce<UnitModifiers>((acc, p) => {
    const typeDamage: Record<string, number> = { ...acc.typeDamage };
    for (const [t, m] of Object.entries(p.typeDamage ?? {})) typeDamage[t] = (typeDamage[t] ?? 1) * m;
    const lowHpTypeDamage: Record<string, number> = { ...acc.lowHpTypeDamage };
    for (const [t, m] of Object.entries(p.lowHpTypeDamage ?? {})) lowHpTypeDamage[t] = (lowHpTypeDamage[t] ?? 1) * m;
    return {
      moveBonus: acc.moveBonus + (p.moveBonus ?? 0),
      damageDealt: acc.damageDealt * (p.damageDealt ?? 1),
      damageTaken: acc.damageTaken * (p.damageTaken ?? 1),
      typeDamage,
      vsStatusDamage: acc.vsStatusDamage * (p.vsStatusDamage ?? 1),
      fullHpTargetDamage: acc.fullHpTargetDamage * (p.fullHpTargetDamage ?? 1),
      lowHpDamage: acc.lowHpDamage * (p.lowHpDamage ?? 1),
      healPerTurn: acc.healPerTurn + (p.healPerTurn ?? 0),
      statusDurationBonus: acc.statusDurationBonus + (p.statusDurationBonus ?? 0),
      impactBonus: acc.impactBonus + (p.impactBonus ?? 0),
      flankBonus: acc.flankBonus + (p.flankBonus ?? 0),
      swarmBonus: acc.swarmBonus + (p.swarmBonus ?? 0),
      drainBonus: acc.drainBonus + (p.drainBonus ?? 0),
      pushBonus: acc.pushBonus + (p.pushBonus ?? 0),
      pullBonus: acc.pullBonus + (p.pullBonus ?? 0),
      lowHpTypeDamage,
      bondOnKo: acc.bondOnKo + (p.bondOnKo ?? 0),
      bondOnFaint: acc.bondOnFaint + (p.bondOnFaint ?? 0),
      bondCostReduction: acc.bondCostReduction + (p.bondCostReduction ?? 0),
      statusImmune: [...new Set([...acc.statusImmune, ...(p.statusImmune ?? [])])],
    };
  }, NO_MODIFIERS);
}
