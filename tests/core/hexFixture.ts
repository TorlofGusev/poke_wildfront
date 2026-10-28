import {
  applyAction as applyFieldAction,
  createBattle as createFieldBattle,
  type BattleAction,
  type BattleContent,
  type BattleOptions,
  type BattleState,
  type StepResult,
  type UnitSetup,
} from "../../src/core/battle";
import { freeAim, previewFreeMove, type FreeField, type FreeTerrainId } from "../../src/core/free";
import type { Point } from "../../src/core/grid";

/**
 * Rule tests are written on small hex-style ASCII maps ("#" rock, "~" water, '"' bush, "m" mud) with
 * hex coordinates. These helpers lay such a map out as a free field — each tile a hexagon, centres one
 * hex width apart — so neighbours stand 1 apart and the tests keep their meaning on the free field.
 */

const ROW = Math.sqrt(3) / 2;
/** Corner of a hexagon whose flats are one hex width apart. */
const CORNER = 1 / Math.sqrt(3) + 0.01;
const TERRAIN: Readonly<Record<string, FreeTerrainId>> = { "#": "rock", "~": "water", '"': "bush", m: "mud" };
/** The ASCII rows each field was built from, to list aim tiles back in hex coordinates. */
const rowsOf = new WeakMap<FreeField, readonly string[]>();

/** Where a hex tile's centre lies on the field (odd rows shifted half a hex, as on the old hex board). */
export const hexPos = (p: Point): Point => ({ x: p.x + (p.y & 1 ? 0.5 : 0) + 1, y: p.y * ROW + 1.05 });

/** The hex tile nearest a field position. */
export function hexAt(p: Point): Point {
  const y = Math.round((p.y - 1.05) / ROW);
  return { x: Math.round(p.x - 1 - (y & 1 ? 0.5 : 0)), y };
}

/** Hex coordinates come as whole numbers; field positions from hexPos never have a whole y. */
const isHex = (p: Point): boolean => Number.isInteger(p.x) && Number.isInteger(p.y);
const toField = (p: Point): Point => (isHex(p) ? hexPos(p) : p);

export function hexField(rows: readonly string[]): FreeField {
  const zones = [];
  for (let y = 0; y < rows.length; y++)
    for (let x = 0; x < rows[y]!.length; x++) {
      const terrain = TERRAIN[rows[y]![x]!];
      if (!terrain) continue;
      const c = hexPos({ x, y });
      const poly = Array.from({ length: 6 }, (_, i) => {
        const a = Math.PI / 6 + (i * Math.PI) / 3;
        return { x: c.x + Math.cos(a) * CORNER, y: c.y + Math.sin(a) * CORNER };
      });
      zones.push({ terrain, poly });
    }
  const width = Math.max(...rows.map((r) => r.length)) + 1.5;
  const field: FreeField = { width: width + 0.5, height: rows.length * ROW + 1.4, zones };
  rowsOf.set(field, rows);
  return field;
}

/** A battle on an ASCII hex map, units placed by hex coordinates. */
export function createBattle(content: BattleContent, rows: readonly string[], units: readonly UnitSetup[], options: BattleOptions = {}): StepResult {
  return createFieldBattle(content, hexField(rows), units.map((u) => ({ ...u, pos: toField(u.pos) })), options);
}

/** Applies an action whose points may be given as hex tiles. */
export function applyAction(state: BattleState, content: BattleContent, action: BattleAction): StepResult {
  if (action.type === "move") return applyFieldAction(state, content, { ...action, to: toField(action.to) });
  if (action.type === "useMove" || action.type === "throwBall") return applyFieldAction(state, content, { ...action, target: toField(action.target) });
  return applyFieldAction(state, content, action);
}

/** Hex tiles the move could be aimed at right now. */
export function validTargets(state: BattleState, content: BattleContent, unitId: string, moveId: string): Point[] {
  const rows = rowsOf.get(state.field) ?? [];
  const out: Point[] = [];
  for (let y = 0; y < rows.length; y++)
    for (let x = 0; x < rows[y]!.length; x++) if (freeAim(state, content, unitId, moveId, hexPos({ x, y })).ok) out.push({ x, y });
  return out;
}

export function previewMove(state: BattleState, content: BattleContent, unitId: string, moveId: string, target: Point) {
  return previewFreeMove(state, content, unitId, moveId, toField(target));
}

/** Ends turns until it is `unitId`'s (the player side opens every round). */
export function passUntil(state: BattleState, content: BattleContent, unitId: string): BattleState {
  for (let i = 0; state.turn?.unitId !== unitId && i < 20; i++) state = applyAction(state, content, { type: "endTurn", unitId: state.turn!.unitId }).state;
  return state;
}
