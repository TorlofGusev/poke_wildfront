import type { PokemonType, TypeChartData } from "../rules/typeChart";
import type { UnitModifiers } from "./modifiers";
import type { StatName, TypeDef } from "./species";

export interface BaseStats {
  readonly hp: number;
  readonly attack: number;
  readonly defense: number;
  readonly speed: number;
  /** Fills the Spirit bar faster and resists statuses foes inflict. */
  readonly willpower: number;
  /** Chance and size of critical hits. */
  readonly crit: number;
}

export interface SpeciesDef {
  readonly id: string;
  /** National Pokédex number (used for sprites). */
  readonly dex?: number;
  readonly name: string;
  readonly types: readonly PokemonType[];
  readonly stats: BaseStats;
  readonly moves: readonly string[];
  /** Base capture chance before ball, HP and status modifiers (0–1). */
  readonly captureBase: number;
  /** `choices`: the player picks the form when the level is reached (Eevee); `into` is the default (wild Pokémon). */
  readonly evolution?: { readonly level: number; readonly into: string; readonly choices?: readonly string[] };
  readonly ability?: string;
  /** Melee lines walk in and hit; ranged lines stay back and shoot (their moves fit the role, see MoveDef.reach). */
  readonly role?: Role;
}

export type Role = "melee" | "ranged";

/**
 * basic: the free attack. special: has a cooldown. ultimate: once per battle.
 * bond: costs the team's shared Bond points (the name is a content term, see terms.json).
 * A unit uses one of them per turn.
 */
export type MoveKind = "basic" | "special" | "ultimate" | "bond";

export type TargetShape =
  | { readonly kind: "single" }
  /** All tiles within `radius` (Manhattan) of the target tile. */
  | { readonly kind: "burst"; readonly radius: number }
  /** Straight line from the user towards the target, `length` tiles long. Target must be orthogonal. */
  | { readonly kind: "line"; readonly length: number }
  /** A fan from the user towards the aim: `length` long, `angle` degrees wide. */
  | { readonly kind: "cone"; readonly length: number; readonly angle: number };

/** Ground left burning, poisoned or muddy by a move (a hazard, see rules.zones). */
export type HazardKind = "fire" | "poison" | "mud";

export type MoveEffect =
  | { readonly kind: "push"; readonly distance: number }
  | { readonly kind: "pull"; readonly distance: number }
  | { readonly kind: "status"; readonly status: string; readonly duration: number }
  | { readonly kind: "heal"; readonly amount: number }
  /** Engages the (adjacent) target, taking it over from any other engagement (Block). */
  | { readonly kind: "engage" }
  /** Ends the user's engagement without a free attack (U-turn, Teleport). */
  | { readonly kind: "disengage" }
  /** Removes every status a foe put on the target (Heal Bell, Aromatherapy). */
  | { readonly kind: "cleanse" }
  /** Heals the target by this share of its own max HP (Pollen Puff on an ally). */
  | { readonly kind: "healShare"; readonly share: number }
  /** Heals the user by this share of the damage it deals (Dream Eater). */
  | { readonly kind: "drain"; readonly amount: number }
  /** Leaves a hazard of this radius where the move lands, for rules.zones.turns of the user's turns. */
  | { readonly kind: "zone"; readonly hazard: HazardKind; readonly radius: number }
  /** The team gains Bond when the move lands a combo or knocks a foe out (once per use). */
  | { readonly kind: "bond"; readonly amount: number; readonly when: "combo" | "knockout" };

