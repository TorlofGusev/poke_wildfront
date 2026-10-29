import type { ActiveStatus } from "./state";
import { samePoint, type Point } from "../grid/types";
import { bodyFits, distance, inArea, MELEE_REACH, sweep, terrainAt, UNIT_RADIUS, type FreeArea, type FreeField, type FreeTerrainId } from "../free/field";
import { captureChance, captureUnavailableReason } from "../capture/capture";
import { nextRandom } from "../rng";
import { typeMultiplier } from "../rules/typeChart";
import type { BaseStats, BattleContent, HazardKind, MoveDef } from "./content";
import { combineModifiers, type UnitModifiers } from "./modifiers";
import type { TypeUnitTraits } from "./species";

import type { BattleEvent } from "./events";
import type { BattleState, BattleUnit, Hazard, Side } from "./state";

export interface UnitSetup {
  readonly id: string;
  readonly speciesId: string;
  readonly side: Side;
  readonly pos: Point;
  /** Defaults to the species' max HP. */
  readonly hp?: number;
  readonly level?: number;
  /** Effective stats; defaults to the species' base stats. */
  readonly stats?: BaseStats;
  /** Battle max HP; defaults to the species' stats (see BattleRules). */
  readonly maxHp?: number;
  /** Usable moves; defaults to the species' move list. */
  readonly moves?: readonly string[];
  readonly mods?: Partial<UnitModifiers>;
}

/** Walks go to any point the unit can reach; moves are aimed at any point (a Pokémon, or the ground for areas). */
export type BattleAction =
  | { readonly type: "move"; readonly unitId: string; readonly to: Point }
  | { readonly type: "useMove"; readonly unitId: string; readonly moveId: string; readonly target: Point }
  | { readonly type: "throwBall"; readonly unitId: string; readonly ballId: string; readonly target: Point }
  | { readonly type: "retreat"; readonly unitId: string }
  | { readonly type: "endTurn"; readonly unitId: string }
  /** The player hands a fresh turn to another of their units that has not acted this round. */
  | { readonly type: "switchUnit"; readonly unitId: string; readonly to: string };

export interface BattleOptions {
  /** PRNG seed for capture rolls. */
  readonly seed?: number;
  readonly balls?: Readonly<Record<string, number>>;
  /** Wild battles allow capture; trainer and boss battles do not. */
  readonly captureAllowed?: boolean;
  /** Applied to every player unit, e.g. expedition fatigue. */
  readonly playerModifiers?: Partial<UnitModifiers>;
  /** Team Bond at the start of the battle and its cap, per side; rules defaults otherwise. */
  readonly bond?: Partial<Record<Side, { readonly start: number; readonly max: number }>>;
}

export interface StepResult {
  readonly state: BattleState;
  readonly events: BattleEvent[];
}

export class IllegalActionError extends Error {}

// ---------------------------------------------------------------- queries

export const unitById = (state: BattleState, id: string): BattleUnit => {
  const u = state.units.find((x) => x.id === id);
  if (!u) throw new Error(`Unknown unit '${id}'`);
  return u;
};

/** Units still on the field: not fainted and not captured. */
export const livingUnits = (state: BattleState): BattleUnit[] =>
  state.units.filter((u) => u.hp > 0 && !u.captured);

/** The living unit whose body covers `p`, if any (the nearest when bodies overlap the point). */
export const unitAt = (state: BattleState, p: Point): BattleUnit | undefined =>
  livingUnits(state)
    .filter((u) => distance(u.pos, p) <= UNIT_RADIUS)
    .sort((a, b) => distance(a.pos, p) - distance(b.pos, p))[0];

/** Distance between two positions, in hex widths. */
export const apart = (_state: BattleState, a: Point, b: Point): number => distance(a, b);

/** Whether two positions are in melee reach of each other. */
export const adjacent = (_state: BattleState, a: Point, b: Point): boolean => distance(a, b) <= MELEE_REACH;

export const activeUnit = (state: BattleState): BattleUnit | null =>
  state.turn ? unitById(state, state.turn.unitId) : null;

/** Bond points a bond move costs this unit. */
export function bondCostFor(move: MoveDef, unit: BattleUnit): number {
  return Math.max(1, (move.bondCost ?? 0) - unit.mods.bondCostReduction);
}

function gainBond(state: BattleState, side: Side, amount: number, reason: "knockout" | "fainted" | "combo", events: BattleEvent[]): void {
  const before = state.bond[side];
  state.bond[side] = Math.min(state.bondMax[side], before + amount);
  if (state.bond[side] !== before) events.push({ type: "bondChanged", side, amount: state.bond[side] - before, total: state.bond[side], reason });
}

/**
 * Speed beyond the movement cap turns into momentum: after moving this turn, every
 * `speedPerStep` Speed past it adds `stepBonus` damage (at most `max`), except against the foe the unit
 * began its turn engaged with.
 */
export function momentumBonus(content: BattleContent, unit: BattleUnit, state: BattleState, target?: BattleUnit): number {
  if (state.turn?.unitId !== unit.id || !state.turn.moved) return 0;
  // No run-up against the foe it began the turn engaged with (stepping out and back in).
  if (target && target.id === state.turn.startPartner) return 0;
  const r = content.rules;
  const excess = unit.stats.speed - speedAtMoveCap(content);
  return Math.min(r.momentum.max, Math.max(0, Math.floor(excess / r.momentum.speedPerStep)) * r.momentum.stepBonus);
}

/** Movement points a Speed gives before statuses and bonuses: every Speed point counts. */
export const baseMovement = (content: BattleContent, speed: number): number => {
  const m = content.rules.movement;
  return Math.min(m.max, m.base + m.perSpeed * speed);
};

/** The Speed at which movement reaches its cap (momentum builds past it). */
export const speedAtMoveCap = (content: BattleContent): number => {
  const m = content.rules.movement;
  return Math.ceil((m.max - m.base) / m.perSpeed);
};

export function movementPoints(content: BattleContent, unit: BattleUnit, state?: BattleState): number {
  // Quick Feet keeps it moving through Paralysis.
  if (unit.statuses.some((st) => content.statuses[st.id]?.noMove) && !unit.mods.statusedMove) return 0;
  if (state && livingUnits(state).some((o) => o.side !== unit.side && o.ability?.arenaTrap && adjacent(state, o.pos, unit.pos))) return 0;
  const max = content.rules.movement.max;
  const base = baseMovement(content, unit.stats.speed);
  const penalty = unit.statuses.reduce((s, st) => s + (content.statuses[st.id]?.movePenalty ?? 0), 0);
  // Bonuses (abilities, items, masteries) help slow Pokémon but never lift anyone past the cap.
  return Math.max(0, Math.min(max, base - penalty + unit.mods.moveBonus + (ailments(content, unit).length ? unit.mods.statusedMove : 0)));
}

/** Combined battlefield traits of a Pokémon's types. */
export function unitTraits(content: BattleContent, types: readonly string[]): TypeUnitTraits {
  const all = types.map((t) => content.types[t]?.unit ?? {});
  return {
    flies: all.some((t) => t.flies), phases: all.some((t) => t.phases), immovable: all.some((t) => t.immovable),
    damageTaken: all.reduce((m, t) => m * (t.damageTaken ?? 1), 1),
  };
}

