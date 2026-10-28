import {
  applyAction,
  hazardsAt,
  livingUnits,
  movementPoints,
  unitById,
  type BattleAction,
  type BattleContent,
  type BattleState,
  type BattleUnit,
} from "../battle";
import type { Point } from "../grid/types";
import { distance, freeAim, freeRange, freeReach, freeReachFor, inArea, timedStrikeOutcome, CELL } from "../free";

/**
 * A delayed strike or a watch hits later, if at all: worth this share of the same hit landing now
 * (foes can step out of a marked spot; a watch may never be walked into).
 */
const TIMED_SHARE = { delayed: 0.7, watch: 0.4 } as const;
/** Cost of ending a walk on burning or poisoned ground, or in a foe's watched area (per hazard or watch). */
const DANGER = 1.5;
/** How far the AI looks along walking paths when it has nothing in reach (hex widths; past it, straight-line × 3). */
const WALK_HORIZON = 40;

/** Hazards, foe watches and foe delayed strikes covering `pos`. */
function dangerAt(state: BattleState, self: BattleUnit, pos: Point): number {
  const marks = (state.pending ?? []).filter((p) => unitById(state, p.unitId).side !== self.side && inArea(p.area, pos));
  return hazardsAt(state, pos).length + marks.length;
}

/** Foes and allies a hazard can catch: those standing in it, or a short step from it. */
const ZONE_REACH = 0.5;

/**
 * What the hazards a move leaves are worth: fire's damage and poison's turns on the foes standing in or
 * near it (once each; they may walk out), less the same for allies. Mud only slows: not weighed.
 */
function zoneValue(content: BattleContent, state: BattleState, self: BattleUnit, moveId: string, at: Point, w: AiWeights): number {
  let value = 0;
  for (const e of content.moves[moveId]!.effects ?? []) {
    if (e.kind !== "zone" || e.hazard === "mud") continue;
    for (const u of livingUnits(state)) {
      if (distance(u.pos, at) > e.radius + ZONE_REACH) continue;
      const worth = e.hazard === "fire"
        ? Math.max(1, Math.floor(u.maxHp * content.rules.zones.fireDamage)) * w.damage
        : content.rules.zones.poisonDuration * w.statusPerTurn;
      value += u.side === self.side ? -worth : worth;
    }
  }
  return value;
}

export interface AiWeights {
  /** Value per HP of damage dealt to opponents. */
  readonly damage: number;
  /** Bonus for each opponent knocked out. */
  readonly knockout: number;
  /** Value per HP healed on allies. */
  readonly heal: number;
  /** Penalty per HP lost by own side (friendly fire, impact). */
  readonly ownLoss: number;
  /** Flat cost of spending an ultimate, so it is saved for big turns. */
  readonly ultimateCost: number;
  /** Value of applying a status, per turn of duration. */
  readonly statusPerTurn: number;
  /** Cost of spending one team Bond point. */
  readonly bondCost: number;
  /**
   * Value of a defensive buff (Protect, Iron Defense) per opponent that can hit the unit next round,
   * scaled by the share of damage it prevents. Worth nothing when no opponent can reach the unit.
   */
  readonly guardPerThreat: number;
  /** Extra guard value per share of max HP already lost: a hurt unit shields up sooner. */
  readonly guardLowHp: number;
  /** Value of an offensive buff (Focus Energy) per +100% damage, if an opponent is in reach by next turn. */
  readonly focusSetup: number;
  /** Value of a speed buff (Agility) per extra unit of movement, only while no opponent is in reach this turn. */
  readonly hastePerTile: number;
  /** Penalty per unit of distance to the nearest opponent for setup buffs, so the unit still advances while buffing. */
  readonly buffApproach: number;
  /** Upper bound of any single buff, kept below `knockout` so a buff never beats a kill. */
  readonly buffCap: number;
  /** Value per team Bond point gained (combos). */
  readonly bondGain: number;
  /** Value of pinning a foe in an engagement, per other ally that can reach it next round to combo. */
  readonly engagePerFlanker: number;
  /**
   * Weight of what a status on a foe actually does (damage over time, extra damage allies deal,
   * lost turns or movement), on top of the flat `statusPerTurn`. 0 = statuses are judged flatly.
   */
  readonly statusImpact: number;
  /** Value of slipping out of an engagement, per share of max HP already lost (from half HP on). */
  readonly escapeLowHp: number;
  /**
   * Sloppiness, 0..1: picks among every plan scoring at least (1 - slack) × the best one instead of
   * the best. Seeded from the battle state, so a turn still replays identically.
   */
  readonly slack: number;
  /** Penalty per opponent that could strike the unit's end position next round, minus allies close by. */
  readonly exposure: number;
  /**
   * Rounds the unit holds at the edge of the opponents' reach instead of stepping into it first
   * (so whoever charges in gets hit first); afterwards it advances anyway. 0 = always charge.
   */
  readonly patienceRounds: number;
}

