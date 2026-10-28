import { describe, expect, it } from "vitest";
import { CONTENT } from "../src/content";
import { DEMO_BATTLES } from "../src/content/demoBattles";
import { applyAction, createBattle } from "../src/core/battle";

describe("title-screen battles", () => {
  // A rule change can make a recording play out differently: re-record with DEMO=1 (tests/demo.record.test.ts).
  it("every recording still replays to its recorded end", () => {
    for (const [i, b] of DEMO_BATTLES.entries()) {
      let { state } = createBattle(CONTENT, b.field, b.units, { seed: b.seed });
      for (const a of b.actions) state = applyAction(state, CONTENT, a).state;
      expect(state.outcome, `recording ${i}`).toBe(b.outcome);
    }
  });
});
