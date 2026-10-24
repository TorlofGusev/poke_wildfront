import { randomInt, weightedPick } from "../rng";

export interface EncounterEntry {
  readonly speciesId: string;
  readonly weight: number;
  /** At most this many of the species in one group. */
  readonly maxPerGroup?: number;
}

export interface EncounterTable {
  readonly groupSize: { readonly min: number; readonly max: number };
  /** Level range of the wild Pokémon. */
  readonly levels: { readonly min: number; readonly max: number };
  readonly entries: readonly EncounterEntry[];
}

/** Rolls the species of one wild group. Deterministic for a given RNG state. */
export function generateEncounter(
  table: EncounterTable,
  rngState: number,
): { species: string[]; levels: number[]; rngState: number } {
  let state = rngState;
  const size = randomInt(state, table.groupSize.min, table.groupSize.max);
  state = size.state;
  const species: string[] = [];
  const levels: number[] = [];
  for (let i = 0; i < size.value; i++) {
    const allowed = table.entries.filter(
      (e) => e.maxPerGroup === undefined || species.filter((s) => s === e.speciesId).length < e.maxPerGroup,
    );
    if (allowed.length === 0) break;
    const pick = weightedPick(state, allowed, (e) => e.weight);
    state = pick.state;
    species.push(pick.value.speciesId);
    const level = randomInt(state, table.levels.min, table.levels.max);
    state = level.state;
    levels.push(level.value);
  }
  return { species, levels, rngState: state };
}