export const DEFAULT_AI_WEIGHTS: AiWeights = {
  damage: 1,
  knockout: 25,
  heal: 0.8,
  ownLoss: 1.2,
  ultimateCost: 20,
  statusPerTurn: 2,
  bondCost: 8,
  guardPerThreat: 4,
  guardLowHp: 3,
  focusSetup: 12,
  hastePerTile: 3,
  buffApproach: 0.1,
  buffCap: 15,
  bondGain: 5,
  engagePerFlanker: 4,
  statusImpact: 1,
  escapeLowHp: 30,
  slack: 0,
  exposure: 6,
  patienceRounds: 2,
};

/**
 * Early-route wild Pokémon, so new players can learn: no combo play or self-buffs, little interest
 * in finishing foes off or in statuses, and often a merely decent move instead of the best one.
 */
export const NOVICE_AI_WEIGHTS: AiWeights = {
  ...DEFAULT_AI_WEIGHTS,
  knockout: 8,
  statusPerTurn: 1,
  ultimateCost: 35,
  guardPerThreat: 0,
  focusSetup: 0,
  hastePerTile: 0,
  bondGain: 0,
  engagePerFlanker: 0,
  statusImpact: 0,
  escapeLowHp: 0,
  slack: 0.5,
  exposure: 0,
  patienceRounds: 0,
};

/**
 * The tutorial map: wild Pokémon just swing at whoever is near, never chase knockouts, statuses
 * or ultimates, and mostly pick a so-so move.
 */
export const TUTORIAL_AI_WEIGHTS: AiWeights = {
  ...NOVICE_AI_WEIGHTS,
  knockout: 0,
  statusPerTurn: 0,
  ultimateCost: 1000,
  bondCost: 1000,
  slack: 0.8,
};

export type AiLevel = "tutorial" | "novice" | "normal";
export const AI_LEVELS: Readonly<Record<AiLevel, AiWeights>> = { tutorial: TUTORIAL_AI_WEIGHTS, novice: NOVICE_AI_WEIGHTS, normal: DEFAULT_AI_WEIGHTS };

interface Plan {
  readonly actions: BattleAction[];
  readonly score: number;
}

/** Spacing of the spots the AI weighs walking to (in hex widths). */
const STOP_SPACING = 0.75;

/** Spots worth weighing: a lattice of the reach about STOP_SPACING apart. */
function stopsFor(state: BattleState, unitId: string): Point[] {
  const stride = Math.round(STOP_SPACING / CELL);
  return freeReachFor(state, unitId).cells.filter((p) => Math.floor(p.x / CELL) % stride === 0 && Math.floor(p.y / CELL) % stride === 0);
}

/** Where a move can be aimed right now: at each Pokémon it may legally target (areas centre on them too). */
function aimPoints(state: BattleState, content: BattleContent, unitId: string, moveId: string): Point[] {
  return livingUnits(state).map((u) => u.pos).filter((p) => freeAim(state, content, unitId, moveId, p).ok);
}

/**
 * Whether anything the unit could aim at stands within its longest reach of `pos` (a cheap check before
 * simulating). A unit with a move on itself (a buff) can use it anywhere, so every spot counts.
 */
function anythingInReach(content: BattleContent, state: BattleState, self: BattleUnit, pos: Point): boolean {
  if (self.moves.some((m) => content.moves[m]!.range.max === 0 && content.moves[m]!.shape.kind === "single")) return true;
  const reach = Math.max(0, ...self.moves.map((m) => {
    const mv = content.moves[m]!;
    const area = mv.shape.kind === "burst" ? mv.shape.radius + 0.5 : mv.shape.kind === "line" || mv.shape.kind === "cone" ? mv.shape.length : 0;
    return Math.max(freeRange(self, mv).max, area);
  }));
  return livingUnits(state).some((u) => u.id !== self.id && distance(u.pos, pos) <= reach + 0.5);
}

/**
 * Picks the active unit's turn as a list of actions ending with `endTurn`.
 * Simulates every (spot, move, target) combination with the real rules engine — spots sampled
 * about STOP_SPACING apart over its reach — so the AI can never attempt an illegal action and
 * needs no separate damage model. Deterministic: ties keep the first plan found in a fixed order.
 * Callers must stop applying the plan once the battle has ended.
 */
