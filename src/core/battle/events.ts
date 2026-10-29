import type { Point } from "../grid/types";
import type { FreeArea } from "../free/field";
import type { HazardKind } from "./content";
import type { BattleOutcome, Hazard } from "./state";

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
  | { type: "damaged"; unitId: string; amount: number; hp: number; source: "move" | "status" | "impact" | "thorns" | "recoil"; effectiveness?: number }
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
  | { type: "hazardCreated"; hazard: Hazard }
  | { type: "hazardExpired"; hazardId: number; kind: HazardKind }
  /** A unit walked into (or started its turn on) a hazard: followed by its damage or status. */
  | { type: "hazardTouched"; unitId: string; kind: HazardKind }
  /** A delayed strike is marked, or a watch set: nothing is hit yet. */
  | { type: "strikePrepared"; unitId: string; moveId: string; timing: "delayed" | "watch"; area: FreeArea }
  /** A watching unit strikes the foe that moved into its area (followed by the moveUsed). */
  | { type: "watchTriggered"; unitId: string; targetId: string; moveId: string }
  /** A delayed strike or a watch ended without hitting anyone (or its user fell). */
  | { type: "strikeEnded"; unitId: string; moveId: string }
  | { type: "abilityTriggered"; unitId: string; ability: string }
  | { type: "bondChanged"; side: "player" | "enemy"; amount: number; total: number; reason: "spent" | "knockout" | "fainted" | "combo" }
  | { type: "turnEnded"; unitId: string }
  | { type: "battleEnded"; outcome: Exclude<BattleOutcome, "ongoing"> };
