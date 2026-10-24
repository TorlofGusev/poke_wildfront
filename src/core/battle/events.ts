import type { Point } from "../grid/types";
import type { BattleOutcome } from "./state";

/** Everything the presentation layer needs to animate what happened, in order. */
export type BattleEvent =
  | { type: "roundStarted"; round: number; order: string[] }
  | { type: "turnStarted"; unitId: string; movePoints: number }
  | { type: "moved"; unitId: string; path: Point[]; cost: number }
  | { type: "moveUsed"; unitId: string; moveId: string; target: Point; affected: string[] }
  | { type: "damaged"; unitId: string; amount: number; hp: number; source: "move" | "status" | "impact"; effectiveness?: number }
  | { type: "healed"; unitId: string; amount: number; hp: number }
  | { type: "displaced"; unitId: string; from: Point; to: Point; blocked: boolean }
  | { type: "statusApplied"; unitId: string; status: string; duration: number }
  | { type: "statusExpired"; unitId: string; status: string }
  | { type: "fainted"; unitId: string }
  | { type: "ballThrown"; unitId: string; targetId: string; ballId: string; chance: number; success: boolean }
  | { type: "captured"; unitId: string }
  | { type: "terrainChanged"; pos: Point; terrain: string }
  | { type: "turnEnded"; unitId: string }
  | { type: "battleEnded"; outcome: Exclude<BattleOutcome, "ongoing"> };
