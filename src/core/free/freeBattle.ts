import {
  applyBaseAction, breakAway, checkOutcome, cloneState, commitMove, effectiveMove, hazardsAt, IllegalActionError, livingUnits, moveRange,
  moveUnavailableReason, movementPoints, partnerOf, roll, strike, touchHazard, unitById, type BattleAction, type StepResult,
} from "../battle/battle";
import type { BattleContent, MoveDef } from "../battle/content";
import type { BattleEvent } from "../battle/events";
import { summarizeHits, type HitPreview } from "../battle/preview";
import type { BattleState, BattleUnit, Hazard, PendingStrike } from "../battle/state";
import type { Point } from "../grid/types";
import { distance, distToSegment, inArea, inBounds, MELEE_REACH, sightBlocked, UNIT_RADIUS, type FreeArea } from "./field";
import { freeReach, type FreeReach } from "./pathing";

/**
 * Battle actions on the free field: where units can walk, what a move reaches and hits, and the action
 * entry point. Damage, statuses, turns and engagement are the rules core's (battle.ts).
 */

/** How far around the aim point a burst reaches a body (radius 1 ≈ the six hexes around it). */
const BURST_SLACK = UNIT_RADIUS * 0.5;
/** Ranged moves reach the edge of a body standing at their range. */
const RANGE_SLACK = 0.3;

/**
 * Where the unit can still walk this turn (or, with `mp`, could walk with that much movement: a foe's threat).
 * Allies can be crossed; fliers and ghosts cross foes too.
 */
