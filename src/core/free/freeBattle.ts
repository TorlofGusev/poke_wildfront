import {
  applyAction, breakAway, checkOutcome, commitMove, effectiveMove, IllegalActionError, livingUnits, moveRange,
  moveUnavailableReason, partnerOf, unitById, type BattleAction, type StepResult,
} from "../battle/battle";
import type { BattleContent, MoveDef } from "../battle/content";
import type { BattleEvent } from "../battle/events";
import { summarizeHits, type HitPreview } from "../battle/preview";
import type { BattleState, BattleUnit } from "../battle/state";
import type { Point } from "../grid/types";
import { distance, distToSegment, inBounds, MELEE_REACH, sightBlocked, UNIT_RADIUS } from "./field";
import { freeReach, type FreeReach } from "./pathing";

/**
 * Battle actions on a free field (prototype). Damage, statuses, turns and engagement are the hex battle's own;
 * only where units stand, how far they walk and what a move reaches are worked out in continuous space.
 */
export type FreeAction =
  | { readonly type: "freeMove"; readonly unitId: string; readonly to: Point }
  | { readonly type: "freeUseMove"; readonly unitId: string; readonly moveId: string; readonly target: Point }
  | Extract<BattleAction, { type: "endTurn" | "switchUnit" | "retreat" }>;

/** How far around the aim point a burst reaches a body (radius 1 ≈ the six hexes around it). */
const BURST_SLACK = UNIT_RADIUS * 0.5;
/** Ranged moves reach the edge of a body standing at their range. */
const RANGE_SLACK = 0.3;

/** Where the unit can still walk this turn. Allies can be crossed; fliers and ghosts cross foes too. */
export function freeReachFor(state: BattleState, unitId: string): FreeReach {
  const unit = unitById(state, unitId);
  const mp = state.turn?.unitId === unitId ? state.turn.movePointsLeft : 0;
  const crossesFoes = !!(unit.traits.flies || unit.traits.phases);
  const bodies = livingUnits(state)
    .filter((u) => u.id !== unitId)
    .map((u) => ({ pos: u.pos, passable: u.side === unit.side || crossesFoes }));
  return freeReach(state.field!, unit.pos, mp, bodies, !!unit.traits.flies);
}

/** A move's reach in hex widths: melee is touching range; ranged moves need room unless their minimum is 1. */
export function freeRange(user: BattleUnit, move: MoveDef): { min: number; max: number } {
  const r = moveRange(user, move);
  return { min: r.min >= 2 ? MELEE_REACH : 0, max: r.max === 0 ? 0 : r.max <= 1 ? MELEE_REACH : r.max + RANGE_SLACK };
}

/** The ground a move covers when aimed: one body, a circle or a strip. */
export type FreeArea =
  | { readonly kind: "single"; readonly at: Point }
  | { readonly kind: "circle"; readonly at: Point; readonly radius: number }
  | { readonly kind: "line"; readonly from: Point; readonly to: Point; readonly width: number };

export type FreeAim =
  | { readonly ok: true; readonly target: Point; readonly area: FreeArea; readonly affected: readonly BattleUnit[] }
  | { readonly ok: false; readonly reason: string; readonly area?: FreeArea };

const wants = (move: MoveDef, user: BattleUnit) => (u: BattleUnit) =>
  move.affects === "any" ? u.id !== user.id : (move.affects === "allies") === (u.side === user.side);

/** The living unit whose body covers `p`, if any. */
export function freeUnitAt(state: BattleState, p: Point): BattleUnit | undefined {
  return livingUnits(state)
    .filter((u) => distance(u.pos, p) <= UNIT_RADIUS)
    .sort((a, b) => distance(a.pos, p) - distance(b.pos, p))[0];
}

/** Whether `user` sees `to`: no rock or bush between them, and (unless it shoots over) no other Pokémon in the way. */
export function freeLineOfSight(state: BattleState, user: BattleUnit, to: Point, target?: BattleUnit): boolean {
  if (sightBlocked(state.field!, user.pos, to, UNIT_RADIUS, target ? UNIT_RADIUS : 0)) return false;
  if (user.mods.shootOver) return true;
  return !livingUnits(state).some((u) => u.id !== user.id && u.id !== target?.id
    && distance(u.pos, to) > UNIT_RADIUS && distToSegment(u.pos, user.pos, to) < UNIT_RADIUS * 0.9);
}