/** Why a move is currently unavailable, or null if it can be used. */
export function moveUnavailableReason(
  state: BattleState,
  content: BattleContent,
  unitId: string,
  moveId: string,
): string | null {
  const unit = unitById(state, unitId);
  if (!unit.moves.includes(moveId)) return "unit does not know this move";
  if (state.turn?.unitId !== unitId) return "not this unit's turn";
  const kind = content.moves[moveId]?.kind;
  if (kind === "basic" && state.turn.basicUsed) return "basic attack already used this turn";
  if ((unit.cooldowns[moveId] ?? 0) > 0) return `on cooldown (${unit.cooldowns[moveId]})`;
  if (unit.usedUltimates.includes(moveId)) return "already used this battle";
  const move = content.moves[moveId];
  if (move?.kind === "bond" && state.bond[unit.side] < bondCostFor(move, unit)) return `needs ${bondCostFor(move, unit)} Bond`;
  const blocking = unit.statuses.find((st) => content.statuses[st.id]?.noAction);
  if (blocking) return `${content.statuses[blocking.id]!.name.toLowerCase()}: cannot act this turn`;
  const sealed = unit.statuses.find((st) => content.statuses[st.id]?.noSkills);
  if (sealed && kind !== "basic" && moveId !== "struggle") return `${content.statuses[sealed.id]!.name.toLowerCase()}: only its basic attack`;
  const engaged = unit.engagedWith !== null;
  const ranged = isRangedUnit(content, unit);
  if (moveId === "struggle") {
    if (!engaged || !ranged) return "only while engaged, for a ranged Pokémon";
  } else if (engaged && ranged) {
    // A shooter with a foe in its face only scuffles (Struggle) until it steps away.
    return "engaged: only Struggle until it steps away";
  } else if (engaged && move?.affects === "enemies" && (isRangedMove(move) || move.range.max === 0)) {
    return "engaged: only melee moves on its partner";
  }
  return null;
}

/** A ranged Pokémon (its species' role, or a ranged basic attack for one without a role). */
export function isRangedUnit(content: BattleContent, unit: BattleUnit): boolean {
  const role = content.species[unit.speciesId]?.role;
  if (role) return role === "ranged";
  const basic = basicOf(content, unit);
  return !!basic && isRangedMove(content.moves[basic]!);
}

/** The attacker's own damage bonuses add up to at most this (+100%). */
export const MAX_DAMAGE_BONUS = 1;

/** Only Bond moves reach further than this. */
export const MAX_RANGE = 3;

/** A move's range for this unit (in hex widths): ranged moves (2+) reach further with a range bonus, up to MAX_RANGE unless a Bond move. */
export const moveRange = (unit: { readonly mods: UnitModifiers; readonly statuses: readonly ActiveStatus[] }, move: MoveDef, content: BattleContent): { min: number; max: number } => {
  if (move.range.max < 2) return { min: move.range.min, max: move.range.max };
  const bonus = unit.mods.rangeBonus;
  const reach = move.kind === "bond" ? move.range.max + bonus : Math.min(MAX_RANGE, Math.max(move.range.max, move.range.max + bonus));
  // Blinded: a shorter reach, never below the move's minimum.
  const penalty = unit.statuses.reduce((s, st) => s + (content.statuses[st.id]?.rangePenalty ?? 0), 0);
  return { min: move.range.min, max: Math.max(move.range.min, reach - penalty) };
};

/** The unit's harmful statuses (buffs such as Pumped or Protect left out). */
export const ailments = (content: BattleContent, unit: BattleUnit): ActiveStatus[] =>
  unit.statuses.filter((st) => !content.statuses[st.id]?.buff);

/** Removes the statuses foes put on a unit (its own buffs stay). */
function cleanse(state: BattleState, unit: BattleUnit, events: BattleEvent[]): void {
  const foeMade = (st: ActiveStatus) => st.sourceId !== undefined && state.units.find((u) => u.id === st.sourceId)?.side !== unit.side;
  for (const st of unit.statuses.filter(foeMade)) events.push({ type: "statusExpired", unitId: unit.id, status: st.id });
  unit.statuses = unit.statuses.filter((st) => !foeMade(st));
}

/** Strips a unit's buffs (protective and offensive statuses alike). */
function dispel(content: BattleContent, unit: BattleUnit, events: BattleEvent[]): void {
  const buffs = unit.statuses.filter((st) => content.statuses[st.id]?.buff);
  for (const st of buffs) events.push({ type: "statusExpired", unitId: unit.id, status: st.id });
  unit.statuses = unit.statuses.filter((st) => !buffs.includes(st));
}

/** Two allies trade places; both leave their engagements without a free attack. */
function swapPlaces(state: BattleState, a: BattleUnit, b: BattleUnit, events: BattleEvent[]): void {
  disengage(state, a, events);
  disengage(state, b, events);
  const from = { ...a.pos }, to = { ...b.pos };
  a.pos = to;
  b.pos = from;
  events.push({ type: "displaced", unitId: a.id, from, to, blocked: false });
  events.push({ type: "displaced", unitId: b.id, from: to, to: from, blocked: false });
}

// ---------------------------------------------------------------- setup

export const hpFromStat = (content: BattleContent, hp: number): number =>
  content.rules.hpBase + content.rules.hpPerPoint * hp;

/**
 * Max HP at a level: the HP stat plus growth per level, which species with a higher base Defense
 * (their constitution) gain faster. Base, not current, Defense so Defense growth does not snowball into HP.
 */
export const maxHpAt = (content: BattleContent, hp: number, baseDefense: number, level: number): number => {
  const r = content.rules;
  return hpFromStat(content, hp) + Math.round((level - 1) * (r.hpPerLevel + r.hpPerLevelPerDefense * baseDefense));
};

/** Whether a move is resolved with Sp. Atk / Sp. Def. */

/** Max HP of a species with its level-1 stats. */
export const maxHpOf = (content: BattleContent, speciesId: string): number => hpFromStat(content, content.species[speciesId]!.stats.hp);


export function createBattle(
  content: BattleContent,
  field: FreeField,
  units: readonly UnitSetup[],
  options: BattleOptions = {},
): StepResult {
  units.forEach((u, i) => {
    if (!content.species[u.speciesId]) throw new Error(`Unknown species '${u.speciesId}'`);
    if (!bodyFits(field, u.pos)) throw new Error(`Unit '${u.id}' placed where its body does not fit`);
    const other = units.slice(0, i).find((o) => distance(o.pos, u.pos) < UNIT_RADIUS * 2);
    if (other) throw new Error(`Units '${other.id}' and '${u.id}' overlap`);
  });
  const state: BattleState = {
    field,
    units: units.map((u) => {
      const species = content.species[u.speciesId]!;
      const ability = species.ability ? content.abilities[species.ability] ?? null : null;
      const maxHp = u.maxHp ?? maxHpOf(content, u.speciesId);
      return {
        id: u.id,
        speciesId: u.speciesId,
        side: u.side,
        maxHp,
        // A saved HP above the max (stats recomputed, a level changed) starts full instead.
        hp: Math.min(u.hp ?? maxHp, maxHp),
        pos: { ...u.pos },
        statuses: [],
        cooldowns: {},
        usedUltimates: [],
        captured: false,
        level: u.level ?? 1,
        stats: { ...(u.stats ?? species.stats) },
        // Struggle is everyone's fallback for an engagement when the basic attack is ranged.
        moves: [...new Set([...(u.moves ?? species.moves), ...(content.moves.struggle ? ["struggle"] : [])])],
        mods: combineModifiers(u.mods ?? {}, ability?.mods ?? {}, u.side === "player" ? options.playerModifiers ?? {} : {}),
        traits: unitTraits(content, species.types),
        ability,
        attackBoost: 0,
        spirit: 0,
        sturdyUsed: false,
        furyTarget: null,
        furyStreak: 0,
        engagedWith: null,
      };
    }),
    round: 0,
    queue: [],
    turn: null,
    outcome: "ongoing",
    bond: { player: options.bond?.player?.start ?? content.rules.bond.start, enemy: options.bond?.enemy?.start ?? content.rules.bond.start },
    bondMax: { player: options.bond?.player?.max ?? content.rules.bond.max, enemy: options.bond?.enemy?.max ?? content.rules.bond.max },
    rngState: (options.seed ?? 1) >>> 0,
    balls: { ...(options.balls ?? {}) },
    captureAllowed: options.captureAllowed ?? false,
  };
  state.enemyOrder = rollEnemyOrder(state);
  const events: BattleEvent[] = [];
  checkOutcome(state, events);
  if (state.outcome === "ongoing") startRound(state, content, events);
  return { state, events };
}

