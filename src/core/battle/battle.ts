import { ASCII_LEGEND, Grid } from "../grid/Grid";
import type { TerrainDef } from "../grid/terrain";
import { hasLineOfSight } from "../grid/lineOfSight";
import { reachableTiles, type Occupancy, type Reachable } from "../grid/movement";
import { key, manhattan, samePoint, type Point } from "../grid/types";
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
  | { readonly type: "endTurn"; readonly unitId: string };

export interface BattleOptions {
  /** PRNG seed for capture rolls. */
  readonly seed?: number;
  readonly balls?: Readonly<Record<string, number>>;
  /** Wild battles allow capture; trainer and boss battles do not. */
  readonly captureAllowed?: boolean;
  /** Applied to every player unit, e.g. expedition fatigue. */
  readonly playerModifiers?: Partial<UnitModifiers>;
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

export function movementPoints(content: BattleContent, unit: BattleUnit, state?: BattleState): number {
  if (unit.statuses.some((st) => content.statuses[st.id]?.noMove)) return 0;
  if (state && livingUnits(state).some((o) => o.side !== unit.side && o.ability?.arenaTrap && manhattan(o.pos, unit.pos) === 1)) return 0;
  const r = content.rules;
  const base = Math.min(r.moveMax, r.moveBase + Math.floor(unit.stats.speed / r.speedPerMove));
  const penalty = unit.statuses.reduce((s, st) => s + (content.statuses[st.id]?.movePenalty ?? 0), 0);
  return Math.max(0, base - penalty + unit.mods.moveBonus);
}

/** Combined battlefield traits of a Pokémon's types. */
export function unitTraits(content: BattleContent, types: readonly string[]): TypeUnitTraits {
  const all = types.map((t) => content.types[t]?.unit ?? {});
  return { flies: all.some((t) => t.flies), phases: all.some((t) => t.phases), immovable: all.some((t) => t.immovable) };
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
  return reachableTiles(grid, unit.pos, mp, occupancyFor(state, unit));
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
  if (state.turn.actionUsed) return "action already used this turn";
  if ((unit.cooldowns[moveId] ?? 0) > 0) return `on cooldown (${unit.cooldowns[moveId]})`;
  if (unit.usedUltimates.includes(moveId)) return "already used this battle";
  const blocking = unit.statuses.find((st) => content.statuses[st.id]?.noAction);
  if (blocking) return `${content.statuses[blocking.id]!.name.toLowerCase()}: cannot act this turn`;
  return null;
}

/** Units a move would affect if aimed at `target` from the user's current position. */
export function affectedUnits(
  state: BattleState,
  move: MoveDef,
  user: BattleUnit,
  target: Point,
): BattleUnit[] {
  const grid = gridOf(state);
  const wantsSide = (u: BattleUnit) => (move.affects === "allies") === (u.side === user.side);
  let tiles: Point[];
  switch (move.shape.kind) {
    case "single":
      tiles = [target];
      break;
    case "burst": {
      const r = move.shape.radius;
      tiles = [];
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const p = { x: target.x + dx, y: target.y + dy };
          if (Math.abs(dx) + Math.abs(dy) <= r && grid.inBounds(p)) tiles.push(p);
        }
      break;
    }
    case "line": {
      const dir = { x: Math.sign(target.x - user.pos.x), y: Math.sign(target.y - user.pos.y) };
      tiles = [];
      for (let i = 1; i <= move.shape.length; i++) {
        const p = { x: user.pos.x + dir.x * i, y: user.pos.y + dir.y * i };
        if (!grid.inBounds(p) || grid.terrainAt(p).blocksSight) break;
        tiles.push(p);
      }
      break;
    }
  }
  return tiles
    .map((p) => unitAt(state, p))
    .filter((u): u is BattleUnit => u !== undefined && wantsSide(u))
    .sort((a, b) => a.pos.y - b.pos.y || a.pos.x - b.pos.x);
}

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
  const out: Point[] = [];
  for (let y = 0; y < grid.height; y++)
    for (let x = 0; x < grid.width; x++) {
      const p = { x, y };
      const dist = manhattan(user.pos, p);
      if (dist < move.range.min || dist > move.range.max) continue;
      if (grid.terrainAt(p).blocksSight) continue;
      if (move.requiresLineOfSight && !hasLineOfSight(grid, user.pos, p)) continue;
      if (move.shape.kind === "line" && p.x !== user.pos.x && p.y !== user.pos.y) continue;
      if (move.shape.kind === "single") {
        const t = unitAt(state, p);
        if (!t) continue;
        // Enemies hiding in concealing terrain can only be targeted from an adjacent tile.
        if (t.side !== user.side && dist > 1 && grid.terrainAt(p).concealsAtRange && !user.ability?.keenEye) continue;
      }
      if (affectedUnits(state, move, user, p).length === 0) continue;
      out.push(p);
    }
  return out;
}

// ---------------------------------------------------------------- setup

