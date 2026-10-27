import type { ActiveStatus } from "./state";
import { ASCII_LEGEND, Grid } from "../grid/Grid";
import type { TerrainDef } from "../grid/terrain";
import { hasLineOfSight } from "../grid/lineOfSight";
import { hexDirToward, hexOnAxis, hexStep } from "../grid/hex";
import { reachableTiles, type Occupancy, type Reachable } from "../grid/movement";
import { gridDistance, key, samePoint, type Point } from "../grid/types";
import { captureChance, captureUnavailableReason } from "../capture/capture";
import { nextRandom } from "../rng";
import { typeMultiplier } from "../rules/typeChart";
import type { BaseStats, BattleContent, MoveDef } from "./content";
import { combineModifiers, type UnitModifiers } from "./modifiers";
import type { TypeUnitTraits } from "./species";

/** Fliers cross water and mud at normal cost; rocks still block them. */
const FLYING_LEGEND: Readonly<Record<string, TerrainDef>> = Object.fromEntries(
  Object.entries(ASCII_LEGEND).map(([ch, t]) => [ch, t.id === "water" || t.id === "mud" ? { ...t, moveCost: 1 } : t]),
);
import type { BattleEvent } from "./events";
import type { BattleState, BattleUnit, Side } from "./state";

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

export const gridOf = (state: BattleState): Grid => Grid.fromAscii(state.mapRows);

export const unitById = (state: BattleState, id: string): BattleUnit => {
  const u = state.units.find((x) => x.id === id);
  if (!u) throw new Error(`Unknown unit '${id}'`);
  return u;
};

/** Units still on the field: not fainted and not captured. */
export const livingUnits = (state: BattleState): BattleUnit[] =>
  state.units.filter((u) => u.hp > 0 && !u.captured);

export const unitAt = (state: BattleState, p: Point): BattleUnit | undefined =>
  livingUnits(state).find((u) => samePoint(u.pos, p));

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
 * Speed beyond the last movement step turns into momentum: after moving this turn, every
 * `speedPerStep` Speed past it adds `stepBonus` damage (at most `max`).
 */
export function momentumBonus(content: BattleContent, unit: BattleUnit, state: BattleState): number {
  if (state.turn?.unitId !== unit.id || !state.turn.moved) return 0;
  const r = content.rules;
  const excess = unit.stats.speed - r.moveBySpeed[r.moveBySpeed.length - 1]!.speed;
  return Math.min(r.momentum.max, Math.max(0, Math.floor(excess / r.momentum.speedPerStep)) * r.momentum.stepBonus);
}

/** Movement points a Speed gives before statuses and bonuses. */
export const baseMovement = (content: BattleContent, speed: number): number =>
  [...content.rules.moveBySpeed].reverse().find((s) => speed >= s.speed)?.move ?? content.rules.moveBySpeed[0]!.move;

export function movementPoints(content: BattleContent, unit: BattleUnit, state?: BattleState): number {
  if (unit.statuses.some((st) => content.statuses[st.id]?.noMove)) return 0;
  if (state && livingUnits(state).some((o) => o.side !== unit.side && o.ability?.arenaTrap && gridDistance(o.pos, unit.pos) === 1)) return 0;
  const r = content.rules;
  const base = Math.min(r.moveMax, baseMovement(content, unit.stats.speed));
  const penalty = unit.statuses.reduce((s, st) => s + (content.statuses[st.id]?.movePenalty ?? 0), 0);
  // Bonuses (abilities, items, masteries) help slow Pokémon but never lift anyone past the cap.
  return Math.max(0, Math.min(r.moveMax, base - penalty + unit.mods.moveBonus + (ailments(content, unit).length ? unit.mods.statusedMove : 0)));
}

/** Combined battlefield traits of a Pokémon's types. */
export function unitTraits(content: BattleContent, types: readonly string[]): TypeUnitTraits {
  const all = types.map((t) => content.types[t]?.unit ?? {});
  return {
    flies: all.some((t) => t.flies), phases: all.some((t) => t.phases), immovable: all.some((t) => t.immovable),
    damageTaken: all.reduce((m, t) => m * (t.damageTaken ?? 1), 1),
  };
}