/** The enemies in a random order (seeded), kept for the whole battle. */
function rollEnemyOrder(state: BattleState): string[] {
  const ids = state.units.filter((u) => u.side === "enemy").map((u) => u.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(roll(state) * (i + 1));
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  }
  return ids;
}

/**
 * Initiative (as in Wartales): the sides alternate, the player first; the player's units in party order
 * (any turn can be handed to another unit that has not acted yet), the enemies in the order rolled at the
 * start of the battle. Speed only moves a unit, it does not decide the order. When one side runs out, the
 * other acts in a row.
 */
export function initiativeOrder(state: BattleState, _content: BattleContent): string[] {
  const living = livingUnits(state);
  const rank = new Map((state.enemyOrder ?? []).map((id, i) => [id, i]));
  const sides = {
    player: living.filter((u) => u.side === "player"),
    enemy: living.filter((u) => u.side === "enemy").sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99)),
  };
  const out: string[] = [];
  let side: Side = "player";
  while (sides.player.length || sides.enemy.length) {
    const next = sides[side].shift() ?? sides[side === "player" ? "enemy" : "player"].shift()!;
    out.push(next.id);
    side = side === "player" ? "enemy" : "player";
  }
  return out;
}

/** Own units that can take over the current fresh player turn. */
export function switchTargets(state: BattleState): string[] {
  const t = state.turn;
  if (!t?.fresh || unitById(state, t.unitId).side !== "player") return [];
  return state.queue.slice(1).filter((id) => {
    const u = state.units.find((x) => x.id === id);
    return u !== undefined && u.side === "player" && u.hp > 0 && !u.captured;
  });
}

// ---------------------------------------------------------------- actions

/**
 * A deep copy to apply an action to. The field is shared, not copied: it is never mutated
 * (a terrain change replaces it), and copying its polygons on every simulated action was slow.
 */
export function cloneState(state: BattleState): BattleState {
  const { field, ...rest } = state;
  return { ...(structuredClone(rest) as Omit<BattleState, "field">), field };
}

/**
 * The rules side of an action: ball throws, retreats, turn ends and hand-overs. Walks and moves are
 * resolved by `applyAction` (core/free), which works out where a unit can go and what a move reaches.
 */
export function applyBaseAction(state: BattleState, content: BattleContent, action: BattleAction): StepResult {
  if (state.outcome !== "ongoing") throw new IllegalActionError("battle is over");
  if (state.turn?.unitId !== action.unitId) throw new IllegalActionError(`not ${action.unitId}'s turn`);
  const next = cloneState(state);
  const events: BattleEvent[] = [];
  if (action.type === "switchUnit") {
    if (!switchTargets(state).includes(action.to)) throw new IllegalActionError(`cannot hand the turn to ${action.to}`);
    // Swap the two places in the queue: the passed unit acts at the chosen unit's later player turn.
    const i = next.queue.indexOf(action.to);
    next.queue[i] = action.unitId;
    next.queue[0] = action.to;
    startTurn(next, content, events);
    return { state: next, events };
  }
  next.turn!.fresh = false;
  switch (action.type) {
    case "move":
    case "useMove":
      throw new IllegalActionError(`${action.type} goes through applyAction`);
    case "throwBall":
      doThrowBall(next, content, action.unitId, action.ballId, action.target, events);
      break;
    case "retreat":
      if (unitById(next, action.unitId).side !== "player") throw new IllegalActionError("only the player can retreat");
      next.outcome = "retreated";
      next.turn = null;
      events.push({ type: "battleEnded", outcome: "retreated" });
      break;
    case "endTurn":
      endTurn(next, content, events);
      break;
  }
  return { state: next, events };
}

/** The unit's own basic attack (not Struggle). */
export const basicOf = (content: BattleContent, unit: BattleUnit): string | undefined =>
  unit.moves.find((m) => m !== "struggle" && content.moves[m]?.kind === "basic");

/** Whether a move is ranged: it can reach 2 or more tiles. */
export const isRangedMove = (move: MoveDef): boolean => move.range.max >= 2;

/** The foe a unit is engaged with, if any. */
export function partnerOf(state: BattleState, unit: BattleUnit): BattleUnit | undefined {
  return unit.engagedWith ? state.units.find((u) => u.id === unit.engagedWith) : undefined;
}

function engage(a: BattleUnit, b: BattleUnit, events: BattleEvent[]): void {
  a.engagedWith = b.id;
  b.engagedWith = a.id;
  events.push({ type: "engaged", unitId: a.id, targetId: b.id });
}

function disengage(state: BattleState, unit: BattleUnit, events: BattleEvent[]): void {
  const partner = partnerOf(state, unit);
  unit.engagedWith = null;
  if (!partner) return;
  partner.engagedWith = null;
  events.push({ type: "disengaged", unitId: unit.id, targetId: partner.id });
}

/** The partner's free attack on a unit breaking away: its basic attack, or Struggle for a ranged Pokémon. */
function engagementStrike(state: BattleState, content: BattleContent, attacker: BattleUnit, target: BattleUnit, events: BattleEvent[]): void {
  const basic = basicOf(content, attacker)!;
  const moveId = isRangedUnit(content, attacker) || isRangedMove(content.moves[basic]!) ? "struggle" : basic;
  events.push({ type: "engagementStrike", unitId: attacker.id, targetId: target.id });
  events.push({ type: "moveUsed", unitId: attacker.id, moveId, target: { ...target.pos }, affected: [target.id] });
  const before = target.hp;
  resolveHits(state, content, attacker, effectiveMove(content, attacker, moveId), [target], events, attacker.mods.strikeDamage);
  if (target.hp < before && attacker.mods.bondOnStrike) gainBond(state, attacker.side, attacker.mods.bondOnStrike, "combo", events);
}

/** Struggle hits with the type of the unit's basic attack and `fallbackPower` × its power. */
export function effectiveMove(content: BattleContent, unit: BattleUnit, moveId: string): MoveDef {
  const move = content.moves[moveId]!;
  if (moveId !== "struggle") return move;
  const basic = content.moves[basicOf(content, unit)!]!;
  return { ...move, type: basic.type, power: Math.round(basic.power * content.rules.engagement.fallbackPower) };
}

/** A unit steps away from its engaged partner: the partner's free attack (unless it slips away freely), then the engagement ends. */
export function breakAway(state: BattleState, content: BattleContent, unit: BattleUnit, events: BattleEvent[]): void {
  const partner = partnerOf(state, unit);
  if (!partner) return;
  const canStrike = (!unit.mods.disengage || partner.mods.noEscape) && !partner.statuses.some((st) => content.statuses[st.id]?.noAction);
  if (canStrike) engagementStrike(state, content, partner, unit, events);
  if (unit.hp > 0) disengage(state, unit, events);
}

