import { livingUnits, moveUnavailableReason, partnerOf, unitById } from "../battle/battle";
import type { BattleContent } from "../battle/content";
import type { BattleState, BattleUnit } from "../battle/state";
import type { Point } from "../grid/types";
import { typeMultiplier } from "../rules/typeChart";
import { distance, MELEE_REACH } from "./field";
import { freeAim, freeRange, freeReachFor, type FreeAction } from "./freeBattle";
import { CELL } from "./pathing";

/**
 * Simple enemy AI for the free-movement prototype. One action at a time: walk once to the spot with the best
 * attacks (melee runs at foes, shooters keep their distance and need a clear line), then attack, then end the turn.
 */

/** Stands are tried on a coarser lattice than the walk itself: every other cell. */
const STAND_STRIDE = 2;
/** A Pokémon that fights from range dislikes ending its walk next to a foe. */
const SHOOTER_CROWDED = 25;
const KO_BONUS = 40;

interface Attack {
  readonly moveId: string;
  readonly target: Point;
  readonly value: number;
}

/** Rough worth of a move on the units it hits: power × type matchup, a bonus for a likely knockout, allies hit count against it. */
function attackValue(content: BattleContent, user: BattleUnit, moveId: string, hit: readonly BattleUnit[]): number {
  const move = content.moves[moveId]!;
  let v = 0;
  for (const u of hit) {
    const eff = typeMultiplier(content.typeChart, move.type, content.species[u.speciesId]!.types);
    const est = (move.power * eff * (user.stats.attack + 20)) / (u.stats.defense + 20) / 4;
    v += (u.side === user.side ? -1 : 1) * (move.power * eff + (est >= u.hp ? KO_BONUS : 0));
  }
  return v;
}

/** The best attack per action slot (basic attack, other move) from the unit's current spot. */
function bestAttacks(state: BattleState, content: BattleContent, user: BattleUnit): { basic?: Attack; action?: Attack } {
  const out: { basic?: Attack; action?: Attack } = {};
  const foes = livingUnits(state).filter((u) => u.side !== user.side);
  for (const moveId of user.moves) {
    const move = content.moves[moveId];
    if (!move || move.power <= 0 || move.affects === "allies" || moveUnavailableReason(state, content, user.id, moveId)) continue;
    const range = freeRange(user, move);
    for (const foe of foes) {
      if (distance(user.pos, foe.pos) > Math.max(range.max, move.shape.kind === "line" ? move.shape.length + 1 : 0) + 1.5) continue;
      const aim = freeAim(state, content, user.id, moveId, foe.pos);
      if (!aim.ok) continue;
      const value = attackValue(content, user, moveId, aim.affected);
      const slot = move.kind === "basic" ? "basic" : "action";
      if (value > 0 && value > (out[slot]?.value ?? 0)) out[slot] = { moveId, target: foe.pos, value };
    }
  }
  return out;
}

const standingAt = (state: BattleState, unitId: string, pos: Point): BattleState =>
  ({ ...state, units: state.units.map((u) => (u.id === unitId ? { ...u, pos } : u)) });

/** Whether the unit's own basic attack is ranged (it would rather shoot than brawl). */
const isShooter = (content: BattleContent, unit: BattleUnit) =>
  unit.moves.some((m) => content.moves[m]?.kind === "basic" && m !== "struggle" && content.moves[m]!.range.max >= 2);

export function planFreeAction(state: BattleState, content: BattleContent): FreeAction {
  const unit = unitById(state, state.turn!.unitId);
  const end: FreeAction = { type: "endTurn", unitId: unit.id };

  // Walk once per turn, unless engaged (it fights its partner where it stands).
  if (!state.turn!.moved && !partnerOf(state, unit) && state.turn!.movePointsLeft > 0) {
    const reach = freeReachFor(state, unit.id);
    const stands = [unit.pos, ...reach.cells.filter((p) => Math.round(p.x / CELL) % STAND_STRIDE === 0 && Math.round(p.y / CELL) % STAND_STRIDE === 0)];
    const foes = livingUnits(state).filter((u) => u.side !== unit.side);
    const shooter = isShooter(content, unit);
    const scored: { pos: Point; score: number }[] = [];
    for (const pos of stands) {
      const there = standingAt(state, unit.id, pos);
      const a = bestAttacks(there, content, unitById(there, unit.id));
      const nearest = Math.min(...foes.map((f) => distance(f.pos, pos)));
      const crowded = foes.filter((f) => distance(f.pos, pos) <= MELEE_REACH).length;
      let score = (a.basic?.value ?? 0) + (a.action?.value ?? 0);
      // Nothing to hit from here: close in.
      if (score === 0) score = -nearest * 10;
      if (shooter) score -= crowded * SHOOTER_CROWDED;
      // Staying put breaks ties: no pointless shuffling.
      if (pos !== unit.pos) score -= 0.5 + distance(pos, unit.pos) * 0.1;
      scored.push({ pos, score });
    }
    // Lattice cells at the edge of the reach may cost a hair too much once walked exactly: take the best that fits.
    const best = scored.sort((a, b) => b.score - a.score).find((c) => c.pos === unit.pos || reach.costTo(c.pos) !== null);
    if (best && best.pos !== unit.pos) return { type: "freeMove", unitId: unit.id, to: best.pos };
  }

  const a = bestAttacks(state, content, unit);
  const pick = [a.action, a.basic].filter((x): x is Attack => !!x).sort((x, y) => y.value - x.value)[0];
  return pick ? { type: "freeUseMove", unitId: unit.id, moveId: pick.moveId, target: pick.target } : end;
}