function occupancyFor(state: BattleState, unit: BattleUnit): Occupancy {
  // Fliers and ghosts pass over/through enemies but still cannot stop on them.
  if (unit.traits.flies || unit.traits.phases) {
    return { isAlly: (p) => unitAt(state, p) !== undefined, isEnemy: () => false };
  }
  return {
    isAlly: (p) => unitAt(state, p)?.side === unit.side,
    isEnemy: (p) => {
      const o = unitAt(state, p);
      return o !== undefined && o.side !== unit.side;
    },
  };
}

/** Tiles the active unit can still move to this turn. */
export function reachableFor(state: BattleState, unitId: string): Reachable {
  const unit = unitById(state, unitId);
  const mp = state.turn?.unitId === unitId ? state.turn.movePointsLeft : 0;
  const grid = unit.traits.flies ? Grid.fromAscii(state.mapRows, FLYING_LEGEND) : gridOf(state);
  return reachableTiles(grid, unit.pos, mp, occupancyFor(state, unit), true);
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
  if (kind !== "basic" && state.turn.actionUsed) return "action already used this turn";
  if ((unit.cooldowns[moveId] ?? 0) > 0) return `on cooldown (${unit.cooldowns[moveId]})`;
  if (unit.usedUltimates.includes(moveId)) return "already used this battle";
  const move = content.moves[moveId];
  if (move?.kind === "bond" && state.bond[unit.side] < bondCostFor(move, unit)) return `needs ${bondCostFor(move, unit)} Bond`;
  const blocking = unit.statuses.find((st) => content.statuses[st.id]?.noAction);
  if (blocking) return `${content.statuses[blocking.id]!.name.toLowerCase()}: cannot act this turn`;
  const sealed = unit.statuses.find((st) => content.statuses[st.id]?.noSkills);
  if (sealed && kind !== "basic" && moveId !== "struggle") return `${content.statuses[sealed.id]!.name.toLowerCase()}: only its basic attack`;
  const engaged = unit.engagedWith !== null;
  if (moveId === "struggle") {
    const basic = basicOf(content, unit);
    if (!engaged || !basic || !isRangedMove(content.moves[basic]!)) return "only while engaged, when its basic attack is ranged";
  } else if (engaged && move?.affects === "enemies" && (isRangedMove(move) || move.range.max === 0)) {
    return "engaged: only melee moves on its partner";
  }
  return null;
}

/** Every tile a move would cover if aimed at `target` (its area of effect). */
export function moveArea(state: BattleState, move: MoveDef, user: BattleUnit, target: Point): Point[] {
  const grid = gridOf(state);
  switch (move.shape.kind) {
    case "single":
      return [target];
    case "burst": {
      const r = move.shape.radius;
      const tiles: Point[] = [];
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r - 1; dx <= r + 1; dx++) {
          const p = { x: target.x + dx, y: target.y + dy };
          if (gridDistance(target, p) <= r && grid.inBounds(p)) tiles.push(p);
        }
      return tiles;
    }
    case "line": {
      const dir = hexDirToward(user.pos, target);
      const tiles: Point[] = [];
      let p = user.pos;
      for (let i = 1; i <= move.shape.length; i++) {
        p = hexStep(p, dir);
        if (!grid.inBounds(p) || grid.terrainAt(p).blocksSight) break;
        tiles.push(p);
      }
      return tiles;
    }
  }
}

/** Units a move would affect if aimed at `target` from the user's current position. */
export function affectedUnits(state: BattleState, move: MoveDef, user: BattleUnit, target: Point): BattleUnit[] {
  const wantsSide = (u: BattleUnit) => (move.affects === "any" ? u.id !== user.id : (move.affects === "allies") === (u.side === user.side));
  return moveArea(state, move, user, target)
    .map((p) => unitAt(state, p))
    .filter((u): u is BattleUnit => u !== undefined && wantsSide(u))
    .sort((a, b) => a.pos.y - b.pos.y || a.pos.x - b.pos.x);
}

/** The attacker's own damage bonuses add up to at most this (+100%). */
export const MAX_DAMAGE_BONUS = 1;

/** Only Bond moves reach further than this. */
export const MAX_RANGE = 3;