/** Spends what a move costs (action, cooldown, Bond), then resolves it on the affected units. */
export function commitMove(
  state: BattleState, content: BattleContent, user: BattleUnit, moveId: string, move: MoveDef, target: Point,
  affected: readonly BattleUnit[], events: BattleEvent[], area?: FreeArea,
): void {
  // One basic attack a turn; specials only wait on their cooldown, Bond moves on the team's Bond.
  if (move.kind === "basic") state.turn!.basicUsed = true;
  if (move.kind === "special" && move.cooldown)
    user.cooldowns[moveId] = move.power > 0 ? move.cooldown : Math.max(1, move.cooldown - user.mods.statusCooldownReduction);
  if (move.kind === "ultimate") user.usedUltimates.push(moveId);
  if (move.kind === "bond") {
    const cost = bondCostFor(move, user);
    state.bond[user.side] -= cost;
    events.push({ type: "bondChanged", side: user.side, amount: -cost, total: state.bond[user.side], reason: "spent" });
  }
  // A delayed strike or a watch only marks its area now; it hits later (startTurn, or a foe's walk).
  if (move.timing && area) {
    (state.pending ??= []).push({ kind: move.timing, unitId: user.id, moveId, area, target: { ...target } });
    events.push({ type: "strikePrepared", unitId: user.id, moveId, timing: move.timing, area });
    return;
  }
  strike(state, content, user, moveId, move, target, affected, events);
}

/** The hit itself: what a move does to the Pokémon it reaches, and the hazards it leaves where it lands. */
export function strike(
  state: BattleState, content: BattleContent, user: BattleUnit, moveId: string, move: MoveDef, target: Point,
  affected: readonly BattleUnit[], events: BattleEvent[],
): void {
  events.push({ type: "moveUsed", unitId: user.id, moveId, target: { ...target }, affected: affected.map((u) => u.id) });
  resolveHits(state, content, user, move, affected, events);
  for (const e of move.effects ?? []) if (e.kind === "zone") createHazard(state, content, e.hazard, target, e.radius, user, events);
  checkOutcome(state, events);
}

/** Leaves burning, poisoned or muddy ground (mud is real terrain while it lasts). */
function createHazard(state: BattleState, content: BattleContent, kind: HazardKind, at: Point, radius: number, user: BattleUnit, events: BattleEvent[]): void {
  const hazards = (state.hazards ??= []);
  const id = hazards.reduce((m, h) => Math.max(m, h.id), 0) + 1;
  let poly: Point[] | undefined;
  if (kind === "mud") {
    poly = Array.from({ length: 10 }, (_, i) => ({
      x: Math.round((at.x + Math.cos((i / 10) * Math.PI * 2) * radius) * 100) / 100,
      y: Math.round((at.y + Math.sin((i / 10) * Math.PI * 2) * radius) * 100) / 100,
    }));
    const rocks = state.field.zones.filter((z) => z.terrain === "rock");
    state.field = { ...state.field, zones: [...state.field.zones.filter((z) => z.terrain !== "rock"), { terrain: "mud", poly }, ...rocks] };
  }
  const hazard: Hazard = { id, kind, at: { ...at }, radius, sourceId: user.id, turnsLeft: content.rules.zones.turns, ...(poly && { poly }) };
  hazards.push(hazard);
  events.push({ type: "hazardCreated", hazard: { ...hazard } });
}

function expireHazard(state: BattleState, hazard: Hazard, events: BattleEvent[]): void {
  state.hazards = (state.hazards ?? []).filter((h) => h.id !== hazard.id);
  const poly = hazard.poly;
  if (poly) state.field = { ...state.field, zones: state.field.zones.filter((z) => z.terrain !== "mud" || !samePoint(z.poly[0]!, poly[0]!)) };
  events.push({ type: "hazardExpired", hazardId: hazard.id, kind: hazard.kind });
}

/** The fire and poison hazards covering `p` (mud only slows, as terrain). */
export const hazardsAt = (state: BattleState, p: Point): Hazard[] =>
  (state.hazards ?? []).filter((h) => h.kind !== "mud" && distance(h.at, p) <= h.radius);

/** A unit on burning or poisoned ground: fire burns it, poison poisons it (friend or foe alike). */
export function touchHazard(state: BattleState, content: BattleContent, unit: BattleUnit, hazard: Hazard, events: BattleEvent[]): void {
  if (unit.hp <= 0) return;
  events.push({ type: "hazardTouched", unitId: unit.id, kind: hazard.kind });
  if (hazard.kind === "fire") {
    dealDamage(state, unit, Math.max(1, Math.floor(unit.maxHp * content.rules.zones.fireDamage)), "status", events);
    checkOutcome(state, events);
  } else if (hazard.kind === "poison") {
    const source = state.units.find((u) => u.id === hazard.sourceId) ?? unit;
    applyStatus(content, source, unit, "poison", content.rules.zones.poisonDuration, events, state);
  }
}

/** Abilities that react to being hit: Static/Poison Point punish melee attackers, Anger Point raises Attack. */
function onDamaged(content: BattleContent, attacker: BattleUnit, target: BattleUnit, contact: boolean, events: BattleEvent[]): void {
  // Masteries like Static or Flame Body punish a foe that hits it in melee.
  const hit = target.mods.hitStatus;
  if (hit && contact && attacker.hp > 0) applyStatus(content, target, attacker, hit.status, hit.duration, events);
  const a = target.ability;
  if (!a) return;
  if (a.angerPoint && target.attackBoost < 3) {
    target.attackBoost += 1;
    events.push({ type: "abilityTriggered", unitId: target.id, ability: a.id });
  }
  if (a.contactStatus && contact && attacker.hp > 0) {
    events.push({ type: "abilityTriggered", unitId: target.id, ability: a.id });
    applyStatus(content, target, attacker, a.contactStatus.status, a.contactStatus.duration, events);
  }
}

/** Sheer Force: +30% on a move that would inflict a status (which it then drops). */
const SHEER_FORCE = 1.3;
const hasStatusEffect = (content: BattleContent, user: BattleUnit, move: MoveDef): boolean =>
  (move.effects ?? []).some((e) => e.kind === "status") || !!content.types[move.type]?.move?.appliesStatus
  || (user.ability?.moveStatus?.type === move.type);

/** Other living allies of `user` standing next to `target`. */
function adjacentAllies(state: BattleState, user: BattleUnit, target: BattleUnit): number {
  return livingUnits(state).filter((u) => u.side === user.side && u.id !== user.id && adjacent(state, u.pos, target.pos)).length;
}

/** Product of a multiplier over the unit's active statuses (Burn, Curse…). */
function statusFactor(content: BattleContent, unit: BattleUnit, field: "damageDealt" | "damageTaken", ignoreBuffs = false): number {
  return unit.statuses.reduce((f, st) => f * (ignoreBuffs && content.statuses[st.id]?.buff ? 1 : content.statuses[st.id]?.[field] ?? 1), 1);
}

function heal(unit: BattleUnit, amount: number, events: BattleEvent[]): void {
  const healed = Math.min(amount, unit.maxHp - unit.hp);
  if (healed <= 0) return;
  unit.hp += healed;
  events.push({ type: "healed", unitId: unit.id, amount: healed, hp: unit.hp });
}

/** Next value of the battle's seeded PRNG (captures, crits, status resistance). */
export function roll(state: BattleState): number {
  const r = nextRandom(state.rngState);
  state.rngState = r.state;
  return r.value;
}

export const critChance = (content: BattleContent, unit: BattleUnit): number =>
  content.rules.crit.base + content.rules.crit.perPoint * unit.stats.crit;