export interface MoveDef {
  readonly id: string;
  readonly name: string;
  readonly type: PokemonType;
  readonly kind: MoveKind;
  /** 0 for pure utility moves. */
  readonly power: number;
  /** Canon power (all hits of a multi-hit move added up); when set, `power` follows from it (see powerFromCanon). */
  readonly canonPower?: number;
  readonly range: { readonly min: number; readonly max: number };
  readonly requiresLineOfSight: boolean;
  readonly shape: TargetShape;
  /** Which units the move affects; "any": damages a foe, while its heal effects go to an ally (Pollen Puff). */
  readonly affects: "enemies" | "allies" | "any";
  /** Only aims at units carrying this status (Dream Eater: sleep). */
  readonly onlyVs?: string;
  /** The canon physical/special category (flavour only: every move hits with Attack against Defense). */
  readonly category?: "physical" | "special";
  /** Turns before a special can be used again (special moves only). */
  readonly cooldown?: number;
  /** Team Bond points spent (bond moves only). */
  readonly bondCost?: number;
  /** The user's stat its damage scales with instead of Attack / Sp. Atk (Body Press: Defense). */
  readonly scaleStat?: StatName;
  /** Takes this share of the target's current HP instead of the damage formula, whatever the stats (Super Fang: 0.5). */
  readonly currentHpDamage?: number;
  /** Power grows as the user loses HP: up to +this share at 0 HP, by the share of HP lost (Endeavor, Flail, Reversal). */
  readonly lowHpPower?: number;
  readonly effects?: readonly MoveEffect[];
  /**
   * delayed: marks the ground now and strikes it at the start of the user's next turn, hitting whoever stands
   * there then. watch: guards the area until the user's next turn; the first foe moving in it is struck.
   */
  readonly timing?: "delayed" | "watch";
  /** Damaging moves: melee ones reach 1–2, ranged ones 2–4 (a few big ones 5); a line's tree only has its role's. */
  readonly reach?: Role;
}

export interface StatusDef {
  readonly id: string;
  readonly name: string;
  /** Fraction of max HP lost at the start of the unit's turn. */
  readonly damagePerTurn?: number;
  /** Movement points removed while active. */
  readonly movePenalty?: number;
  /** Cannot move at all while active (Paralysis). */
  readonly noMove?: boolean;
  /** Cannot use moves or balls while active (Freeze). */
  readonly noAction?: boolean;
  /** Only the basic attack (or Struggle) can be used while active (Disable). */
  readonly noSkills?: boolean;
  /** The next attack hits the nearest unit in reach, friend or foe, then the status ends (Confusion). */
  readonly misdirects?: boolean;
  /** Ends as soon as the unit takes damage (Sleep). */
  readonly wakesOnDamage?: boolean;
  /** Multiplies damage dealt by the affected unit (Burn). */
  readonly damageDealt?: number;
  /** Multiplies damage taken by the affected unit (Curse). */
  readonly damageTaken?: number;
  /** A helpful state (Protect, Pumped…): never counts as a status for "vs status" bonuses, Guts or spreading. */
  readonly buff?: boolean;
  /** The HP lost each turn heals the Pokémon that applied it (Leech Seed). */
  readonly drainsToSource?: boolean;
  /** May only attack the Pokémon that applied it (Taunt). */
  readonly forcesTarget?: boolean;
  /** Re-applying adds the durations instead of keeping the longer one (Poison). */
  readonly stacks?: boolean;
}

/**
 * Combat formulas (see docs/design/identity-and-stats-proposal.md):
 * - Max HP = hpBase + hpPerPoint × HP + (level − 1) × (hpPerLevel + hpPerLevelPerDefense × species base Def)
 * - Damage = max(1, round(power × (statOffset + Atk) / (statOffset + Def) × multipliers / damageDivisor)),
 *   × the crit multiplier on a critical hit (chance and size from Crit)
 * - Movement = base + perSpeed × Speed, at most max (in hex widths)
 */
