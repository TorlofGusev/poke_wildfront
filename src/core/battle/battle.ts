import { Grid } from "../grid/Grid";
import { hasLineOfSight } from "../grid/lineOfSight";
import { reachableTiles, type Occupancy, type Reachable } from "../grid/movement";
import { key, manhattan, samePoint, type Point } from "../grid/types";
import { typeMultiplier } from "../rules/typeChart";
import type { BattleContent, MoveDef } from "./content";
import type { BattleEvent } from "./events";
import type { BattleState, BattleUnit, Side } from "./state";

export interface UnitSetup {
  readonly id: string;
  readonly speciesId: string;
  readonly side: Side;
  readonly pos: Point;
  /** Defaults to the species' max HP. */
  readonly hp?: number;
}

export type BattleAction =
  | { readonly type: "move"; readonly unitId: string; readonly to: Point }
  | { readonly type: "useMove"; readonly unitId: string; readonly moveId: string; readonly target: Point }
  | { readonly type: "endTurn"; readonly unitId: string };

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

export const livingUnits = (state: BattleState): BattleUnit[] => state.units.filter((u) => u.hp > 0);

export const unitAt = (state: BattleState, p: Point): BattleUnit | undefined =>
  livingUnits(state).find((u) => samePoint(u.pos, p));

export const activeUnit = (state: BattleState): BattleUnit | null =>
  state.turn ? unitById(state, state.turn.unitId) : null;

export function movementPoints(content: BattleContent, unit: BattleUnit): number {
  const speed = content.species[unit.speciesId]!.stats.speed;
  const base = content.rules.movementBySpeed.find((t) => speed >= t.minSpeed)?.move ?? 0;
  const penalty = unit.statuses.reduce((s, st) => s + (content.statuses[st.id]?.movePenalty ?? 0), 0);
  return Math.max(0, base - penalty);
}

function occupancyFor(state: BattleState, unit: BattleUnit): Occupancy {
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
  return reachableTiles(gridOf(state), unit.pos, mp, occupancyFor(state, unit));
}

/** Why a move is currently unavailable, or null if it can be used. */
export function moveUnavailableReason(
  state: BattleState,
  content: BattleContent,
  unitId: string,
  moveId: string,
): string | null {
  const unit = unitById(state, unitId);
  const species = content.species[unit.speciesId]!;
  if (!species.moves.includes(moveId)) return "unit does not know this move";
  if (state.turn?.unitId !== unitId) return "not this unit's turn";
  if (state.turn.actionUsed) return "action already used this turn";
  if ((unit.cooldowns[moveId] ?? 0) > 0) return `on cooldown (${unit.cooldowns[moveId]})`;
  if (unit.usedUltimates.includes(moveId)) return "already used this battle";
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
        if (t.side !== user.side && dist > 1 && grid.terrainAt(p).concealsAtRange) continue;
      }
      if (affectedUnits(state, move, user, p).length === 0) continue;
      out.push(p);
    }
  return out;
}

// ---------------------------------------------------------------- setup

export const maxHpOf = (content: BattleContent, speciesId: string): number =>
  Math.round(content.species[speciesId]!.stats.hp * content.rules.hpMultiplier);


export function createBattle(
  content: BattleContent,
  mapRows: readonly string[],
  units: readonly UnitSetup[],
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
      const maxHp = maxHpOf(content, u.speciesId);
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
      };
    }),
    round: 0,
    queue: [],
    turn: null,
    outcome: "ongoing",
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
      const sa = content.species[a.speciesId]!.stats.speed;
      const sb = content.species[b.speciesId]!.stats.speed;
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

  for (const t of affected) {
    if (t.hp <= 0) continue;
    if (move.power > 0) {
      const attacker = content.species[user.speciesId]!.stats;
      const defender = content.species[t.speciesId]!;
      const eff = typeMultiplier(content.typeChart, move.type, defender.types);
      const raw = (move.power * attacker.attack) / defender.stats.defense * eff / content.rules.damageDivisor;
      dealDamage(state, t, Math.max(1, Math.round(raw)), "move", events, eff);
    }
    for (const effect of move.effects ?? []) {
      if (t.hp <= 0) break;
      switch (effect.kind) {
        case "heal": {
          const amount = Math.min(effect.amount, t.maxHp - t.hp);
          t.hp += amount;
          events.push({ type: "healed", unitId: t.id, amount, hp: t.hp });
          break;
        }
        case "status": {
          const existing = t.statuses.find((s) => s.id === effect.status);
          if (existing) existing.turnsLeft = Math.max(existing.turnsLeft, effect.duration);
          else t.statuses.push({ id: effect.status, turnsLeft: effect.duration });
          events.push({ type: "statusApplied", unitId: t.id, status: effect.status, duration: effect.duration });
          break;
        }
        case "push":
        case "pull":
          displace(state, content, user, t, effect.kind, effect.distance, events);
          break;
      }
    }
  }
  checkOutcome(state, events);
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
  if (dx === 0 && dy === 0) return;
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
  if (blocked && kind === "push") dealDamage(state, target, content.rules.impactDamage, "impact", events);
}

function dealDamage(
  state: BattleState,
  unit: BattleUnit,
  amount: number,
  source: "move" | "status" | "impact",
  events: BattleEvent[],
  effectiveness?: number,
): void {
  const dealt = Math.min(amount, unit.hp);
  unit.hp -= dealt;
  events.push({ type: "damaged", unitId: unit.id, amount: dealt, hp: unit.hp, source, ...(effectiveness !== undefined && { effectiveness }) });
  if (unit.hp === 0) {
    events.push({ type: "fainted", unitId: unit.id });
    state.queue = state.queue.filter((id, i) => i === 0 || id !== unit.id);
  }
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
  state.turn = { unitId, movePointsLeft: movementPoints(content, unit), actionUsed: false };
  events.push({ type: "turnStarted", unitId, movePoints: state.turn.movePointsLeft });

  for (const st of unit.statuses) {
    const frac = content.statuses[st.id]?.damagePerTurn;
    if (frac && unit.hp > 0) dealDamage(state, unit, Math.max(1, Math.floor(unit.maxHp * frac)), "status", events);
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
  state.queue = state.queue.slice(1).filter((id) => unitById(state, id).hp > 0);
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