export const critMultiplier = (content: BattleContent, unit: BattleUnit): number =>
  content.rules.crit.damage + content.rules.crit.damagePerPoint * unit.stats.crit;
/** Chance to shrug off a status a foe inflicts. */
export const statusResistChance = (content: BattleContent, unit: BattleUnit): number =>
  Math.min(0.5, content.rules.willpower.resistPerPoint * unit.stats.willpower);

/**
 * Fills a unit's Spirit bar (faster with Willpower); a full bar empties into Pumped:
 * through its next turn it hits harder and moves further.
 */
function spirit(state: BattleState, content: BattleContent, unit: BattleUnit, amount: number, events: BattleEvent[]): void {
  const w = content.rules.willpower;
  if (unit.hp <= 0 || amount <= 0 || unit.statuses.some((s) => s.id === "pumped")) return;
  unit.spirit = Math.min(w.spiritMax, (unit.spirit ?? 0) + Math.round(amount * (1 + w.perPoint * unit.stats.willpower)));
  if (unit.spirit < w.spiritMax) return;
  unit.spirit = 0;
  // Gained during its own turn, it still lasts through the next one (statuses tick at the end of turns).
  const turns = w.pumpedTurns + (state.turn?.unitId === unit.id ? 1 : 0);
  unit.statuses.push({ id: "pumped", turnsLeft: turns, sourceId: unit.id });
  events.push({ type: "statusApplied", unitId: unit.id, status: "pumped", duration: turns });
}

function applyStatus(content: BattleContent, user: BattleUnit, t: BattleUnit, status: string, base: number, events: BattleEvent[], state?: BattleState): void {
  if (t.mods.statusImmune.includes(status) || t.mods.statusImmune.includes("*")) return;
  // Willpower: a chance to shrug off what a foe inflicts.
  if (state && user.side !== t.side && roll(state) < statusResistChance(content, t)) {
    events.push({ type: "statusResisted", unitId: t.id, status });
    return;
  }
  const def = content.statuses[status];
  const bonus = def?.noAction || def?.noMove ? 0 : Math.min(content.rules.statusBonusCap, user.mods.statusDurationBonus);
  const duration = base + bonus;
  const existing = t.statuses.find((s) => s.id === status);
  if (existing) existing.turnsLeft = content.statuses[status]?.stacks ? existing.turnsLeft + duration : Math.max(existing.turnsLeft, duration);
  else t.statuses.push({ id: status, turnsLeft: duration, sourceId: user.id });
  if (existing) existing.sourceId = user.id;
  events.push({ type: "statusApplied", unitId: t.id, status, duration });
}

/** Terrain a mechanic's map character stands for. */
const TERRAIN_OF: Readonly<Record<string, FreeTerrainId>> = { m: "mud", "~": "water", '"': "bush", "#": "rock" };
/** Radius of the patch a terrain-changing hit leaves (about one hex). */
const TERRAIN_PATCH = 0.6;

/** Ground and similar mechanics reshape the battlefield: open ground or a bush under the target turns into the new terrain. */
function changeTerrain(state: BattleState, p: Point, char: string, events: BattleEvent[]): void {
  const terrain = TERRAIN_OF[char];
  const here = terrainAt(state.field, p).id;
  if (!terrain || terrain === here || (here !== "floor" && here !== "bush")) return;
  const poly = Array.from({ length: 8 }, (_, i) => ({
    x: Math.round((p.x + Math.cos((i / 8) * Math.PI * 2) * TERRAIN_PATCH) * 100) / 100,
    y: Math.round((p.y + Math.sin((i / 8) * Math.PI * 2) * TERRAIN_PATCH) * 100) / 100,
  }));
  // New ground goes under any rock patch already there.
  const rocks = state.field.zones.filter((z) => z.terrain === "rock");
  state.field = { ...state.field, zones: [...state.field.zones.filter((z) => z.terrain !== "rock"), { terrain, poly }, ...rocks] };
  events.push({ type: "terrainChanged", pos: { ...p }, terrain: char });
}

/** Moxie, Speed Boost, Beast Boost, Mind Reader: what a unit gains from knocking a foe out. */
function onKnockout(state: BattleState, user: BattleUnit, events: BattleEvent[]): void {
  const m = user.mods;
  if (m.koAttackBoost && user.attackBoost < 3) user.attackBoost = Math.min(3, user.attackBoost + m.koAttackBoost);
  if (m.koResetCooldowns) for (const id of Object.keys(user.cooldowns)) user.cooldowns[id] = 0;
  const myTurn = state.turn?.unitId === user.id;
  if (myTurn && m.koMove) state.turn!.movePointsLeft += m.koMove;
  if (myTurn && m.koRefreshBasic) state.turn!.basicUsed = false;
  if (m.koAttackBoost || m.koResetCooldowns || (myTurn && (m.koMove || m.koRefreshBasic)))
    events.push({ type: "abilityTriggered", unitId: user.id, ability: "knockout bonus" });
}

/** Lingering Aroma / Toxic Debris: statuses on a fainted foe spread to its neighbours, if their source has the mod. */
function spreadStatuses(state: BattleState, content: BattleContent, fallen: BattleUnit, events: BattleEvent[]): void {
  for (const st of ailments(content, fallen)) {
    const source = st.sourceId ? state.units.find((u) => u.id === st.sourceId) : undefined;
    if (!source?.mods.statusSpreadOnKo) continue;
    for (const n of livingUnits(state).filter((o) => o.side === fallen.side && adjacent(state, o.pos, fallen.pos)))
      applyStatus(content, source, n, st.id, 1, events, state);
  }
}

/** Whether a foe carries a status applied by one of the user's allies (not the user itself). */
function hasAllySetupStatus(state: BattleState, user: BattleUnit, target: BattleUnit): boolean {
  return target.statuses.some((st) => st.sourceId !== undefined && st.sourceId !== user.id
    && state.units.find((u) => u.id === st.sourceId)?.side === user.side);
}

/**
 * The named combo a hit on this foe would land, if any (rules.combos, first match): the foe is engaged with
 * one of the user's allies, or carries a (harmful) status an ally applied.
 */
export function comboSetup(state: BattleState, content: BattleContent, user: BattleUnit, target: BattleUnit): string | null {
  const partner = partnerOf(state, target);
  const pinned = !!partner && partner.id !== user.id && partner.side === user.side;
  const allyMade = target.statuses.filter((st) => !content.statuses[st.id]?.buff && st.sourceId !== undefined && st.sourceId !== user.id
    && state.units.find((u) => u.id === st.sourceId)?.side === user.side).map((st) => st.id);
  for (const [id, c] of Object.entries(content.rules.combos)) {
    if (c.engaged ? pinned : c.status ? allyMade.includes(c.status) : allyMade.length > 0) return id;
  }
  return null;
}