export interface BattleRules {
  readonly hpBase: number;
  readonly hpPerPoint: number;
  /** Max HP gained per level above 1, plus a share of Defense (the Pokémon's constitution). */
  readonly hpPerLevel: number;
  readonly hpPerLevelPerDefense: number;
  /**
   * Named combos, checked in order: hitting a foe an ally set up (engaged with it, or carrying a status it
   * applied) multiplies the damage; some use the status up. `status` limits a combo to one status; one without
   * `status` or `engaged` takes any ally-applied status.
   */
  readonly combos: Readonly<Record<string, { readonly name: string; readonly damage: number; readonly engaged?: boolean; readonly status?: string; readonly consumes?: boolean }>>;
  /** Move power from canon power: scale × canon^exponent × shape × reach × kind factors, rounded to `round`. */
  readonly movePower: {
    readonly scale: number; readonly exponent: number; readonly round: number; readonly max: number;
    readonly basic: number; readonly paid: number; readonly range2: number; readonly range3: number;
    readonly burst1: number; readonly burst2: number; readonly line: number; readonly cone: number;
    /** A delayed strike can be dodged, so it hits harder. */
    readonly delayed: number;
  };
  /** Base Speed a role adds (melee) or takes (ranged); the stat total stays the same. */
  /** Base Speed of each role (a species' types lean it ±1). */
  readonly roleSpeed: Readonly<Record<Role, number>>;
  /** Hazards: how many of their maker's turns they last, fire's damage (share of max HP) and poison's duration. */
  readonly zones: { readonly turns: number; readonly fireDamage: number; readonly poisonDuration: number };
  /** Critical hits: chance = base + perPoint × Crit, damage × (damage + damagePerPoint × Crit). */
  readonly crit: { readonly base: number; readonly perPoint: number; readonly damage: number; readonly damagePerPoint: number };
  /** Willpower: Spirit bar gains (× 1 + perPoint × Willpower) and status resistance per point. */
  readonly willpower: {
    readonly spiritMax: number; readonly perHit: number; readonly perKnockout: number; readonly perAllyKnockout: number;
    readonly perPoint: number; readonly pumpedTurns: number; readonly resistPerPoint: number;
  };
  readonly statOffset: number;
  readonly damageDivisor: number;
  /** Movement points (hex widths walked per turn) = base + perSpeed × Speed; `max` caps it, bonuses included. */
  readonly movement: { readonly base: number; readonly perSpeed: number; readonly max: number };
  /** Damage taken when pushed into an obstacle or another unit. */
  readonly impactDamage: number;
  /**
   * Engagement (Wartales-style), always one on one: a damaging melee hit (range 1) on an adjacent foe
   * engages the two, if neither is engaged yet. Engaged units may only attack each other, in melee;
   * one whose basic attack is ranged uses Struggle (`fallbackPower` × its basic attack's power).
   * Stepping away draws one free attack from the partner and ends the engagement.
   */
  /** Most extra turns masteries may add to a status (freeze and paralysis never get any). */
  readonly statusBonusCap: number;
  readonly engagement: { readonly fallbackPower: number };
  /** Melee moves (range 1) deal `closeBonus` ×; ranged moves used while engaged deal `engagedRangedPenalty` ×. */
  readonly melee: { readonly closeBonus: number; readonly engagedRangedPenalty: number };
  /** Speed past the movement cap: after moving, +stepBonus damage per speedPerStep, up to max. */
  readonly momentum: { readonly speedPerStep: number; readonly stepBonus: number; readonly max: number };
  /** Team Bond: default start and cap per side, and the gain per knockout. */
  readonly bond: { readonly start: number; readonly max: number; readonly perKnockout: number };
}

export interface BallDef {
  readonly id: string;
  readonly name: string;
  readonly multiplier: number;
  /** Poké Mart price in Pokédollars. */
  readonly price?: number;
}

export interface CaptureRules {
  /** Capture is possible below this HP fraction. */
  readonly hpThreshold: number;
  readonly minChance: number;
  readonly maxChance: number;
  /** Multiplier when the target has any status effect. */
  readonly statusBonus: number;
  readonly throwRange: { readonly min: number; readonly max: number };
}

/** A species line's innate passive (as in the main games). */
export interface AbilityDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly mods?: Partial<UnitModifiers>;
  /** Melee attackers that hit this Pokémon receive this status. */
  readonly contactStatus?: { readonly status: string; readonly duration: number };
  /** Moves of a type also inflict a status. */
  readonly moveStatus?: { readonly type: string; readonly status: string; readonly duration: number };
  /** Once per battle, a knockout blow leaves it at 1 HP instead. */
  readonly sturdy?: boolean;
  /** Sees through bushes: they no longer block its line of sight. */
  readonly keenEye?: boolean;
  /** +1 Attack for the rest of the battle each time it is damaged (max +3). */
  readonly angerPoint?: boolean;
  /** Enemies that start their turn next to it cannot move. */
  readonly arenaTrap?: boolean;
}

/** Player-facing names of setting-specific concepts, kept in data so the setting can be swapped. */
export interface Terms {
  readonly bond: string;
  readonly bondDescription: string;
  readonly food: string;
  readonly healCenter: string;
  readonly healCenterDescription: string;
}

export interface BattleContent {
  readonly terms: Terms;
  readonly abilities: Readonly<Record<string, AbilityDef>>;
  readonly species: Readonly<Record<string, SpeciesDef>>;
  readonly moves: Readonly<Record<string, MoveDef>>;
  readonly statuses: Readonly<Record<string, StatusDef>>;
  readonly typeChart: TypeChartData;
  /** Type playstyles: stat profiles and type mechanics. */
  readonly types: Readonly<Record<string, TypeDef>>;
  readonly rules: BattleRules;
  readonly balls: Readonly<Record<string, BallDef>>;
  readonly capture: CaptureRules;
}