/** What the move covers if aimed at `aim` from where the user stands. */
export function freeArea(state: BattleState, move: MoveDef, user: BattleUnit, aim: Point): FreeArea {
  switch (move.shape.kind) {
    case "single":
      return { kind: "single", at: freeUnitAt(state, aim)?.pos ?? aim };
    case "burst":
      return { kind: "circle", at: freeRange(user, move).max === 0 ? user.pos : aim, radius: move.shape.radius + BURST_SLACK };
    case "line": {
      const len = distance(user.pos, aim) || 1;
      const dir = { x: (aim.x - user.pos.x) / len, y: (aim.y - user.pos.y) / len };
      // The strip runs out at the first rock or bush.
      let reach = move.shape.length + RANGE_SLACK;
      for (let d = UNIT_RADIUS; d <= reach; d += 0.1) {
        if (sightBlocked(state.field!, user.pos, { x: user.pos.x + dir.x * d, y: user.pos.y + dir.y * d }, UNIT_RADIUS, 0)) {
          reach = d;
          break;
        }
      }
      return { kind: "line", from: user.pos, to: { x: user.pos.x + dir.x * reach, y: user.pos.y + dir.y * reach }, width: UNIT_RADIUS };
    }
  }
}

function unitsIn(state: BattleState, area: FreeArea, keep: (u: BattleUnit) => boolean): BattleUnit[] {
  const inside = (u: BattleUnit) => {
    switch (area.kind) {
      case "single":
        return distance(u.pos, area.at) < 1e-6;
      case "circle":
        return distance(u.pos, area.at) <= area.radius;
      case "line":
        return distance(u.pos, area.from) > 1e-6 && distToSegment(u.pos, area.from, area.to) <= area.width + UNIT_RADIUS * 0.4;
    }
  };
  return livingUnits(state).filter((u) => keep(u) && inside(u)).sort((a, b) => a.pos.y - b.pos.y || a.pos.x - b.pos.x);
}

/** Whether a move can be aimed at `aim` right now, and what it would hit. */
export function freeAim(state: BattleState, content: BattleContent, unitId: string, moveId: string, aim: Point): FreeAim {
  const reason = moveUnavailableReason(state, content, unitId, moveId);
  if (reason) return { ok: false, reason };
  const user = unitById(state, unitId);
  const move = content.moves[moveId]!;
  const range = freeRange(user, move);
  const area = freeArea(state, move, user, aim);
  const fail = (why: string): FreeAim => ({ ok: false, reason: why, area });
  if (!inBounds(state.field!, aim)) return fail("off the field");

  let target = aim;
  if (move.shape.kind === "single") {
    const t = range.max === 0 ? user : freeUnitAt(state, aim);
    if (!t) return fail("no Pokémon there");
    if (!wants(move, user)(t) && !(range.max === 0 && t === user)) return fail("not a valid target");
    target = t.pos;
  }
  if (range.max > 0 && move.shape.kind !== "line") {
    const d = distance(user.pos, target);
    if (d > range.max) return fail("out of range");
    if (d < range.min) return fail("too close");
  }
  const aimedUnit = move.shape.kind === "single" ? freeUnitAt(state, target) : undefined;
  if (move.requiresLineOfSight && range.max > 0 && move.shape.kind !== "line" && !freeLineOfSight(state, user, target, aimedUnit))
    return fail("no line of sight");
  const affected = move.shape.kind === "single" ? [freeUnitAt(state, target)!] : unitsIn(state, area, wants(move, user));
  if (affected.length === 0) return fail("hits nobody");
  const foes = affected.filter((u) => u.side !== user.side);
  // Engaged: attacks only go at the partner; taunted: only at the taunter.
  const partner = partnerOf(state, user);
  if (partner && move.affects !== "allies" && foes.some((u) => u.id !== partner.id)) return fail("engaged: only its partner");
  const taunt = user.statuses.find((st) => content.statuses[st.id]?.forcesTarget && st.sourceId);
  if (taunt && move.affects !== "allies" && foes.length && !foes.some((u) => u.id === taunt.sourceId)) return fail("taunted");
  if (move.onlyVs && move.shape.kind === "single" && !affected[0]!.statuses.some((st) => st.id === move.onlyVs)) return fail("not affected");
  return { ok: true, target: area.kind === "line" ? area.to : target, area, affected };
}