export function planTurn(
  state: BattleState,
  content: BattleContent,
  weights: AiWeights = DEFAULT_AI_WEIGHTS,
): BattleAction[] {
  const turn = state.turn;
  if (!turn) return [];
  const unitId = turn.unitId;
  const self = unitById(state, unitId);
  const end: BattleAction = { type: "endTurn", unitId };

  const reachable = stopsFor(state, unitId);
  const stops: (Point | null)[] = [null, ...reachable.filter((p) => anythingInReach(content, state, self, p))];
  let best: Plan | null = null;
  const plans: Plan[] = [];

  for (const stop of stops) {
    const moveAction: BattleAction | null = stop ? { type: "move", unitId, to: stop } : null;
    let afterMove = state;
    if (moveAction) {
      // A lattice spot can cost a hair more than the reach once walked exactly: skip it then.
      try {
        afterMove = applyAction(state, content, moveAction).state;
      } catch {
        continue;
      }
      if (afterMove.outcome !== "ongoing" || afterMove.turn?.unitId !== unitId) continue;
    }
    for (const moveId of self.moves) {
      for (const target of aimPoints(afterMove, content, unitId, moveId)) {
        const use: BattleAction = { type: "useMove", unitId, moveId, target };
        const result = applyAction(afterMove, content, use);
        let score = evaluate(content, state, result.state, self, weights, result.events);
        const mv = content.moves[moveId]!;
        score += zoneValue(content, afterMove, self, moveId, target, weights);
        if (mv.timing) {
          const later = timedStrikeOutcome(afterMove, content, unitId, moveId, target);
          if (later) score += TIMED_SHARE[mv.timing] * evaluate(content, afterMove, later.state, self, weights, later.events);
        }
        if (mv.kind === "ultimate") score -= weights.ultimateCost;
        if (mv.kind === "bond") score -= weights.bondCost * (mv.bondCost ?? 0);
        if (score <= 0) continue;
        // The rest of the turn: greedily add the best further moves (the basic, specials off cooldown, Bond moves).
        const follow = followUps(result.state, content, self, weights);
        // Where the turn ends matters: fewer foes able to strike back, more friends nearby.
        const at = unitById(result.state, unitId).pos;
        const exposed = (weights.exposure > 0 && result.state.outcome === "ongoing" ? weights.exposure * exposureAt(content, result.state, self, at) : 0)
          + DANGER * dangerAt(result.state, self, at);
        const total = score + (follow?.score ?? 0) - exposed;
        const plan = { actions: [...(moveAction ? [moveAction] : []), use, ...(follow?.actions ?? []), end], score: total };
        if (weights.slack > 0) plans.push(plan);
        if (!best || total > best.score) best = plan;
      }
    }
  }
  if (best && weights.slack > 0) {
    const okay = plans.filter((p) => p.score >= best!.score * (1 - weights.slack));
    return okay[pickIndex(state, unitId, okay.length)]!.actions;
  }
  if (best) return best.actions;

  // Nothing worth doing in reach: advance. Melee units charge at once and go for the ranged foes
  // (one step counts as closer), to engage them; ranged units early on stop at the edge of the foes'
  // reach, so the side that charges in first is the one that gets hit first.
  const opponents = livingUnits(state).filter((u) => u.side !== self.side);
  const melee = longestReach(content, self) <= 1;
  // Walking distance, not straight-line: a rock between the sides would otherwise leave both waiting at its faces.
  const walks = opponents.map((o) => ({ o, reach: freeReach(state.field, o.pos, WALK_HORIZON, [], !!self.traits.flies) }));
  const walk = (p: Point, w: (typeof walks)[number]) => w.reach.costTo(p) ?? distance(p, w.o.pos) * 3;
  const distTo = (p: Point) => Math.min(...walks.map((w) => walk(p, w) - (melee && longestReach(content, w.o) > 1 ? 1 : 0)));
  const patient = !melee && state.round <= weights.patienceRounds;
  // Once patience is over, closing in comes first: exposure only breaks ties between equally close
  // spots (weighted fully, it outweighed every step forward and melee units never left their spot).
  const exposureWeight = weights.exposure > 0 ? (patient ? 2 : 0.1) : 0;
  const cost = (p: Point) => distTo(p) + exposureWeight * exposureAt(content, state, self, p) + DANGER * dangerAt(state, self, p);
  const reach = freeReachFor(state, unitId);
  let bestStop: Point | null = null;
  let bestCost = cost(self.pos);
  for (const p of reachable) {
    if (reach.costTo(p) === null) continue;
    if (distTo(p) >= distTo(self.pos)) continue;
    if (patient && exposureAt(content, state, self, p) > 0) continue;
    const c = cost(p);
    if (c < bestCost) {
      bestCost = c;
      bestStop = p;
    }
  }
  return bestStop ? [{ type: "move", unitId, to: bestStop }, end] : [end];
}

