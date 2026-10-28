import type { Point } from "../grid/types";
import type { BattleOutcome } from "./state";

/** Everything the presentation layer needs to animate what happened, in order. */
export type BattleEvent =
  | { type: "roundStarted"; round: number; order: string[] }
  | { type: "turnStarted"; unitId: string; movePoints: number }
  | { type: "moved"; unitId: string; path: Point[]; cost: number }
  | { type: "moveUsed"; unitId: string; moveId: string; target: Point; affected: string[] }
  /** A unit strikes its engaged partner stepping away from it (followed by that strike's moveUsed and damage). */
  | { type: "engagementStrike"; unitId: string; targetId: string }
  | { type: "engaged"; unitId: string; targetId: string }
  /** A hit exploited an ally's setup (engagement or status): the team gains Bond. */
  /** A named combo (rules.combos): the hit exploited an ally's engagement or status. */
  | { type: "combo"; unitId: string; targetId: string; combo: string }
  | { type: "disengaged"; unitId: string; targetId: string }
  | { type: "damaged"; unitId: string; amount: number; hp: number; source: "move" | "status" | "impact" | "thorns"; effectiveness?: number }
  | { type: "healed"; unitId: string; amount: number; hp: number }
  /** Pushed or pulled; `engage` marks an engaged pair stepping together (not a knockback). */
  | { type: "displaced"; unitId: string; from: Point; to: Point; blocked: boolean; engage?: true }
  | { type: "statusApplied"; unitId: string; status: string; duration: number }
  | { type: "statusExpired"; unitId: string; status: string }
  /** Willpower shrugged off a status a foe tried to inflict. */
  | { type: "statusResisted"; unitId: string; status: string }
  /** A critical hit (followed by its damaged event). */
  | { type: "critical"; unitId: string; targetId: string }
  | { type: "fainted"; unitId: string }
  | { type: "ballThrown"; unitId: string; targetId: string; ballId: string; chance: number; success: boolean }
  | { type: "captured"; unitId: string }
  | { type: "terrainChanged"; pos: Point; terrain: string }
  | { type: "abilityTriggered"; unitId: string; ability: string }
  | { type: "bondChanged"; side: "player" | "enemy"; amount: number; total: number; reason: "spent" | "knockout" | "fainted" | "combo" }
  | { type: "turnEnded"; unitId: string }
  | { type: "battleEnded"; outcome: Exclude<BattleOutcome, "ongoing"> };