/** Applies a move's damage, effects and type mechanics to the units it affects. */
function resolveHits(
  state: BattleState, content: BattleContent, user: BattleUnit, move: MoveDef, affected: readonly BattleUnit[], events: BattleEvent[],
  /** Extra multiplier for this hit, e.g. Pursuit on a free strike. */
  hitMult = 1,
): void {
  const mech = content.types[move.type]?.move ?? {};
  let comboScored = false;
  let koScored = false;
  let furyCounted = false;
  let dealtToFoes = 0;
  const bondOn = (when: "combo" | "knockout") =>
    (move.effects ?? []).reduce((s, e) => s + (e.kind === "bond" && e.when === when ? e.amount : 0), 0);
  for (const t of affected) {
    if (t.hp <= 0) continue;
    const isFoe = t.side !== user.side;
    // A move that affects anyone (Pollen Puff) damages foes and only heals allies.
    if (move.power > 0 && (isFoe || move.affects !== "any")) {
      const defender = content.species[t.speciesId]!;
      const typeEff = typeMultiplier(content.typeChart, move.type, defender.types);
      const eff = mech.neverResisted ? Math.max(1, typeEff) : typeEff;
      const m = user.mods;
      const contact = adjacent(state, user.pos, t.pos);
      const helpers = adjacentAllies(state, user, t);
      const positional =
        (mech.flankBonus && helpers > 0 ? mech.flankBonus + m.flankBonus : 1) *
        (1 + (mech.swarmBonus ? (mech.swarmBonus + m.swarmBonus) * helpers : 0));
      // Guts shrugs off the damage penalties of its own statuses (Burn).
      const statusMult = (m.statusedDamage > 1 ? 1 : statusFactor(content, user, "damageDealt")) * statusFactor(content, t, "damageTaken", move.ignoresBuffs);
      const sheer = m.sheerForce && isFoe && hasStatusEffect(content, user, move);
      const setup = isFoe ? comboSetup(state, content, user, t) : null;
      const combo = setup ? content.rules.combos[setup]! : null;
      const pinner = isFoe ? partnerOf(state, t) : null;
      const adjacentFoes = livingUnits(state).filter((o) => o.side !== user.side && adjacent(state, o.pos, user.pos)).length;
      const streak = isFoe && user.furyTarget === t.id ? Math.min(3, user.furyStreak) : 0;
      // The attacker's own damage bonuses (role, masteries, items) add up instead of multiplying,
      // capped at +100%, so long chains of conditions cannot snowball; penalties still multiply.
      const ownFactors = [
        m.damageDealt, m.typeDamage[move.type] ?? 1,
        ailments(content, t).length > 0 ? m.vsStatusDamage : 1,
        t.hp === t.maxHp ? m.fullHpTargetDamage : 1,
        !contact && t !== user ? m.farDamage : m.closeDamage,
        // Melee moves hit harder (they must walk into reach); speed past the movement cap adds momentum after moving.
        move.range.max <= 1 ? content.rules.melee.closeBonus : 1,
        1 + momentumBonus(content, user, state, t),
        user.hp * 2 < user.maxHp ? m.lowHpDamage * (m.lowHpTypeDamage[move.type] ?? 1) : 1,
        combo?.engaged ? m.vsEngagedDamage : 1,
        isFoe && hasAllySetupStatus(state, user, t) ? m.vsSetupDamage : 1,
        pinner && pinner.id !== user.id && pinner.side === user.side ? pinner.mods.pinDamage : 1,
        terrainAt(state.field, t.pos).id === "mud" ? m.vsMudDamage : 1,
        adjacentFoes >= 2 ? m.surroundedDamage : 1,
        ailments(content, user).length > 0 ? m.statusedDamage : 1,
        ...t.statuses.map((st) => m.vsStatusIdDamage[st.id] ?? 1),
        content.species[user.speciesId]?.types.includes(move.type) ? m.ownTypeDamage : 1,
        sheer ? SHEER_FORCE : 1,
        1 + m.furyCutter * streak,
        // Dark moves exploit a hurt or afflicted foe.
        mech.vsHurt && (t.hp * 2 < t.maxHp || ailments(content, t).length > 0) ? mech.vsHurt : 1,
      ];
      // A ranged move used while engaged is hampered by the foe in its face.
      if (user.engagedWith && move.range.max >= 2) ownFactors.push(content.rules.melee.engagedRangedPenalty);
      const bonus = ownFactors.reduce((sum, f) => sum + (f > 1 ? f - 1 : 0), 0);
      const penalty = ownFactors.reduce((prod, f) => prod * (f < 1 ? f : 1), 1);
      const own = penalty * (1 + Math.min(MAX_DAMAGE_BONUS, bonus));
      const mult = own * eff * positional * (combo?.damage ?? 1) * statusMult * hitMult * t.mods.damageTaken * (t.traits.damageTaken ?? 1) * (t.hp === t.maxHp ? t.mods.fullHpDamageTaken : 1)
        * (eff > 1 ? t.mods.superEffectiveTaken : 1) * (t.mods.typeDamageTaken[move.type] ?? 1) * (ailments(content, t).length > 0 ? t.mods.statusedDamageTaken : 1);
      const off = content.rules.statOffset;
      const defense = mech.ignoresDefense ? 0 : t.stats.defense;
      const attack = move.scaleStat ? user.stats[move.scaleStat] : user.stats.attack;
      // Critical hit: Crit raises both the chance and the size (seeded, so replays match).
      const power = move.power * (1 + (move.lowHpPower ?? 0) * (1 - user.hp / user.maxHp))
        * (move.statusedPower && ailments(content, user).length > 0 ? 1 + move.statusedPower : 1)
        * (1 + (move.vsLowHpPower ?? 0) * (1 - t.hp / t.maxHp) + (move.vsFullHpPower ?? 0) * (t.hp / t.maxHp));
      const hits = move.hits ?? 1;
      const formula = (power * (off + attack + user.attackBoost)) / (off + defense) * mult / content.rules.damageDivisor / hits;
      // A multi-hit move splits its power over its hits, each rolling its own critical hit.
      let dealt = 0;
      for (let h = 0; h < hits && t.hp > 0; h++) {
        const crit = isFoe && mult > 0 && !move.currentHpDamage && !t.mods.critImmune && roll(state) < critChance(content, user);
        // A fixed share of the target's HP ignores stats and bonuses, but not Protect.
        const raw = move.currentHpDamage ? (mult > 0 ? t.hp * move.currentHpDamage : 0) : formula * (crit ? critMultiplier(content, user) : 1);
        if (crit) events.push({ type: "critical", unitId: user.id, targetId: t.id });
        // Any hit deals at least 1, unless something blocks all damage (Protect).
        const amount = mult > 0 ? Math.max(1, Math.round(raw)) : 0;
        dealt += dealDamage(state, t, move.nonLethal ? Math.min(amount, t.hp - 1) : amount, "move", events, eff);
      }
      if (isFoe) dealtToFoes += dealt;
      if (dealt > 0 && t.hp > 0) onDamaged(content, user, t, contact, events);
      if (dealt > 0 && isFoe) spirit(state, content, user, content.rules.willpower.perHit, events);
      if (dealt > 0 && isFoe && !furyCounted) {
        furyCounted = true;
        user.furyStreak = user.furyTarget === t.id ? user.furyStreak + 1 : 1;
        user.furyTarget = t.id;
      }
      // One combo per action; Bond for it only comes from masteries (comboBond) and skills (bond effects).
      if (dealt > 0 && setup && !comboScored) {
        comboScored = true;
        events.push({ type: "combo", unitId: user.id, targetId: t.id, combo: setup });
        // Some combos use the status up (a frozen foe shatters free, a paralysed one is jolted awake).
        if (combo?.consumes && combo.status && t.statuses.some((st) => st.id === combo.status)) {
          t.statuses = t.statuses.filter((st) => st.id !== combo.status);
          events.push({ type: "statusExpired", unitId: t.id, status: combo.status });
        }
        const bond = m.comboBond + bondOn("combo");
        if (bond > 0) gainBond(state, user.side, bond, "combo", events);
      }
      if (t.hp <= 0 && t.side !== user.side) {
        const skillBond = koScored ? 0 : bondOn("knockout");
        koScored = true;
        gainBond(state, user.side, content.rules.bond.perKnockout + user.mods.bondOnKo + skillBond, "knockout", events);
        if (m.koHeal && user.hp > 0) heal(user, Math.max(1, Math.round(user.maxHp * m.koHeal)), events);
        onKnockout(state, user, events);
        spreadStatuses(state, content, t, events);
        spirit(state, content, user, content.rules.willpower.perKnockout, events);
        for (const ally of livingUnits(state).filter((a) => a.side === user.side && a.id !== user.id))
          spirit(state, content, ally, content.rules.willpower.perAllyKnockout, events);
      }
      if (dealt > 0 && isFoe && contact) {
        if (m.contactStatus && t.hp > 0) applyStatus(content, user, t, m.contactStatus.status, m.contactStatus.duration, events, state);
        if (t.mods.thorns && user.hp > 0) dealDamage(state, user, t.mods.thorns, "thorns", events);
      }
      const drain = (mech.drain ?? 0) + (move.effects ?? []).reduce((sum, e) => sum + (e.kind === "drain" ? e.amount : 0), 0);
      if (drain > 0 && dealt > 0 && user.hp > 0) {
        heal(user, Math.max(1, Math.round(dealt * (drain + m.drainBonus))), events);
      }
    }
    for (const effect of move.effects ?? []) {
      if (t.hp <= 0) break;
      if (move.affects === "any" && (effect.kind === "heal" || effect.kind === "healShare") === isFoe) continue;
      switch (effect.kind) {
        case "drain":
          break; // Resolved with the hit above.
        case "healShare":
          heal(t, Math.max(1, Math.round(t.maxHp * effect.share)), events);
          break;
        case "heal":
          heal(t, effect.amount, events);
          break;
        case "status":
          if (user.mods.sheerForce && isFoe && move.power > 0) break; // Sheer Force trades the status for damage.
          if (!isFoe && content.statuses[effect.status]?.forcesTarget) break; // A taunt only holds foes (Follow Me's area).
          applyStatus(content, user, t, effect.status, effect.duration, events, state);
          break;
        case "push":
        case "pull":
          displace(state, content, user, t, effect.kind, effect.distance + (effect.kind === "push" ? user.mods.pushBonus : user.mods.pullBonus), events);
          break;
        case "engage":
          if (isFoe && t.engagedWith !== user.id && adjacent(state, user.pos, t.pos)) {
            disengage(state, user, events);
            disengage(state, t, events);
            engage(user, t, events);
            closeIn(state, user, t, events);
          }
          break;
        case "bond":
        case "zone":
          break; // Resolved with the hit above, or once where the move lands (strike).
        case "cleanse":
          cleanse(state, t, events);
          break;
        case "dispel":
          dispel(content, t, events);
          break;
        case "swap":
          if (t !== user && t.side === user.side) swapPlaces(state, user, t, events);
          break;
        case "disengage":
          // Applied once to the user, whoever the move hit.
          if (t === affected[0]) disengage(state, user, events);
          break;
      }
    }
    // A damaging melee hit engages the two, if neither is engaged yet (one on one).
    if (isFoe && t.hp > 0 && user.hp > 0 && move.power > 0 && !isRangedMove(move) && adjacent(state, user.pos, t.pos)
      && !user.engagedWith && !t.engagedWith && !(move.effects ?? []).some((e) => e.kind === "disengage")) {
      engage(user, t, events);
      closeIn(state, user, t, events);
    }
    // Type mechanics apply to the enemies a move hits.
    if (!isFoe || t.hp <= 0) continue;
    if (user.mods.sheerForce && move.power > 0) continue;
    if (mech.appliesStatus) applyStatus(content, user, t, mech.appliesStatus.status, mech.appliesStatus.duration, events, state);
    const extra = user.ability?.moveStatus;
    if (extra && extra.type === move.type) applyStatus(content, user, t, extra.status, extra.duration, events, state);
    if (mech.extraPush) displace(state, content, user, t, "push", mech.extraPush + user.mods.pushBonus, events);
    if (mech.extraPull) displace(state, content, user, t, "pull", mech.extraPull + user.mods.pullBonus, events);
    if (mech.terrainOnHit) changeTerrain(state, t.pos, mech.terrainOnHit, events);
  }
  // The price of a big move: recoil from the damage dealt, and a status on the user.
  if (move.recoil && dealtToFoes > 0 && user.hp > 0) dealDamage(state, user, Math.max(1, Math.round(dealtToFoes * move.recoil)), "recoil", events);
  if (move.selfStatus && user.hp > 0) applyStatus(content, user, user, move.selfStatus.status, move.selfStatus.duration, events, state);
}