export function applyFreeAction(state: BattleState, content: BattleContent, action: FreeAction): StepResult {
  if (action.type !== "freeMove" && action.type !== "freeUseMove") return applyAction(state, content, action);
  if (state.outcome !== "ongoing") throw new IllegalActionError("battle is over");
  if (state.turn?.unitId !== action.unitId) throw new IllegalActionError(`not ${action.unitId}'s turn`);
  const next = structuredClone(state) as BattleState;
  const events: BattleEvent[] = [];
  next.turn!.fresh = false;
  if (action.type === "freeMove") freeMove(next, content, action.unitId, action.to, events);
  else freeUseMove(next, content, action.unitId, action.moveId, action.target, events);
  return { state: next, events };
}

/** Whether walking to `to` breaks the unit's engagement (it ends out of melee reach of its partner). */
export function breaksEngagement(state: BattleState, unitId: string, to: Point): boolean {
  const partner = partnerOf(state, unitById(state, unitId));
  return !!partner && distance(partner.pos, to) > MELEE_REACH;
}

function freeMove(state: BattleState, content: BattleContent, unitId: string, to: Point, events: BattleEvent[]): void {
  const reach = freeReachFor(state, unitId);
  const cost = reach.costTo(to);
  const path = reach.pathTo(to);
  if (cost === null || !path) throw new IllegalActionError(`cannot move ${unitId} there`);
  const unit = unitById(state, unitId);
  // Only leaving the partner's reach is a disengage; moving around it is free.
  if (breaksEngagement(state, unitId, to)) {
    breakAway(state, content, unit, events);
    if (unit.hp <= 0) return checkOutcome(state, events);
  }
  unit.pos = { ...to };
  state.turn!.movePointsLeft = Math.max(0, Math.round((state.turn!.movePointsLeft - cost) * 100) / 100);
  state.turn!.moved = true;
  events.push({ type: "moved", unitId, path, cost });
  checkOutcome(state, events);
}

function freeUseMove(state: BattleState, content: BattleContent, unitId: string, moveId: string, aim: Point, events: BattleEvent[]): void {
  const check = freeAim(state, content, unitId, moveId, aim);
  if (!check.ok) throw new IllegalActionError(`${moveId}: ${check.reason}`);
  const user = unitById(state, unitId);
  const move = effectiveMove(content, user, moveId);
  let target = check.target;
  let affected = check.affected;
  // Confusion: the attack goes to the nearest Pokémon in reach, an ally if one is as close as any foe.
  const confusion = move.affects === "enemies" && move.power > 0 ? user.statuses.find((st) => content.statuses[st.id]?.misdirects) : undefined;
  if (confusion) {
    const range = freeRange(user, move);
    const nearest = livingUnits(state)
      .filter((u) => u.id !== user.id && distance(u.pos, user.pos) >= range.min && distance(u.pos, user.pos) <= Math.max(range.max, MELEE_REACH))
      .sort((a, b) => distance(a.pos, user.pos) - distance(b.pos, user.pos) || Number(b.side === user.side) - Number(a.side === user.side) || (a.id < b.id ? -1 : 1))[0];
    if (nearest) {
      target = nearest.pos;
      affected = unitsIn(state, freeArea(state, move, user, target), (u) => u.id !== user.id);
    }
    user.statuses = user.statuses.filter((st) => st !== confusion);
    events.push({ type: "statusExpired", unitId: user.id, status: confusion.id });
  }
  commitMove(state, content, user, moveId, move, target, affected, events);
}

/** What a move would do if used now (combat is seeded, so playing it on a copy is exact). */
export function previewFreeMove(state: BattleState, content: BattleContent, unitId: string, moveId: string, aim: Point): HitPreview[] {
  if (!freeAim(state, content, unitId, moveId, aim).ok) return [];
  return summarizeHits(applyFreeAction(state, content, { type: "freeUseMove", unitId, moveId, target: aim }).events);
}

/** The free attack a unit would take walking to `to` (empty if it does not disengage). */
export function previewFreeWalk(state: BattleState, content: BattleContent, unitId: string, to: Point): HitPreview[] {
  if (!breaksEngagement(state, unitId, to) || freeReachFor(state, unitId).costTo(to) === null) return [];
  return summarizeHits(applyFreeAction(state, content, { type: "freeMove", unitId, to }).events);
}