/** A move's range for this unit: ranged moves (2+ hexes) reach further with a range bonus, up to MAX_RANGE unless a Bond move. */
export const moveRange = (unit: { readonly mods: UnitModifiers }, move: MoveDef): { min: number; max: number } => {
  if (move.range.max < 2) return { min: move.range.min, max: move.range.max };
  const max = move.range.max + unit.mods.rangeBonus;
  return { min: move.range.min, max: move.kind === "bond" ? max : Math.min(MAX_RANGE, Math.max(move.range.max, max)) };
};

/** Target tiles the unit may legally aim the move at right now. */
export function validTargets(
  state: BattleState,
  content: BattleContent,
  unitId: string,
  moveId: string,
): Point[] {
  if (moveUnavailableReason(state, content, unitId, moveId)) return [];
  const user = unitById(state, unitId);
  const move = content.moves[moveId]!;
  const grid = gridOf(state);
  const range = moveRange(user, move);
  // Pokémon standing in the way block shots that need line of sight (a Tank can screen its allies).
  const taunt = user.statuses.find((st) => content.statuses[st.id]?.forcesTarget && st.sourceId);
  const taunter = taunt ? state.units.find((u) => u.id === taunt.sourceId && u.hp > 0 && !u.captured) : undefined;
  const bodyBlocks = (p: Point) => !user.mods.shootOver && state.units.some((u) => u.hp > 0 && !u.captured && samePoint(u.pos, p));
  const out: Point[] = [];
  for (let y = 0; y < grid.height; y++)
    for (let x = 0; x < grid.width; x++) {
      const p = { x, y };
      const dist = gridDistance(user.pos, p);
      if (dist < range.min || dist > range.max) continue;
      if (grid.terrainAt(p).blocksSight) continue;
      if (move.requiresLineOfSight && !hasLineOfSight(grid, user.pos, p, bodyBlocks)) continue;
      // Lines go along one of the six hex directions.
      if (move.shape.kind === "line" && !hexOnAxis(user.pos, p)) continue;
      // Engaged: attacks may only aim at the partner.
      if (user.engagedWith && move.affects === "enemies" && !samePoint(p, partnerOf(state, user)!.pos)) continue;
      if (user.engagedWith && move.affects === "any" && unitAt(state, p)?.side !== user.side && !samePoint(p, partnerOf(state, user)!.pos)) continue;
      // Taunted: its attacks may only aim at the Pokémon that taunted it.
      if (taunter && move.affects !== "allies" && unitAt(state, p)?.side !== user.side && !samePoint(p, taunter.pos)) continue;
      if (move.shape.kind === "single") {
        const t = unitAt(state, p);
        if (!t) continue;
        // Enemies hiding in concealing terrain can only be targeted from an adjacent tile.
        if (t.side !== user.side && dist > 1 && grid.terrainAt(p).concealsAtRange && !user.ability?.keenEye) continue;
        if (move.onlyVs && !t.statuses.some((st) => st.id === move.onlyVs)) continue;
      }
      if (affectedUnits(state, move, user, p).length === 0) continue;
      out.push(p);
    }
  return out;
}

/** The unit's harmful statuses (buffs such as Pumped or Protect left out). */
export const ailments = (content: BattleContent, unit: BattleUnit): ActiveStatus[] =>
  unit.statuses.filter((st) => !content.statuses[st.id]?.buff);

