/**
 * Everything that changes how one unit fights, from any source: fatigue, held items,
 * talents. Multipliers start at 1, bonuses at 0; sources are combined with `combineModifiers`.
 */
export interface UnitModifiers {
  /** Added to movement points (fatigue −1). */
  readonly moveBonus: number;
  /** Extra max range on moves that already reach 2+ hexes; only Bond moves may go past 3 (see moveRange). */
  readonly rangeBonus: number;
  /** Damage multipliers against targets out of melee reach, and in it. */
  readonly farDamage: number;
  readonly closeDamage: number;
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
  /** Status its damaging hits on adjacent foes inflict (Flame Body, Toxic Barbs). */
  readonly contactStatus: { readonly status: string; readonly duration: number } | null;
  /** Fraction of its max HP healed when it knocks out a foe. */
  readonly koHeal: number;
  /** Damage dealt back to a foe that hits it from an adjacent tile. */
  readonly thorns: number;
  /** Damage multiplier against foes engaged with one of its allies (flanking a pinned foe). */
  readonly vsEngagedDamage: number;
  /** Team Bond gained when this unit lands a combo (once per action). */
  readonly comboBond: number;
  /** Damage multiplier against foes carrying a status an ally applied. */
  readonly vsSetupDamage: number;
  /** Steps away from engaged foes without free attacks. */
  readonly disengage: boolean;
  /** Status ids this unit cannot receive ("*" = all). */
  readonly statusImmune: readonly string[];
  /** Damage multiplier foes engaged with this unit take from its allies (Mean Look). */
  readonly pinDamage: number;
  /** Damage multiplier of its free strikes on foes breaking away (Pursuit). */
  readonly strikeDamage: number;
  /** Damage multiplier against foes standing on mud (Sand Force). */
  readonly vsMudDamage: number;
  /** Damage multiplier while 2+ foes stand next to it (Defiant). */
  readonly surroundedDamage: number;
  /** Damage multiplier while it carries any status (Guts). */
  readonly statusedDamage: number;
  /** Multiplies damage it receives while at full HP (Multiscale). */
  readonly fullHpDamageTaken: number;
  /** Attack gained (this battle, max +3) when it knocks out a foe (Moxie). */
  readonly koAttackBoost: number;
  /** Movement regained when it knocks out a foe on its turn (Speed Boost). */
  readonly koMove: number;
  /** Extra fraction of max HP healed per turn while engaged (Ingrain). */
  readonly healWhileEngaged: number;
  /** Team Bond gained when its free strike hits a foe breaking away. */
  readonly bondOnStrike: number;
  /** Extra damage per consecutive hit on the same foe, up to 3 stacks (Fury Cutter). */
  readonly furyCutter: number;
  /** Movement bonus while it carries any status (Quick Feet). */
  readonly statusedMove: number;
  /** Cooldown reduction of its non-damaging special moves, minimum 1 (Prankster). */
  readonly statusCooldownReduction: number;
  /** Knocking out a foe on its turn lets it use its basic attack again. */
  readonly koRefreshBasic: boolean;
  /** Knocking out a foe resets its special move cooldowns (Mind Reader). */
  readonly koResetCooldowns: boolean;
  /** When a foe carrying a status it applied faints, adjacent foes catch that status. */
  readonly statusSpreadOnKo: boolean;
  /** Sheds statuses foes put on it at the start of its turn (Hydration). */
  readonly shedStatuses: boolean;
  /** Survives one knockout blow per battle at 1 HP. */
  readonly sturdy: boolean;
  /** Foes engaged with it always draw its free strike when stepping away, even with disengage. */
  readonly noEscape: boolean;
  /** Its ranged moves fire over Pokémon standing in the way (they do not block its line of sight). */
  readonly shootOver: boolean;
  /** Damage multipliers against foes carrying a given status, e.g. Merciless { poison: 1.25 }. */
  readonly vsStatusIdDamage: Readonly<Record<string, number>>;
  /** Damage multiplier of moves of its own types (Adaptability). */
  readonly ownTypeDamage: number;
  /** Multiplies super-effective damage it receives (Filter, Solid Rock). */
  readonly superEffectiveTaken: number;
  /** Multiplies damage it receives from moves of a type, e.g. Thick Fat { fire: 0.5, ice: 0.5 }. */
  readonly typeDamageTaken: Readonly<Record<string, number>>;
  /** Multiplies damage it receives while it carries a status (Marvel Scale). */
  readonly statusedDamageTaken: number;
  /** Never takes critical hits (Battle Armor, Shell Armor). */
  readonly critImmune: boolean;
  /** Moves with a status effect deal 30% more but lose the status (Sheer Force). */
  readonly sheerForce: boolean;
  /** Status a foe gets when it hits this unit in melee (Static, Flame Body). */
  readonly hitStatus: { readonly status: string; readonly duration: number } | null;
}