function doThrowBall(
  state: BattleState,
  content: BattleContent,
  unitId: string,
  ballId: string,
  target: Point,
  events: BattleEvent[],
): void {
  const reason = captureUnavailableReason(state, content, unitId, ballId, target);
  if (reason) throw new IllegalActionError(`capture: ${reason}`);
  const victim = unitAt(state, target)!;
  const chance = captureChance(content, victim, ballId);
  const roll = nextRandom(state.rngState);
  state.rngState = roll.state;
  const success = roll.value < chance;
  state.balls[ballId] = state.balls[ballId]! - 1;
  state.turn!.actionUsed = true;
  events.push({ type: "ballThrown", unitId, targetId: victim.id, ballId, chance, success });
  if (success) {
    victim.captured = true;
    disengage(state, victim, events);
    state.queue = state.queue.filter((id, i) => i === 0 || id !== victim.id);
    events.push({ type: "captured", unitId: victim.id });
    checkOutcome(state, events);
  }
}

function displace(
  state: BattleState,
  content: BattleContent,
  user: BattleUnit,
  target: BattleUnit,
  kind: "push" | "pull",
  distance: number,
  events: BattleEvent[],
): void {
  const dx = target.pos.x - user.pos.x;
  const dy = target.pos.y - user.pos.y;
  if ((dx === 0 && dy === 0) || distance <= 0) return;
  if (target.traits.immovable) return;
  displaceFree(state, content, user, target, kind, distance, events);
  // Pushed (or pulled) out of its partner's reach: the engagement breaks, with no free attack.
  const partner = partnerOf(state, target);
  if (partner && apart(state, partner.pos, target.pos) > MELEE_REACH) disengage(state, target, events);
}

/** An engaged pair steps in until they touch (immovable ones hold their ground). */
function closeIn(state: BattleState, a: BattleUnit, b: BattleUnit, events: BattleEvent[]): void {
  const gap = distance(a.pos, b.pos) - UNIT_RADIUS * 2 - 0.02;
  if (gap <= 0.01) return;
  const movers = [a, b].filter((u) => !u.traits.immovable);
  for (const u of movers) {
    const other = u === a ? b : a;
    const len = distance(u.pos, other.pos);
    const dir = { x: (other.pos.x - u.pos.x) / len, y: (other.pos.y - u.pos.y) / len };
    const blockers = livingUnits(state).filter((o) => o.id !== u.id && o.id !== other.id).map((o) => o.pos);
    const from = { ...u.pos };
    const { to } = sweep(state.field, from, dir, gap / movers.length, blockers);
    if (distance(from, to) < 0.01) continue;
    u.pos = to;
    events.push({ type: "displaced", unitId: u.id, from, to: { ...to }, blocked: false, engage: true });
  }
}

