import type { BattleAction, BattleOutcome, UnitSetup } from "../core/battle";
import type { FreeField } from "../core/free";
import battles from "./demoBattles.json";

/** A recorded AI-against-AI battle, replayed behind the title screen (see tests/demo.record.test.ts). */
export interface DemoBattle {
  readonly field: FreeField;
  readonly units: readonly UnitSetup[];
  readonly seed: number;
  readonly actions: readonly BattleAction[];
  readonly outcome: BattleOutcome;
  /** The arena's biome, for the board's look. */
  readonly style: string;
}

export const DEMO_BATTLES = battles as unknown as readonly DemoBattle[];