/** A deterministic index in [0, n) from the round, the unit and the battle's RNG state. */
function pickIndex(state: BattleState, unitId: string, n: number): number {
  let h = (state.rngState ^ (state.round * 2654435761)) >>> 0;
  for (const c of unitId) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h % n;
}

/** How many more moves the AI chains after the first one in a turn (specials off cooldown, the basic, Bond moves). */
const MAX_FOLLOW_UPS = 3;

/** Greedily adds the best further move while one is worth using: the rest of the turn after the first move. */
function followUps(
  after: BattleState,
  content: BattleContent,
  self: BattleUnit,
  w: AiWeights,
): { actions: BattleAction[]; score: number } | null {
  const actions: BattleAction[] = [];
  let score = 0;
  let state = after;
  for (let k = 0; k < MAX_FOLLOW_UPS; k++) {
    const next = bestFollowUp(state, content, self, w);
    if (!next) break;
    actions.push(next.action);
    score += next.score;
    state = applyAction(state, content, next.action).state;
  }
  return actions.length ? { actions, score } : null;
}

function bestFollowUp(
  after: BattleState,
  content: BattleContent,
  self: BattleUnit,
  w: AiWeights,
): { action: BattleAction; score: number } | null {
  if (after.outcome !== "ongoing" || after.turn?.unitId !== self.id) return null;
  let best: { action: BattleAction; score: number } | null = null;
  for (const moveId of self.moves) {
    const mv = content.moves[moveId]!;
    for (const target of aimPoints(after, content, self.id, moveId)) {
      const action: BattleAction = { type: "useMove", unitId: self.id, moveId, target };
      const r = applyAction(after, content, action);
      let score = evaluate(content, after, r.state, self, w, r.events);
      if (mv.kind === "ultimate") score -= w.ultimateCost;
      if (mv.kind === "bond") score -= w.bondCost * (mv.bondCost ?? 0);
      if (score > 0 && (!best || score > best.score)) best = { action, score };
    }
  }
  return best;
}

function evaluate(
  content: BattleContent,
  before: BattleState,
  after: BattleState,
  self: BattleUnit,
  w: AiWeights,
  events: ReturnType<typeof applyAction>["events"],
): number {
  let score = 0;
  for (const u of before.units) {
    const now = unitById(after, u.id);
    const delta = now.hp - u.hp;
    if (u.side === self.side) {
      score += delta > 0 ? delta * w.heal : delta * w.ownLoss;
    } else {
      score += -delta * w.damage;
      if (u.hp > 0 && now.hp <= 0) score += w.knockout;
    }
  }
  for (const e of events) {
    if (e.type === "bondChanged" && e.side === self.side && e.amount > 0) score += e.amount * w.bondGain;
    if (e.type === "engaged" && e.unitId === self.id) score += engageValue(content, after, self, unitById(after, e.targetId), w);
    if (e.type === "disengaged" && e.unitId === self.id) {
      const lost = 1 - unitById(after, self.id).hp / self.maxHp;
      if (lost >= 0.5) score += lost * w.escapeLowHp;
    }
    if (e.type !== "statusApplied") continue;
    const target = unitById(after, e.unitId);
    if (target.side !== self.side) score += e.duration * w.statusPerTurn + w.statusImpact * debuffValue(content, after, self, target, e.status, e.duration);
    else if (!unitById(before, e.unitId).statuses.some((st) => st.id === e.status)) {
      score += buffValue(content, after, target, e.status, w);
    }
  }
  return score;
}

/**
 * Rough HP-equivalent worth of a status on a foe: its damage over time, the extra damage allies in
 * reach will deal, the turns or movement it loses, or the damage it no longer deals.
 */
