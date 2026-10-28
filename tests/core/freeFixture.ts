import { createBattle, type StepResult, type UnitSetup } from "../../src/core/battle/battle";
import type { BattleContent } from "../../src/core/battle/content";
import type { FreeField } from "../../src/core/free/field";

/**
 * The hand-made prototype arena: a rock ridge splits it, with a quick but narrow pass at the top
 * and a wide, slow swamp below; bushes give cover on both sides.
 */
export const PROTO_FIELD: FreeField = {
  width: 16,
  height: 11,
  zones: [
    { terrain: "mud", poly: [{ x: 5, y: 7 }, { x: 11, y: 6.8 }, { x: 11.6, y: 10.4 }, { x: 10, y: 11 }, { x: 5.6, y: 11 }, { x: 4.6, y: 9 }] },
    { terrain: "water", poly: [{ x: 6.2, y: 7.8 }, { x: 9.8, y: 7.4 }, { x: 10.4, y: 9.6 }, { x: 9, y: 10.6 }, { x: 6.6, y: 10.4 }, { x: 5.8, y: 9.2 }] },
    { terrain: "bush", poly: [{ x: 3, y: 1.5 }, { x: 4.6, y: 1.2 }, { x: 5, y: 2.6 }, { x: 3.8, y: 3.2 }, { x: 2.8, y: 2.6 }] },
    { terrain: "bush", poly: [{ x: 11, y: 3.8 }, { x: 12.6, y: 3.6 }, { x: 13, y: 5 }, { x: 11.6, y: 5.4 }] },
    { terrain: "bush", poly: [{ x: 2.5, y: 8 }, { x: 3.6, y: 7.8 }, { x: 3.8, y: 9 }, { x: 2.6, y: 9.2 }] },
    { terrain: "rock", poly: [{ x: 7.2, y: 0 }, { x: 8.6, y: 0 }, { x: 8.8, y: 2.6 }, { x: 7.6, y: 3.2 }, { x: 7, y: 2 }] },
    { terrain: "rock", poly: [{ x: 7.4, y: 4.6 }, { x: 8.6, y: 4.3 }, { x: 8.9, y: 5.8 }, { x: 8, y: 6.6 }, { x: 7.2, y: 6 }] },
    { terrain: "rock", poly: [{ x: 12, y: 8 }, { x: 12.8, y: 7.8 }, { x: 13, y: 8.8 }, { x: 12.2, y: 9 }] },
  ],
};

export const PROTO_UNITS: readonly UnitSetup[] = [
  { id: "p1", speciesId: "charmander", side: "player", pos: { x: 4, y: 4.2 } },
  { id: "p2", speciesId: "squirtle", side: "player", pos: { x: 3.8, y: 5.8 } },
  { id: "p3", speciesId: "bulbasaur", side: "player", pos: { x: 3.4, y: 7.2 } },
  { id: "e1", speciesId: "geodude", side: "enemy", pos: { x: 12.2, y: 2.6 } },
  { id: "e2", speciesId: "rattata", side: "enemy", pos: { x: 13.4, y: 5.9 } },
  { id: "e3", speciesId: "pidgey", side: "enemy", pos: { x: 12.4, y: 7 } },
];

/** A fresh prototype battle on the hand-made arena. */
export const createFreeBattle = (content: BattleContent): StepResult =>
  createBattle(content, PROTO_FIELD, PROTO_UNITS, { seed: 1 });