export const hpFromStat = (content: BattleContent, hp: number): number =>
  content.rules.hpBase + content.rules.hpPerPoint * hp;

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
        moves: [...(u.moves ?? species.moves)],
        mods: combineModifiers(u.mods ?? {}, ability?.mods ?? {}, u.side === "player" ? options.playerModifiers ?? {} : {}),
        traits: unitTraits(content, species.types),
        ability,
        attackBoost: 0,
        sturdyUsed: false,
      };
    }),
    round: 0,
    queue: [],
    turn: null,
    outcome: "ongoing",
    rngState: (options.seed ?? 1) >>> 0,
    balls: { ...(options.balls ?? {}) },
    captureAllowed: options.captureAllowed ?? false,
  };
  const events: BattleEvent[] = [];
  checkOutcome(state, events);
  if (state.outcome === "ongoing") startRound(state, content, events);
  return { state, events };
}

/** Initiative: Speed descending, ties to the player, then by unit id. */
export function initiativeOrder(state: BattleState, content: BattleContent): string[] {
  return livingUnits(state)
    .slice()
    .sort((a, b) => {
      const sa = a.stats.speed;
      const sb = b.stats.speed;
      if (sa !== sb) return sb - sa;
      if (a.side !== b.side) return a.side === "player" ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .map((u) => u.id);
}

// ---------------------------------------------------------------- actions

export function applyAction(state: BattleState, content: BattleContent, action: BattleAction): StepResult {
  if (state.outcome !== "ongoing") throw new IllegalActionError("battle is over");
  if (state.turn?.unitId !== action.unitId) throw new IllegalActionError(`not ${action.unitId}'s turn`);
  const next = structuredClone(state) as BattleState;
  const events: BattleEvent[] = [];
  switch (action.type) {
    case "move":
      doMove(next, action.unitId, action.to, events);
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

function doMove(state: BattleState, unitId: string, to: Point, events: BattleEvent[]): void {
  const path = reachableFor(state, unitId).pathTo(to);
  if (!path) throw new IllegalActionError(`cannot move ${unitId} to ${key(to)}`);
  const grid = gridOf(state);
  const cost = path.reduce((s, p) => s + grid.terrainAt(p).moveCost!, 0);
  const unit = unitById(state, unitId);
  unit.pos = { ...to };
  state.turn!.movePointsLeft -= cost;
  events.push({ type: "moved", unitId, path, cost });
}

function doUseMove(
  state: BattleState,
  content: BattleContent,
  unitId: string,
  moveId: string,
  target: Point,
  events: BattleEvent[],
): void {
  const reason = moveUnavailableReason(state, content, unitId, moveId);
  if (reason) throw new IllegalActionError(`${moveId}: ${reason}`);
  if (!validTargets(state, content, unitId, moveId).some((p) => samePoint(p, target)))
    throw new IllegalActionError(`${moveId}: invalid target ${key(target)}`);

  const user = unitById(state, unitId);
  const move = content.moves[moveId]!;
  const affected = affectedUnits(state, move, user, target);
  state.turn!.actionUsed = true;
  if (move.kind === "special" && move.cooldown) user.cooldowns[moveId] = move.cooldown;
  if (move.kind === "ultimate") user.usedUltimates.push(moveId);
  events.push({ type: "moveUsed", unitId, moveId, target, affected: affected.map((u) => u.id) });

  const mech = content.types[move.type]?.move ?? {};
  for (const t of affected) {
    if (t.hp <= 0) continue;
    const isFoe = t.side !== user.side;
    if (move.power > 0) {
      const defender = content.species[t.speciesId]!;
      const typeEff = typeMultiplier(content.typeChart, move.type, defender.types);
      const eff = mech.neverResisted ? Math.max(1, typeEff) : typeEff;
      const m = user.mods;
      const situational =
        (t.statuses.length > 0 ? m.vsStatusDamage : 1) *
        (t.hp === t.maxHp ? m.fullHpTargetDamage : 1) *
        (user.hp * 2 < user.maxHp ? m.lowHpDamage * (m.lowHpTypeDamage[move.type] ?? 1) : 1);
      const helpers = adjacentAllies(state, user, t);
      const positional =
        (mech.flankBonus && helpers > 0 ? mech.flankBonus + m.flankBonus : 1) *
        (1 + (mech.swarmBonus ? (mech.swarmBonus + m.swarmBonus) * helpers : 0));
      const statusMult = statusFactor(content, user, "damageDealt") * statusFactor(content, t, "damageTaken");
      const mult = eff * m.damageDealt * (m.typeDamage[move.type] ?? 1) * situational * positional * statusMult * t.mods.damageTaken;
      const off = content.rules.statOffset;
      const defense = mech.ignoresDefense ? 0 : t.stats.defense;
      const raw = (move.power * (off + user.stats.attack + user.attackBoost)) / (off + defense) * mult / content.rules.damageDivisor;
      // Any hit deals at least 1, unless something blocks all damage (Protect).
      const dealt = dealDamage(state, t, mult > 0 ? Math.max(1, Math.round(raw)) : 0, "move", events, eff);
      if (dealt > 0 && t.hp > 0) onDamaged(content, user, t, manhattan(user.pos, t.pos) === 1, events);
      if (mech.drain && dealt > 0 && user.hp > 0) {
        heal(user, Math.max(1, Math.round(dealt * (mech.drain + m.drainBonus))), events);
      }
    }
    for (const effect of move.effects ?? []) {
      if (t.hp <= 0) break;
      switch (effect.kind) {
        case "heal":
          heal(t, effect.amount, events);
          break;
        case "status":
          applyStatus(content, user, t, effect.status, effect.duration, events);
          break;
        case "push":
        case "pull":
          displace(state, content, user, t, effect.kind, effect.distance + (effect.kind === "push" ? user.mods.pushBonus : user.mods.pullBonus), events);
          break;
      }
    }
    // Type mechanics apply to the enemies a move hits.
    if (!isFoe || t.hp <= 0) continue;
    if (mech.appliesStatus) applyStatus(content, user, t, mech.appliesStatus.status, mech.appliesStatus.duration, events);
    const extra = user.ability?.moveStatus;
    if (extra && extra.type === move.type) applyStatus(content, user, t, extra.status, extra.duration, events);
    if (mech.extraPush) displace(state, content, user, t, "push", mech.extraPush + user.mods.pushBonus, events);
    if (mech.extraPull) displace(state, content, user, t, "pull", mech.extraPull + user.mods.pullBonus, events);
    if (mech.terrainOnHit) changeTerrain(state, t.pos, mech.terrainOnHit, events);
  }
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
  return livingUnits(state).filter((u) => u.side === user.side && u.id !== user.id && manhattan(u.pos, target.pos) === 1).length;
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

function applyStatus(content: BattleContent, user: BattleUnit, t: BattleUnit, status: string, base: number, events: BattleEvent[]): void {
  if (t.mods.statusImmune.includes(status) || t.mods.statusImmune.includes("*")) return;
  const duration = base + user.mods.statusDurationBonus;
  const existing = t.statuses.find((s) => s.id === status);
  if (existing) existing.turnsLeft = content.statuses[status]?.stacks ? existing.turnsLeft + duration : Math.max(existing.turnsLeft, duration);
  else t.statuses.push({ id: status, turnsLeft: duration });
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
  const away = Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) };
  const dir = kind === "push" ? away : { x: -away.x, y: -away.y };
  const grid = gridOf(state);
  const from = { ...target.pos };
  let blocked = false;
  for (let i = 0; i < distance; i++) {
    const next = { x: target.pos.x + dir.x, y: target.pos.y + dir.y };
    if (!grid.isPassable(next) || unitAt(state, next)) {
      blocked = true;
      break;
    }
    target.pos = next;
  }
  if (!samePoint(from, target.pos) || blocked)
    events.push({ type: "displaced", unitId: target.id, from, to: { ...target.pos }, blocked });
  // Only a push into an obstacle hurts; a pull that reaches the user simply stops.
  if (blocked && kind === "push") dealDamage(state, target, content.rules.impactDamage + user.mods.impactBonus, "impact", events);
}

function dealDamage(
  state: BattleState,
  unit: BattleUnit,
  amount: number,
  source: "move" | "status" | "impact",
  events: BattleEvent[],
  effectiveness?: number,
): number {
  let dealt = Math.min(amount, unit.hp);
  if (dealt === unit.hp && unit.ability?.sturdy && !unit.sturdyUsed && unit.hp > 1) {
    // Sturdy: hangs on at 1 HP once per battle.
    unit.sturdyUsed = true;
    dealt = unit.hp - 1;
    events.push({ type: "abilityTriggered", unitId: unit.id, ability: unit.ability.id });
  }
  unit.hp -= dealt;
  events.push({ type: "damaged", unitId: unit.id, amount: dealt, hp: unit.hp, source, ...(effectiveness !== undefined && { effectiveness }) });
  if (unit.hp === 0) {
    events.push({ type: "fainted", unitId: unit.id });
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
  for (const id of Object.keys(unit.cooldowns)) {
    unit.cooldowns[id] = Math.max(0, unit.cooldowns[id]! - 1);
  }
  state.turn = { unitId, movePointsLeft: movementPoints(content, unit, state), actionUsed: false };
  events.push({ type: "turnStarted", unitId, movePoints: state.turn.movePointsLeft });

  for (const st of unit.statuses) {
    const frac = content.statuses[st.id]?.damagePerTurn;
    if (frac && unit.hp > 0) dealDamage(state, unit, Math.max(1, Math.floor(unit.maxHp * frac)), "status", events);
  }
  if (unit.hp > 0 && unit.mods.healPerTurn > 0 && unit.hp < unit.maxHp) {
    const amount = Math.min(unit.maxHp - unit.hp, Math.max(1, Math.floor(unit.maxHp * unit.mods.healPerTurn)));
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