function debuffValue(content: BattleContent, state: BattleState, self: BattleUnit, target: BattleUnit, statusId: string, duration: number): number {
  const def = content.statuses[statusId];
  if (!def || target.hp <= 0) return 0;
  // A typical hit for this stage of the game, from the foe's size.
  const hit = target.maxHp * 0.25;
  let value = 0;
  if (def.damagePerTurn) value += target.maxHp * def.damagePerTurn * duration;
  if (def.damageTaken !== undefined && def.damageTaken > 1) {
    const hitters = livingUnits(state).filter((a) => a.side === self.side && distance(a.pos, target.pos) <= threatRange(content, state, a)).length;
    value += hitters * hit * (def.damageTaken - 1) * duration;
  }
  if (def.damageDealt !== undefined && def.damageDealt < 1) value += hit * (1 - def.damageDealt) * duration;
  if (def.noAction) value += hit * duration;
  // Sealed skills: worth the gap between its best skill and its basic attack.
  if (def.noSkills) value += hit * 0.5 * duration;
  // Confused: its next attack may land on its own side.
  if (def.misdirects) value += hit * 0.6;
  if (def.noMove) {
    // Rooted: worth most when it cannot already reach anyone from where it stands.
    const reach = Math.max(0, ...target.moves.map((m) => (content.moves[m]!.power > 0 ? content.moves[m]!.range.max : 0)));
    const inReach = livingUnits(state).some((a) => a.side === self.side && distance(a.pos, target.pos) <= reach);
    value += hit * (inReach ? 0.3 : 0.8) * duration;
  }
  if (def.movePenalty !== undefined && def.movePenalty > 0) value += hit * 0.1 * def.movePenalty * duration;
  return value;
}

/** Worth of pinning `target`: other allies that can reach it next round will combo off the engagement. */
function engageValue(content: BattleContent, state: BattleState, self: BattleUnit, target: BattleUnit, w: AiWeights): number {
  if (target.hp <= 0) return 0;
  const flankers = livingUnits(state).filter((a) => a.side === self.side && a.id !== self.id
    && distance(a.pos, target.pos) <= threatRange(content, state, a)).length;
  return flankers * w.engagePerFlanker;
}

/**
 * How exposed a unit would be standing at `pos`: opponents that could strike it there next round,
 * less one for each ally within 2 to share the blows (never below 0).
 */
function exposureAt(content: BattleContent, state: BattleState, self: BattleUnit, pos: Point): number {
  const threats = livingUnits(state).filter((o) => o.side !== self.side && distance(o.pos, pos) <= threatRange(content, state, o)).length;
  const friends = livingUnits(state).filter((a) => a.side === self.side && a.id !== self.id && distance(a.pos, pos) <= 2).length;
  return Math.max(0, threats - friends);
}

/** Furthest an opponent could strike from next round: its movement plus its longest reach. */
function threatRange(content: BattleContent, state: BattleState, unit: BattleUnit): number {
  return movementPoints(content, unit, state) + longestReach(content, unit);
}

/** The longest range of the unit's damaging moves, in hex widths (1 = melee only). */
function longestReach(content: BattleContent, unit: BattleUnit): number {
  return Math.max(0, ...unit.moves.map((m) => {
    const mv = content.moves[m]!;
    return mv.power > 0 ? mv.range.max : 0;
  }));
}

/**
 * Worth of a fresh buff on an own-side unit, judged from the position after the action.
 * Defensive buffs count threatening opponents, offensive ones need a target by next turn,
 * speed buffs only help while everything is still out of reach.
 */
function buffValue(content: BattleContent, state: BattleState, unit: BattleUnit, statusId: string, w: AiWeights): number {
  const def = content.statuses[statusId];
  if (!def) return 0;
  const opponents = livingUnits(state).filter((o) => o.side !== unit.side);
  if (opponents.length === 0) return 0;
  const nearest = Math.min(...opponents.map((o) => distance(o.pos, unit.pos)));
  const ownRange = threatRange(content, state, unit);
  let value = 0;
  if (def.damageTaken !== undefined && def.damageTaken < 1) {
    const threats = opponents.filter((o) => distance(o.pos, unit.pos) <= threatRange(content, state, o)).length;
    const lost = 1 - unit.hp / unit.maxHp;
    value += threats * w.guardPerThreat * (1 - def.damageTaken) * (1 + w.guardLowHp * lost);
  }
  if (def.damageDealt !== undefined && def.damageDealt > 1 && nearest <= ownRange) {
    value += w.focusSetup * (def.damageDealt - 1) - w.buffApproach * nearest;
  }
  if (def.movePenalty !== undefined && def.movePenalty < 0 && nearest > ownRange) {
    value += -def.movePenalty * w.hastePerTile - w.buffApproach * nearest;
  }
  return Math.min(w.buffCap, Math.max(0, value));
}