/** Removes the statuses foes put on a unit (its own buffs stay). */
function cleanse(state: BattleState, unit: BattleUnit, events: BattleEvent[]): void {
  const foeMade = (st: ActiveStatus) => st.sourceId !== undefined && state.units.find((u) => u.id === st.sourceId)?.side !== unit.side;
  for (const st of unit.statuses.filter(foeMade)) events.push({ type: "statusExpired", unitId: unit.id, status: st.id });
  unit.statuses = unit.statuses.filter((st) => !foeMade(st));
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
  mapRows: readonly string[],
  units: readonly UnitSetup[],
  options: BattleOptions = {},
): StepResult {
  const grid = Grid.fromAscii(mapRows);
  const seen = new Set<string>();
  for (const u of units) {
    if (!content.species[u.speciesId]) throw new Error(`Unknown species '${u.speciesId}'`);
    if (!grid.isPassable(u.pos)) throw new Error(`Unit '${u.id}' placed on impassable tile`);
    if (seen.has(key(u.pos))) throw new Error(`Two units on tile ${key(u.pos)}`);
    seen.add(key(u.pos));
  }
  const state: BattleState = {
    mapRows: [...mapRows],
    units: units.map((u) => {
      const species = content.species[u.speciesId]!;
      const ability = species.ability ? content.abilities[species.ability] ?? null : null;
      const maxHp = u.maxHp ?? maxHpOf(content, u.speciesId);
      return {
        id: u.id,
        speciesId: u.speciesId,
        side: u.side,
        maxHp,
        hp: u.hp ?? maxHp,
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
  const events: BattleEvent[] = [];
  checkOutcome(state, events);
  if (state.outcome === "ongoing") startRound(state, content, events);
  return { state, events };
}

/**
 * Initiative (as in Wartales): the sides alternate, starting with the side of the fastest unit (ties to
 * the player); within a side, Speed descending. When one side runs out, the other acts in a row.
 * The player may hand any of their turns to another of their units that has not acted yet.
 */
export function initiativeOrder(state: BattleState, content: BattleContent): string[] {
  const bySpeed = livingUnits(state)
    .slice()
    .sort((a, b) => {
      const sa = a.stats.speed;
      const sb = b.stats.speed;
      if (sa !== sb) return sb - sa;
      if (a.side !== b.side) return a.side === "player" ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  const sides = { player: bySpeed.filter((u) => u.side === "player"), enemy: bySpeed.filter((u) => u.side === "enemy") };
  const out: string[] = [];
  let side: Side = bySpeed[0]?.side ?? "player";
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

export function applyAction(state: BattleState, content: BattleContent, action: BattleAction): StepResult {
  if (state.outcome !== "ongoing") throw new IllegalActionError("battle is over");
  if (state.turn?.unitId !== action.unitId) throw new IllegalActionError(`not ${action.unitId}'s turn`);
  const next = structuredClone(state) as BattleState;
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
      doMove(next, content, action.unitId, action.to, events);
      break;
    case "useMove":
      doUseMove(next, content, action.unitId, action.moveId, action.target, events);
      break;
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
const basicOf = (content: BattleContent, unit: BattleUnit): string | undefined =>
  unit.moves.find((m) => m !== "struggle" && content.moves[m]?.kind === "basic");

/** Whether a move is ranged: it can reach 2 or more tiles. */
const isRangedMove = (move: MoveDef): boolean => move.range.max >= 2;

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

/** The partner's free attack on a unit breaking away: its basic attack, or Struggle if that is ranged. */
function engagementStrike(state: BattleState, content: BattleContent, attacker: BattleUnit, target: BattleUnit, events: BattleEvent[]): void {
  const basic = basicOf(content, attacker)!;
  const moveId = isRangedMove(content.moves[basic]!) ? "struggle" : basic;
  events.push({ type: "engagementStrike", unitId: attacker.id, targetId: target.id });
  events.push({ type: "moveUsed", unitId: attacker.id, moveId, target: { ...target.pos }, affected: [target.id] });
  const before = target.hp;
  resolveHits(state, content, attacker, effectiveMove(content, attacker, moveId), [target], events, attacker.mods.strikeDamage);
  if (target.hp < before && attacker.mods.bondOnStrike) gainBond(state, attacker.side, attacker.mods.bondOnStrike, "combo", events);
}

/** Struggle hits with the type of the unit's basic attack and `fallbackPower` × its power. */
function effectiveMove(content: BattleContent, unit: BattleUnit, moveId: string): MoveDef {
  const move = content.moves[moveId]!;
  if (moveId !== "struggle") return move;
  const basic = content.moves[basicOf(content, unit)!]!;
  return { ...move, type: basic.type, power: Math.round(basic.power * content.rules.engagement.fallbackPower) };
}

/**
 * Moves a unit along its path. Stepping away from its engaged partner draws one free attack from it
 * (unless the unit disengages freely) and ends the engagement; a unit knocked out by it stays where it was.
 */
function doMove(state: BattleState, content: BattleContent, unitId: string, to: Point, events: BattleEvent[]): void {
  const reach = reachableFor(state, unitId);
  const path = reach.pathTo(to);
  if (!path) throw new IllegalActionError(`cannot move ${unitId} to ${key(to)}`);
  const unit = unitById(state, unitId);
  let segment: Point[] = [];
  let spent = 0;
  const flush = () => {
    if (!segment.length) return;
    const cost = reach.cost.get(key(segment[segment.length - 1]!))! - spent;
    spent += cost;
    state.turn!.movePointsLeft -= cost;
    state.turn!.moved = true;
    events.push({ type: "moved", unitId, path: segment, cost });
    segment = [];
  };
  for (const step of path) {
    // Any step breaks an engagement, even one that stays next to the partner (no circling around it);
    // the partner's free attack lands before the unit moves.
    const partner = partnerOf(state, unit);
    if (partner) {
      flush();
      const canStrike = (!unit.mods.disengage || partner.mods.noEscape) && !partner.statuses.some((st) => content.statuses[st.id]?.noAction);
      if (canStrike) engagementStrike(state, content, partner, unit, events);
      if (unit.hp <= 0) break;
      disengage(state, unit, events);
    }
    unit.pos = { ...step };
    segment.push(step);
  }
  flush();
  checkOutcome(state, events);
}

function doUseMove(
  state: BattleState,
  content: BattleContent,
  unitId: string,
  moveId: string,
  aimedAt: Point,
  events: BattleEvent[],
): void {
  let target = aimedAt;
  const reason = moveUnavailableReason(state, content, unitId, moveId);
  if (reason) throw new IllegalActionError(`${moveId}: ${reason}`);
  if (!validTargets(state, content, unitId, moveId).some((p) => samePoint(p, target)))
    throw new IllegalActionError(`${moveId}: invalid target ${key(target)}`);

  const user = unitById(state, unitId);
  const move = effectiveMove(content, user, moveId);
  let affected = affectedUnits(state, move, user, target);
  // Confusion: the attack goes to the nearest unit in reach, an ally if one is as close as any foe.
  const confusion = move.affects === "enemies" && move.power > 0 ? user.statuses.find((st) => content.statuses[st.id]?.misdirects) : undefined;
  if (confusion) {
    const reach = moveRange(user, move);
    const nearest = livingUnits(state)
      .filter((u) => u.id !== user.id && gridDistance(u.pos, user.pos) >= reach.min && gridDistance(u.pos, user.pos) <= reach.max)
      .sort((a, b) => gridDistance(a.pos, user.pos) - gridDistance(b.pos, user.pos) || Number(b.side === user.side) - Number(a.side === user.side) || (a.id < b.id ? -1 : 1))[0];
    if (nearest) {
      target = nearest.pos;
      affected = moveArea(state, move, user, target).map((p) => unitAt(state, p)).filter((u): u is BattleUnit => u !== undefined && u.id !== user.id);
    }
    user.statuses = user.statuses.filter((st) => st !== confusion);
    events.push({ type: "statusExpired", unitId: user.id, status: confusion.id });
  }
  if (move.kind === "basic") state.turn!.basicUsed = true;
  else state.turn!.actionUsed = true;
  if (move.kind === "special" && move.cooldown)
    user.cooldowns[moveId] = move.power > 0 ? move.cooldown : Math.max(1, move.cooldown - user.mods.statusCooldownReduction);
  if (move.kind === "ultimate") user.usedUltimates.push(moveId);
  if (move.kind === "bond") {
    const cost = bondCostFor(move, user);
    state.bond[user.side] -= cost;
    events.push({ type: "bondChanged", side: user.side, amount: -cost, total: state.bond[user.side], reason: "spent" });
  }
  events.push({ type: "moveUsed", unitId, moveId, target, affected: affected.map((u) => u.id) });

  resolveHits(state, content, user, move, affected, events);
  checkOutcome(state, events);
}

/** Abilities that react to being hit: Static/Poison Point punish melee attackers, Anger Point raises Attack. */
function onDamaged(content: BattleContent, attacker: BattleUnit, target: BattleUnit, contact: boolean, events: BattleEvent[]): void {
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

/** Other living allies of `user` standing next to `target`. */
function adjacentAllies(state: BattleState, user: BattleUnit, target: BattleUnit): number {
  return livingUnits(state).filter((u) => u.side === user.side && u.id !== user.id && gridDistance(u.pos, target.pos) === 1).length;
}

/** Product of a multiplier over the unit's active statuses (Burn, Curse…). */
function statusFactor(content: BattleContent, unit: BattleUnit, field: "damageDealt" | "damageTaken"): number {
  return unit.statuses.reduce((f, st) => f * (content.statuses[st.id]?.[field] ?? 1), 1);
}

function heal(unit: BattleUnit, amount: number, events: BattleEvent[]): void {
  const healed = Math.min(amount, unit.maxHp - unit.hp);
  if (healed <= 0) return;
  unit.hp += healed;
  events.push({ type: "healed", unitId: unit.id, amount: healed, hp: unit.hp });
}

/** Next value of the battle's seeded PRNG (captures, crits, status resistance). */
function roll(state: BattleState): number {
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

/** Ground and similar mechanics reshape the battlefield: floor and grass become the new terrain. */
function changeTerrain(state: BattleState, p: Point, char: string, events: BattleEvent[]): void {
  const row = state.mapRows[p.y]!;
  if (row[p.x] !== "." && row[p.x] !== '"') return;
  const rows = [...state.mapRows];
  rows[p.y] = row.slice(0, p.x) + char + row.slice(p.x + 1);
  state.mapRows = rows;
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
    for (const n of livingUnits(state).filter((o) => o.side === fallen.side && gridDistance(o.pos, fallen.pos) === 1))
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
      const dist = gridDistance(user.pos, t.pos);
      const helpers = adjacentAllies(state, user, t);
      const positional =
        (mech.flankBonus && helpers > 0 ? mech.flankBonus + m.flankBonus : 1) *
        (1 + (mech.swarmBonus ? (mech.swarmBonus + m.swarmBonus) * helpers : 0));
      const statusMult = statusFactor(content, user, "damageDealt") * statusFactor(content, t, "damageTaken");
      const setup = isFoe ? comboSetup(state, content, user, t) : null;
      const combo = setup ? content.rules.combos[setup]! : null;
      const pinner = isFoe ? partnerOf(state, t) : null;
      const adjacentFoes = livingUnits(state).filter((o) => o.side !== user.side && gridDistance(o.pos, user.pos) === 1).length;
      const streak = isFoe && user.furyTarget === t.id ? Math.min(3, user.furyStreak) : 0;
      // The attacker's own damage bonuses (role, masteries, items) add up instead of multiplying,
      // capped at +100%, so long chains of conditions cannot snowball; penalties still multiply.
      const ownFactors = [
        m.damageDealt, m.typeDamage[move.type] ?? 1,
        ailments(content, t).length > 0 ? m.vsStatusDamage : 1,
        t.hp === t.maxHp ? m.fullHpTargetDamage : 1,
        dist >= 2 ? m.farDamage : m.closeDamage,
        // Melee moves hit harder (they must walk into reach); speed past the movement cap adds momentum after moving.
        move.range.max <= 1 ? content.rules.melee.closeBonus : 1,
        1 + momentumBonus(content, user, state),
        user.hp * 2 < user.maxHp ? m.lowHpDamage * (m.lowHpTypeDamage[move.type] ?? 1) : 1,
        combo?.engaged ? m.vsEngagedDamage : 1,
        isFoe && hasAllySetupStatus(state, user, t) ? m.vsSetupDamage : 1,
        pinner && pinner.id !== user.id && pinner.side === user.side ? pinner.mods.pinDamage : 1,
        state.mapRows[t.pos.y]?.[t.pos.x] === "m" ? m.vsMudDamage : 1,
        adjacentFoes >= 2 ? m.surroundedDamage : 1,
        ailments(content, user).length > 0 ? m.statusedDamage : 1,
        ...t.statuses.map((st) => m.vsStatusIdDamage[st.id] ?? 1),
        1 + m.furyCutter * streak,
        // Dark moves exploit a hurt or afflicted foe.
        mech.vsHurt && (t.hp * 2 < t.maxHp || ailments(content, t).length > 0) ? mech.vsHurt : 1,
      ];
      // A ranged move used while engaged is hampered by the foe in its face.
      if (user.engagedWith && move.range.max >= 2) ownFactors.push(content.rules.melee.engagedRangedPenalty);
      const bonus = ownFactors.reduce((sum, f) => sum + (f > 1 ? f - 1 : 0), 0);
      const penalty = ownFactors.reduce((prod, f) => prod * (f < 1 ? f : 1), 1);
      const own = penalty * (1 + Math.min(MAX_DAMAGE_BONUS, bonus));
      const mult = own * eff * positional * (combo?.damage ?? 1) * statusMult * hitMult * t.mods.damageTaken * (t.traits.damageTaken ?? 1) * (t.hp === t.maxHp ? t.mods.fullHpDamageTaken : 1);
      const off = content.rules.statOffset;
      const defense = mech.ignoresDefense ? 0 : t.stats.defense;
      const attack = move.scaleStat ? user.stats[move.scaleStat] : user.stats.attack;
      // Critical hit: Crit raises both the chance and the size (seeded, so replays match).
      const crit = isFoe && mult > 0 && roll(state) < critChance(content, user);
      const raw = (move.power * (off + attack + user.attackBoost)) / (off + defense) * mult / content.rules.damageDivisor * (crit ? critMultiplier(content, user) : 1);
      if (crit) events.push({ type: "critical", unitId: user.id, targetId: t.id });
      // Any hit deals at least 1, unless something blocks all damage (Protect).
      const dealt = dealDamage(state, t, mult > 0 ? Math.max(1, Math.round(raw)) : 0, "move", events, eff);
      if (dealt > 0 && t.hp > 0) onDamaged(content, user, t, dist === 1, events);
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
      if (dealt > 0 && isFoe && dist === 1) {
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
          applyStatus(content, user, t, effect.status, effect.duration, events, state);
          break;
        case "push":
        case "pull":
          displace(state, content, user, t, effect.kind, effect.distance + (effect.kind === "push" ? user.mods.pushBonus : user.mods.pullBonus), events);
          break;
        case "engage":
          if (isFoe && t.engagedWith !== user.id && gridDistance(user.pos, t.pos) === 1) {
            disengage(state, user, events);
            disengage(state, t, events);
            engage(user, t, events);
          }
          break;
        case "bond":
          break; // Resolved with the hit above.
        case "cleanse":
          cleanse(state, t, events);
          break;
        case "disengage":
          // Applied once to the user, whoever the move hit.
          if (t === affected[0]) disengage(state, user, events);
          break;
      }
    }
    // A damaging melee hit engages the two, if neither is engaged yet (one on one).
    if (isFoe && t.hp > 0 && user.hp > 0 && move.power > 0 && !isRangedMove(move) && gridDistance(user.pos, t.pos) === 1
      && !user.engagedWith && !t.engagedWith && !(move.effects ?? []).some((e) => e.kind === "disengage")) engage(user, t, events);
    // Type mechanics apply to the enemies a move hits.
    if (!isFoe || t.hp <= 0) continue;
    if (mech.appliesStatus) applyStatus(content, user, t, mech.appliesStatus.status, mech.appliesStatus.duration, events, state);
    const extra = user.ability?.moveStatus;
    if (extra && extra.type === move.type) applyStatus(content, user, t, extra.status, extra.duration, events, state);
    if (mech.extraPush) displace(state, content, user, t, "push", mech.extraPush + user.mods.pushBonus, events);
    if (mech.extraPull) displace(state, content, user, t, "pull", mech.extraPull + user.mods.pullBonus, events);
    if (mech.terrainOnHit) changeTerrain(state, t.pos, mech.terrainOnHit, events);
  }
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
  // Along the hex direction that points most straight away from the user (or back towards it).
  const away = hexDirToward(user.pos, target.pos);
  const dir = kind === "push" ? away : away + 3;
  const grid = gridOf(state);
  const from = { ...target.pos };
  let blocked = false;
  for (let i = 0; i < distance; i++) {
    const next = hexStep(target.pos, dir);
    if (!grid.isPassable(next) || unitAt(state, next)) {
      blocked = true;
      break;
    }
    target.pos = next;
  }
  if (!samePoint(from, target.pos) || blocked)
    events.push({ type: "displaced", unitId: target.id, from, to: { ...target.pos }, blocked });
  const partner = partnerOf(state, target);
  if (partner && gridDistance(partner.pos, target.pos) > 1) disengage(state, target, events);
  // Only a push into an obstacle hurts; a pull that reaches the user simply stops.
  if (blocked && kind === "push") dealDamage(state, target, content.rules.impactDamage + user.mods.impactBonus, "impact", events);
}

function dealDamage(
  state: BattleState,
  unit: BattleUnit,
  amount: number,
  source: "move" | "status" | "impact" | "thorns",
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
    if (unit.mods.bondOnFaint) gainBond(state, unit.side, unit.mods.bondOnFaint, "fainted", events);
    state.queue = state.queue.filter((id, i) => i === 0 || id !== unit.id);
  }
  return dealt;
}

// ---------------------------------------------------------------- turn flow

function startRound(state: BattleState, content: BattleContent, events: BattleEvent[]): void {
  state.round += 1;
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
  state.turn = { unitId, movePointsLeft: movementPoints(content, unit, state), actionUsed: false, basicUsed: false, fresh: true };
  events.push({ type: "turnStarted", unitId, movePoints: state.turn.movePointsLeft });
  if (!begins) return;

  for (const st of unit.statuses) {
    const frac = content.statuses[st.id]?.damagePerTurn;
    if (frac && unit.hp > 0) {
      dealDamage(state, unit, Math.max(1, Math.floor(unit.maxHp * frac)), "status", events);
      if (unit.hp <= 0) spreadStatuses(state, content, unit, events);
    }
  }
  if (unit.hp > 0 && unit.mods.shedStatuses) cleanse(state, unit, events);
  const healFrac = unit.mods.healPerTurn + (unit.engagedWith ? unit.mods.healWhileEngaged : 0);
  if (unit.hp > 0 && healFrac > 0 && unit.hp < unit.maxHp) {
    const amount = Math.min(unit.maxHp - unit.hp, Math.max(1, Math.floor(unit.maxHp * healFrac)));
    unit.hp += amount;
    events.push({ type: "healed", unitId: unit.id, amount, hp: unit.hp });
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

function checkOutcome(state: BattleState, events: BattleEvent[]): void {
  if (state.outcome !== "ongoing") return;
  const alive = livingUnits(state);
  // Player loss is checked first: if both sides are wiped at once, it is a defeat.
  if (!alive.some((u) => u.side === "player")) state.outcome = "defeat";
  else if (!alive.some((u) => u.side === "enemy")) state.outcome = "victory";
  else return;
  state.turn = null;
  events.push({ type: "battleEnded", outcome: state.outcome });
}

/**
 * Where a unit could hurt you on its next turn: the tiles it can move to with full movement,
 * and the further tiles its damaging moves reach from any of them (line of sight ignored, so it errs on the safe side).
 */
export function threatZone(state: BattleState, content: BattleContent, unitId: string): { reach: readonly Point[]; strike: Point[] } {
  const unit = unitById(state, unitId);
  const grid = unit.traits.flies ? Grid.fromAscii(state.mapRows, FLYING_LEGEND) : gridOf(state);
  const reach = reachableTiles(grid, unit.pos, movementPoints(content, unit, state), occupancyFor(state, unit), true).destinations;
  const stands = [unit.pos, ...reach];
  const ranges = unit.moves.map((m) => content.moves[m]).filter((m): m is MoveDef => !!m && m.power > 0).map((m) => moveRange(unit, m));
  const covered = new Set(stands.map(key));
  const strike: Point[] = [];
  for (let y = 0; y < grid.height; y++)
    for (let x = 0; x < grid.width; x++) {
      const p = { x, y };
      if (covered.has(key(p))) continue;
      if (stands.some((s) => ranges.some((r) => { const d = gridDistance(s, p); return d >= r.min && d <= r.max; }))) strike.push(p);
    }
  return { reach, strike };
}