/** Push or pull on a free field: straight away from (or towards) the user, stopped by terrain and bodies. */
function displaceFree(
  state: BattleState, content: BattleContent, user: BattleUnit, target: BattleUnit, kind: "push" | "pull", dist: number, events: BattleEvent[],
): void {
  const len = distance(user.pos, target.pos);
  const sign = kind === "push" ? 1 : -1;
  const dir = { x: ((target.pos.x - user.pos.x) / len) * sign, y: ((target.pos.y - user.pos.y) / len) * sign };
  const others = livingUnits(state).filter((u) => u.id !== target.id).map((u) => u.pos);
  const from = { ...target.pos };
  const { to, blocked } = sweep(state.field, from, dir, dist, others);
  target.pos = to;
  events.push({ type: "displaced", unitId: target.id, from, to: { ...to }, blocked });
  const partner = partnerOf(state, target);
  if (partner && !adjacent(state, partner.pos, target.pos)) disengage(state, target, events);
  if (blocked && kind === "push") dealDamage(state, target, content.rules.impactDamage + user.mods.impactBonus, "impact", events);
}

function dealDamage(
  state: BattleState,
  unit: BattleUnit,
  amount: number,
  source: "move" | "status" | "impact" | "thorns" | "recoil",
  events: BattleEvent[],
  effectiveness?: number,
): number {
  let dealt = Math.min(amount, unit.hp);
  if (dealt === unit.hp && (unit.ability?.sturdy || unit.mods.sturdy) && !unit.sturdyUsed && unit.hp > 1) {
    // Sturdy (ability) / Endure (mastery): hangs on at 1 HP once per battle.
    unit.sturdyUsed = true;
    dealt = unit.hp - 1;
    events.push({ type: "abilityTriggered", unitId: unit.id, ability: unit.ability?.sturdy ? unit.ability.id : "sturdy" });
  }
  unit.hp -= dealt;
  events.push({ type: "damaged", unitId: unit.id, amount: dealt, hp: unit.hp, source, ...(effectiveness !== undefined && { effectiveness }) });
  // A hit wakes a sleeping Pokémon (poison ticks too).
  if (dealt > 0 && unit.hp > 0 && unit.statuses.some((st) => st.id === "sleep")) {
    unit.statuses = unit.statuses.filter((st) => st.id !== "sleep");
    events.push({ type: "statusExpired", unitId: unit.id, status: "sleep" });
  }
  if (unit.hp === 0) {
    events.push({ type: "fainted", unitId: unit.id });
    disengage(state, unit, events);
    if (state.pending?.some((p) => p.unitId === unit.id)) state.pending = state.pending.filter((p) => p.unitId !== unit.id);
    if (unit.mods.bondOnFaint) gainBond(state, unit.side, unit.mods.bondOnFaint, "fainted", events);
    state.queue = state.queue.filter((id, i) => i === 0 || id !== unit.id);
  }
  return dealt;
}

// ---------------------------------------------------------------- turn flow

function startRound(state: BattleState, content: BattleContent, events: BattleEvent[]): void {
  state.round += 1;
  // Hazards whose maker fell or was caught fade by the round instead of its turns.
  for (const h of [...(state.hazards ?? [])]) {
    const maker = state.units.find((u) => u.id === h.sourceId);
    if (maker && maker.hp > 0 && !maker.captured) continue;
    if (--h.turnsLeft <= 0) expireHazard(state, h, events);
  }
  state.queue = initiativeOrder(state, content);
  events.push({ type: "roundStarted", round: state.round, order: [...state.queue] });
  startTurn(state, content, events);
}

function startTurn(state: BattleState, content: BattleContent, events: BattleEvent[]): void {
  const unitId = state.queue[0]!;
  const unit = unitById(state, unitId);
  // A unit passed over by a switch already had its start-of-turn effects this round.
  const begins = unit.startedRound !== state.round;
  unit.startedRound = state.round;
  if (begins) for (const id of Object.keys(unit.cooldowns)) unit.cooldowns[id] = Math.max(0, unit.cooldowns[id]! - 1);
  state.turn = { unitId, movePointsLeft: movementPoints(content, unit, state), actionUsed: false, basicUsed: false, fresh: true, ...(unit.engagedWith && { startPartner: unit.engagedWith }) };
  events.push({ type: "turnStarted", unitId, movePoints: state.turn.movePointsLeft });
  if (!begins) return;

  for (const st of unit.statuses) {
    const def = content.statuses[st.id];
    const frac = def?.damagePerTurn;
    if (frac && unit.hp > 0) {
      const lost = Math.min(unit.hp, Math.max(1, Math.floor(unit.maxHp * frac)));
      dealDamage(state, unit, lost, "status", events);
      const source = def.drainsToSource ? state.units.find((u) => u.id === st.sourceId && u.hp > 0 && !u.captured) : undefined;
      if (source) heal(source, lost, events);
      if (unit.hp <= 0) spreadStatuses(state, content, unit, events);
    }
  }
  // Standing on burning or poisoned ground.
  for (const h of hazardsAt(state, unit.pos)) touchHazard(state, content, unit, h, events);
  if (unit.hp > 0 && unit.mods.shedStatuses) cleanse(state, unit, events);
  const healFrac = unit.mods.healPerTurn + (unit.engagedWith ? unit.mods.healWhileEngaged : 0);
  if (unit.hp > 0 && healFrac > 0 && unit.hp < unit.maxHp) {
    const amount = Math.min(unit.maxHp - unit.hp, Math.max(1, Math.floor(unit.maxHp * healFrac)));
    unit.hp += amount;
    events.push({ type: "healed", unitId: unit.id, amount, hp: unit.hp });
  }
  // Its hazards fade; its watch ends; its delayed strikes land on whoever stands there now.
  for (const h of [...(state.hazards ?? [])]) if (h.sourceId === unit.id && --h.turnsLeft <= 0) expireHazard(state, h, events);
  const mine = (state.pending ?? []).filter((p) => p.unitId === unit.id);
  if (mine.length) state.pending = state.pending!.filter((p) => p.unitId !== unit.id);
  for (const p of mine) {
    if (unit.hp <= 0 || state.outcome !== "ongoing") break;
    const move = effectiveMove(content, unit, p.moveId);
    const hit = p.kind === "delayed" ? livingUnits(state).filter((u) => u.id !== unit.id && inArea(p.area, u.pos)) : [];
    if (hit.length) strike(state, content, unit, p.moveId, move, p.target, hit, events);
    else events.push({ type: "strikeEnded", unitId: unit.id, moveId: p.moveId });
  }
  checkOutcome(state, events);
  if (state.outcome === "ongoing" && unit.hp <= 0) endTurn(state, content, events);
}

function endTurn(state: BattleState, content: BattleContent, events: BattleEvent[]): void {
  const unit = unitById(state, state.turn!.unitId);
  if (unit.hp > 0) {
    for (const st of unit.statuses) st.turnsLeft -= 1;
    for (const st of unit.statuses.filter((s) => s.turnsLeft <= 0))
      events.push({ type: "statusExpired", unitId: unit.id, status: st.id });
    unit.statuses = unit.statuses.filter((s) => s.turnsLeft > 0);
  }
  events.push({ type: "turnEnded", unitId: unit.id });
  state.turn = null;
  state.queue = state.queue.slice(1).filter((id) => livingUnits(state).some((u) => u.id === id));
  if (state.outcome !== "ongoing") return;
  if (state.queue.length === 0) startRound(state, content, events);
  else startTurn(state, content, events);
}

export function checkOutcome(state: BattleState, events: BattleEvent[]): void {
  if (state.outcome !== "ongoing") return;
  const alive = livingUnits(state);
  // Player loss is checked first: if both sides are wiped at once, it is a defeat.
  if (!alive.some((u) => u.side === "player")) state.outcome = "defeat";
  else if (!alive.some((u) => u.side === "enemy")) state.outcome = "victory";
  else return;
  state.turn = null;
  events.push({ type: "battleEnded", outcome: state.outcome });
}