export const NO_MODIFIERS: UnitModifiers = {
  moveBonus: 0, rangeBonus: 0, farDamage: 1, closeDamage: 1, damageDealt: 1, damageTaken: 1, typeDamage: {}, vsStatusDamage: 1, fullHpTargetDamage: 1,
  lowHpDamage: 1, healPerTurn: 0, statusDurationBonus: 0, impactBonus: 0,
  flankBonus: 0, swarmBonus: 0, drainBonus: 0, pushBonus: 0, pullBonus: 0, lowHpTypeDamage: {}, bondOnKo: 0, bondOnFaint: 0, bondCostReduction: 0, contactStatus: null, koHeal: 0, thorns: 0, vsEngagedDamage: 1, vsSetupDamage: 1, comboBond: 0, disengage: false, statusImmune: [],
  pinDamage: 1, strikeDamage: 1, vsMudDamage: 1, surroundedDamage: 1, statusedDamage: 1, fullHpDamageTaken: 1, koAttackBoost: 0, koMove: 0, healWhileEngaged: 0, bondOnStrike: 0, furyCutter: 0, statusedMove: 0, statusCooldownReduction: 0, koRefreshBasic: false, koResetCooldowns: false, statusSpreadOnKo: false, shedStatuses: false, sturdy: false, noEscape: false, shootOver: false, vsStatusIdDamage: {},
  ownTypeDamage: 1, superEffectiveTaken: 1, typeDamageTaken: {}, statusedDamageTaken: 1, critImmune: false, sheerForce: false, hitStatus: null,
};

export function combineModifiers(...parts: readonly Partial<UnitModifiers>[]): UnitModifiers {
  return parts.reduce<UnitModifiers>((acc, p) => {
    const typeDamage: Record<string, number> = { ...acc.typeDamage };
    for (const [t, m] of Object.entries(p.typeDamage ?? {})) typeDamage[t] = (typeDamage[t] ?? 1) * m;
    const lowHpTypeDamage: Record<string, number> = { ...acc.lowHpTypeDamage };
    const vsStatusIdDamage: Record<string, number> = { ...acc.vsStatusIdDamage };
    for (const [t, m] of Object.entries(p.vsStatusIdDamage ?? {})) vsStatusIdDamage[t] = (vsStatusIdDamage[t] ?? 1) * m;
    for (const [t, m] of Object.entries(p.lowHpTypeDamage ?? {})) lowHpTypeDamage[t] = (lowHpTypeDamage[t] ?? 1) * m;
    const typeDamageTaken: Record<string, number> = { ...acc.typeDamageTaken };
    for (const [t, m] of Object.entries(p.typeDamageTaken ?? {})) typeDamageTaken[t] = (typeDamageTaken[t] ?? 1) * m;
    return {
      moveBonus: acc.moveBonus + (p.moveBonus ?? 0),
      rangeBonus: acc.rangeBonus + (p.rangeBonus ?? 0),
      farDamage: acc.farDamage * (p.farDamage ?? 1),
      closeDamage: acc.closeDamage * (p.closeDamage ?? 1),
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
      contactStatus: p.contactStatus ?? acc.contactStatus,
      koHeal: acc.koHeal + (p.koHeal ?? 0),
      thorns: acc.thorns + (p.thorns ?? 0),
      vsEngagedDamage: acc.vsEngagedDamage * (p.vsEngagedDamage ?? 1),
      vsSetupDamage: acc.vsSetupDamage * (p.vsSetupDamage ?? 1),
      comboBond: acc.comboBond + (p.comboBond ?? 0),
      disengage: acc.disengage || (p.disengage ?? false),
      statusImmune: [...new Set([...acc.statusImmune, ...(p.statusImmune ?? [])])],
      pinDamage: acc.pinDamage * (p.pinDamage ?? 1),
      strikeDamage: acc.strikeDamage * (p.strikeDamage ?? 1),
      vsMudDamage: acc.vsMudDamage * (p.vsMudDamage ?? 1),
      surroundedDamage: acc.surroundedDamage * (p.surroundedDamage ?? 1),
      statusedDamage: acc.statusedDamage * (p.statusedDamage ?? 1),
      fullHpDamageTaken: acc.fullHpDamageTaken * (p.fullHpDamageTaken ?? 1),
      koAttackBoost: acc.koAttackBoost + (p.koAttackBoost ?? 0),
      koMove: acc.koMove + (p.koMove ?? 0),
      healWhileEngaged: acc.healWhileEngaged + (p.healWhileEngaged ?? 0),
      bondOnStrike: acc.bondOnStrike + (p.bondOnStrike ?? 0),
      furyCutter: acc.furyCutter + (p.furyCutter ?? 0),
      statusedMove: acc.statusedMove + (p.statusedMove ?? 0),
      statusCooldownReduction: acc.statusCooldownReduction + (p.statusCooldownReduction ?? 0),
      koRefreshBasic: acc.koRefreshBasic || (p.koRefreshBasic ?? false),
      koResetCooldowns: acc.koResetCooldowns || (p.koResetCooldowns ?? false),
      statusSpreadOnKo: acc.statusSpreadOnKo || (p.statusSpreadOnKo ?? false),
      shedStatuses: acc.shedStatuses || (p.shedStatuses ?? false),
      sturdy: acc.sturdy || (p.sturdy ?? false),
      noEscape: acc.noEscape || (p.noEscape ?? false),
      shootOver: acc.shootOver || (p.shootOver ?? false),
      vsStatusIdDamage,
      ownTypeDamage: acc.ownTypeDamage * (p.ownTypeDamage ?? 1),
      superEffectiveTaken: acc.superEffectiveTaken * (p.superEffectiveTaken ?? 1),
      typeDamageTaken,
      statusedDamageTaken: acc.statusedDamageTaken * (p.statusedDamageTaken ?? 1),
      critImmune: acc.critImmune || (p.critImmune ?? false),
      sheerForce: acc.sheerForce || (p.sheerForce ?? false),
      hitStatus: p.hitStatus ?? acc.hitStatus,
    };
  }, NO_MODIFIERS);
}