export function freeReachFor(state: BattleState, unitId: string, mp?: number): FreeReach {
  const unit = unitById(state, unitId);
  mp ??= state.turn?.unitId === unitId ? state.turn.movePointsLeft : 0;
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

export type FreeAim =
  | {
    readonly ok: true; readonly target: Point; readonly area: FreeArea; readonly affected: readonly BattleUnit[];
    /** An ally in the shot's cone who may take a ranged single-target hit instead, and the chance it does. */
    readonly interceptor?: BattleUnit;
    readonly interceptChance?: number;
  }
  | { readonly ok: false; readonly reason: string; readonly area?: FreeArea };

const wants = (move: MoveDef, user: BattleUnit) => (u: BattleUnit) =>
  move.affects === "any" ? u.id !== user.id : (move.affects === "allies") === (u.side === user.side);
/** Areas aimed at foes hit everyone inside them but the user: friendly fire. */
const caught = (move: MoveDef, user: BattleUnit) => (u: BattleUnit) =>
  move.affects === "enemies" ? u.id !== user.id : wants(move, user)(u);

/** Half-angle of the cone in which an ally can step into a ranged shot (30° in all). */
const INTERCEPT_HALF_ANGLE = (15 * Math.PI) / 180;
/** An ally this close to the shooter (bodies touching, with a little room) stands beside it, not in the way. */
const SHOULDER_TO_SHOULDER = UNIT_RADIUS * 2 + 0.15;
/** Chance that an ally dead centre in the cone, right in front of the target, takes the shot instead. */
export const INTERCEPT_MAX = 0.5;

/**
 * The ally most likely to catch a shot at `target`, and how likely: higher the nearer the cone's centre line
 * and the nearer the target it stands (INTERCEPT_MAX at best). Allies touching the shooter do not count.
 */
function interceptorOf(
  state: BattleState, user: BattleUnit, move: MoveDef, target: BattleUnit,
): { unit: BattleUnit; chance: number } | undefined {
  if (move.shape.kind !== "single" || move.affects !== "enemies" || move.power <= 0 || user.mods.shootOver) return undefined;
  if (freeRange(user, move).max <= MELEE_REACH) return undefined;
  const reach = distance(user.pos, target.pos);
  const aim = Math.atan2(target.pos.y - user.pos.y, target.pos.x - user.pos.x);
  let best: { unit: BattleUnit; chance: number } | undefined;
  for (const u of livingUnits(state)) {
    if (u.side !== user.side || u.id === user.id) continue;
    const d = distance(user.pos, u.pos);
    if (d <= SHOULDER_TO_SHOULDER || d >= reach) continue;
    const off = Math.abs(((Math.atan2(u.pos.y - user.pos.y, u.pos.x - user.pos.x) - aim + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    if (off > INTERCEPT_HALF_ANGLE) continue;
    const chance = Math.round(INTERCEPT_MAX * (1 - off / INTERCEPT_HALF_ANGLE) * (d / reach) * 100) / 100;
    if (chance > (best?.chance ?? 0)) best = { unit: u, chance };
  }
  return best;
}

/** The living unit whose body covers `p`, if any. */
export function freeUnitAt(state: BattleState, p: Point): BattleUnit | undefined {
  return livingUnits(state)
    .filter((u) => distance(u.pos, p) <= UNIT_RADIUS)
    .sort((a, b) => distance(a.pos, p) - distance(b.pos, p))[0];
}

/** Whether `user` sees `to`: no rock or bush between them, and (unless it shoots over) no other Pokémon in the way. */
export function freeLineOfSight(state: BattleState, user: BattleUnit, to: Point, target?: BattleUnit): boolean {
  // Keen Eye sees through bushes.
  if (sightBlocked(state.field, user.pos, to, UNIT_RADIUS, target ? UNIT_RADIUS : 0, !!user.ability?.keenEye)) return false;
  if (user.mods.shootOver) return true;
  // Allies never block a shot; they may catch it instead (interceptorOf).
  return !livingUnits(state).some((u) => u.id !== user.id && u.id !== target?.id && u.side !== user.side
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
    case "cone": {
      const angle = Math.atan2(aim.y - user.pos.y, aim.x - user.pos.x);
      return { kind: "cone", from: user.pos, angle, length: move.shape.length + RANGE_SLACK, halfAngle: (move.shape.angle * Math.PI) / 360 };
    }
  }
}

function unitsIn(state: BattleState, area: FreeArea, keep: (u: BattleUnit) => boolean): BattleUnit[] {
  return livingUnits(state).filter((u) => keep(u) && inArea(area, u.pos)).sort((a, b) => a.pos.y - b.pos.y || a.pos.x - b.pos.x);
}

/** Whether the move can be aimed at any Pokémon right now (so its button can be pressed). */
export function freeHasTarget(state: BattleState, content: BattleContent, unitId: string, moveId: string): boolean {
  // A watch guards ground: it needs no one there yet.
  if (content.moves[moveId]?.timing === "watch") return !moveUnavailableReason(state, content, unitId, moveId) && !partnerOf(state, unitById(state, unitId));
  return livingUnits(state).some((u) => freeAim(state, content, unitId, moveId, u.pos).ok);
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
  // The Pokémon a single-target move is aimed at (the user itself for a move on itself).
  let aimedUnit: BattleUnit | undefined;
  if (move.shape.kind === "single") {
    aimedUnit = range.max === 0 ? user : freeUnitAt(state, aim);
    if (!aimedUnit) return fail("no Pokémon there");
    if (!wants(move, user)(aimedUnit) && !(range.max === 0 && aimedUnit === user)) return fail("not a valid target");
    target = aimedUnit.pos;
  }
  const fans = move.shape.kind === "line" || move.shape.kind === "cone";
  if (range.max > 0 && !fans) {
    const d = distance(user.pos, target);
    if (d > range.max) return fail("out of range");
    if (d < range.min) return fail("too close");
  }
  if (move.requiresLineOfSight && range.max > 0 && !fans && !freeLineOfSight(state, user, target, aimedUnit))
    return fail("no line of sight");
  const affected = aimedUnit ? [aimedUnit] : unitsIn(state, area, caught(move, user));
  const partner = partnerOf(state, user);
  // A watch or a delayed strike needs the Pokémon free to aim it, and may cover empty ground.
  if (move.timing) {
    if (partner) return fail("engaged: only its partner");
    return { ok: true, target: area.kind === "line" ? area.to : target, area, affected };
  }
  if (!affected.some(wants(move, user))) return fail("hits nobody");
  const foes = affected.filter((u) => u.side !== user.side);
  // Engaged: attacks only go at the partner; taunted: only at the taunter.
  if (partner && move.affects !== "allies" && foes.some((u) => u.id !== partner.id)) return fail("engaged: only its partner");
  const taunt = user.statuses.find((st) => content.statuses[st.id]?.forcesTarget && st.sourceId);
  if (taunt && move.affects !== "allies" && foes.length && !foes.some((u) => u.id === taunt.sourceId)) return fail("taunted");
  if (move.onlyVs && move.shape.kind === "single" && !affected[0]!.statuses.some((st) => st.id === move.onlyVs)) return fail("not affected");
  const interceptor = aimedUnit ? interceptorOf(state, user, move, aimedUnit) : undefined;
  return {
    ok: true, target: area.kind === "line" ? area.to : target, area, affected,
    ...(interceptor ? { interceptor: interceptor.unit, interceptChance: interceptor.chance } : {}),
  };
}

/** Applies one action: walks and moves here, everything else by the rules core. Never mutates `state`. */
export function applyAction(state: BattleState, content: BattleContent, action: BattleAction): StepResult {
  if (action.type !== "move" && action.type !== "useMove") return applyBaseAction(state, content, action);
  if (state.outcome !== "ongoing") throw new IllegalActionError("battle is over");
  if (state.turn?.unitId !== action.unitId) throw new IllegalActionError(`not ${action.unitId}'s turn`);
  const next = cloneState(state);
  const events: BattleEvent[] = [];
  next.turn!.fresh = false;
  if (action.type === "move") freeMove(next, content, action.unitId, action.to, events);
  else freeUseMove(next, content, action.unitId, action.moveId, action.target, events);
  return { state: next, events };
}

/** Whether walking to `to` breaks the unit's engagement: any step an engaged Pokémon takes does. */
export function breaksEngagement(state: BattleState, unitId: string, to: Point): boolean {
  const unit = unitById(state, unitId);
  return !!partnerOf(state, unit) && distance(unit.pos, to) > 0.01;
}

function freeMove(state: BattleState, content: BattleContent, unitId: string, to: Point, events: BattleEvent[]): void {
  const reach = freeReachFor(state, unitId);
  const cost = reach.costTo(to);
  const path = reach.pathTo(to);
  if (cost === null || !path) throw new IllegalActionError(`cannot move ${unitId} there`);
  const unit = unitById(state, unitId);
  if (breaksEngagement(state, unitId, to)) {
    breakAway(state, content, unit, events);
    if (unit.hp <= 0) return checkOutcome(state, events);
  }
  const walk = walkOut(state, unit, path);
  const spent = Math.round(cost * walk.share * 100) / 100;
  unit.pos = { ...walk.stop };
  state.turn!.movePointsLeft = Math.max(0, Math.round((state.turn!.movePointsLeft - spent) * 100) / 100);
  state.turn!.moved = true;
  events.push({ type: "moved", unitId, path: walk.path, cost: spent });
  for (const h of walk.entered) touchHazard(state, content, unit, h, events);
  const watch = walk.watch;
  if (watch && unit.hp > 0 && state.outcome === "ongoing") {
    state.pending = (state.pending ?? []).filter((p) => p !== watch);
    const watcher = unitById(state, watch.unitId);
    events.push({ type: "watchTriggered", unitId: watcher.id, targetId: unit.id, moveId: watch.moveId });
    strike(state, content, watcher, watch.moveId, effectiveMove(content, watcher, watch.moveId), unit.pos, [unit], events);
  }
  checkOutcome(state, events);
}

/** How finely a walk is checked for watched ground and hazards (hex widths). */
const WALK_STEP = 0.1;

/**
 * Follows a walk step by step: it stops at the first spot a foe watches (where the body has room to stand),
 * and notes the burning or poisoned ground it walks into. `share`: how much of the walk was made.
 */
function walkOut(
  state: BattleState, unit: BattleUnit, path: readonly Point[],
): { stop: Point; path: Point[]; share: number; entered: Hazard[]; watch?: PendingStrike } {
  const watches = (state.pending ?? []).filter((p) => p.kind === "watch" && unitById(state, p.unitId).side !== unit.side && unitById(state, p.unitId).hp > 0);
  const hazards = (state.hazards ?? []).filter((h) => h.kind !== "mud");
  const startIn = new Set(hazardsAt(state, unit.pos).map((h) => h.id));
  const others = livingUnits(state).filter((u) => u.id !== unit.id);
  const total = path.reduce((s, p, i) => s + distance(i ? path[i - 1]! : unit.pos, p), 0);
  const entered = new Map<number, Hazard>();
  let walked = 0;
  let from = unit.pos;
  let pending: PendingStrike | undefined;
  for (let i = 0; i < path.length; i++) {
    const to = path[i]!;
    const len = distance(from, to);
    for (let d = Math.min(WALK_STEP, len); ; d = Math.min(d + WALK_STEP, len)) {
      const p = { x: from.x + ((to.x - from.x) * d) / (len || 1), y: from.y + ((to.y - from.y) * d) / (len || 1) };
      for (const h of hazards) if (!startIn.has(h.id) && distance(h.at, p) <= h.radius) entered.set(h.id, h);
      pending ??= watches.find((w) => inArea(w.area, p));
      // Caught: it stops at the first spot from here on where its body fits between the others.
      if (pending && !others.some((o) => distance(o.pos, p) < UNIT_RADIUS * 2 - 1e-6)) {
        const done = walked + d;
        return { stop: p, path: [...path.slice(0, i), p], share: total ? done / total : 1, entered: [...entered.values()], watch: pending };
      }
      if (d >= len) break;
    }
    walked += len;
    from = to;
  }
  return { stop: path[path.length - 1] ?? unit.pos, path: [...path], share: 1, entered: [...entered.values()], ...(pending && { watch: pending }) };
}

function freeUseMove(
  state: BattleState, content: BattleContent, unitId: string, moveId: string, aim: Point, events: BattleEvent[], intercept = true,
): void {
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
  } else if (intercept && check.interceptor && roll(state) < check.interceptChance!) {
    target = check.interceptor.pos;
    affected = [unitById(state, check.interceptor.id)];
  }
  commitMove(state, content, user, moveId, move, target, affected, events, check.area);
}

/**
 * What a delayed strike or a watch set up now would do when it lands, played out at once on a copy (for the
 * AI and the aim preview): a delayed strike hits whoever stands in its area now; a watch hits the nearest foe
 * able to walk into it next turn. Empty when nobody would be hit.
 */
export function timedStrikeOutcome(
  state: BattleState, content: BattleContent, unitId: string, moveId: string, aim: Point,
): { state: BattleState; events: BattleEvent[] } | null {
  const check = freeAim(state, content, unitId, moveId, aim);
  const move = content.moves[moveId]!;
  if (!check.ok || !move.timing) return null;
  const copy = cloneState(state);
  const user = unitById(copy, unitId);
  let hit: BattleUnit[];
  if (move.timing === "delayed") hit = livingUnits(copy).filter((u) => u.id !== unitId && inArea(check.area, u.pos));
  else {
    const reach = (u: BattleUnit) => movementPoints(content, u, copy);
    const near = livingUnits(copy)
      .filter((u) => u.side !== user.side && areaGap(check.area, u.pos) <= reach(u))
      .sort((a, b) => areaGap(check.area, a.pos) - areaGap(check.area, b.pos))[0];
    hit = near ? [near] : [];
  }
  if (!hit.length) return null;
  const events: BattleEvent[] = [];
  strike(copy, content, user, moveId, effectiveMove(content, user, moveId), check.target, hit, events);
  return { state: copy, events };
}

/** Roughly how far `p` is from stepping into the area (0 inside). */
function areaGap(area: FreeArea, p: Point): number {
  if (inArea(area, p)) return 0;
  switch (area.kind) {
    case "single":
      return distance(p, area.at);
    case "circle":
      return distance(p, area.at) - area.radius;
    case "line":
      return distToSegment(p, area.from, area.to);
    case "cone": {
      const tip = { x: area.from.x + Math.cos(area.angle) * area.length / 2, y: area.from.y + Math.sin(area.angle) * area.length / 2 };
      return Math.max(0, distance(p, tip) - area.length / 2);
    }
  }
}

/** What a move would do if used now (combat is seeded, so playing it on a copy is exact). */
export function previewFreeMove(state: BattleState, content: BattleContent, unitId: string, moveId: string, aim: Point): HitPreview[] {
  return summarizeHits(previewFreeMoveEvents(state, content, unitId, moveId, aim));
}

/** A knockback a move would cause: where the Pokémon ends up, and the impact damage if it hits an obstacle. */
export interface PushPreview {
  readonly unitId: string;
  readonly from: Point;
  readonly to: Point;
  readonly impact: number;
}

/** The pushes and pulls a move would cause (not an engaged pair stepping together). */
export function previewPushes(state: BattleState, content: BattleContent, unitId: string, moveId: string, aim: Point): PushPreview[] {
  const events = previewFreeMoveEvents(state, content, unitId, moveId, aim);
  const out: PushPreview[] = [];
  events.forEach((e, i) => {
    if (e.type !== "displaced" || e.engage) return;
    // An engaged pair closing in again afterwards undoes the knockback: the arrow shows where it really ends up.
    const settled = events.slice(i + 1).find((d) => d.type === "displaced" && d.unitId === e.unitId);
    const to = settled?.type === "displaced" && settled.engage ? settled.to : e.to;
    // Its impact damage follows before the next knockback (a broken engagement may come in between).
    let impact = 0;
    for (let j = i + 1; j < events.length && events[j]!.type !== "displaced"; j++) {
      const d = events[j]!;
      if (d.type === "damaged" && d.unitId === e.unitId && d.source === "impact") impact += d.amount;
    }
    if (distance(e.from, to) > 0.05 || impact) out.push({ unitId: e.unitId, from: e.from, to, impact });
  });
  return out;
}

/** Everything a move would do if used now, as events (played on a copy; the shot lands where it is aimed). */
function previewFreeMoveEvents(state: BattleState, content: BattleContent, unitId: string, moveId: string, aim: Point): BattleEvent[] {
  if (!freeAim(state, content, unitId, moveId, aim).ok) return [];
  // Shows the hit on the aimed Pokémon; the scene warns about an ally who may catch it.
  const copy = cloneState(state);
  const events: BattleEvent[] = [];
  freeUseMove(copy, content, unitId, moveId, aim, events, false);
  return events;
}

/** The free attack a unit would take walking to `to` (empty if it does not disengage). */
export function previewFreeWalk(state: BattleState, content: BattleContent, unitId: string, to: Point): HitPreview[] {
  if (!breaksEngagement(state, unitId, to) || freeReachFor(state, unitId).costTo(to) === null) return [];
  return summarizeHits(applyAction(state, content, { type: "move", unitId, to }).events);
}
