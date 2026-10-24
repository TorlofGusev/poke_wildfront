import type { BattleContent } from "../battle/content";
import type { WorldState } from "../expedition/world";
import { KNOCKOUTS_TO_DEATH, MAX_PARTY_SIZE, type GameState, type PartyMember } from "../party/roster";

export const SAVE_VERSION = 2;

export interface SaveFile {
  readonly version: number;
  readonly savedAt: string;
  readonly game: GameState;
}

export function toSaveFile(game: GameState, now: Date): SaveFile {
  return { version: SAVE_VERSION, savedAt: now.toISOString(), game };
}

type RawSave = { version: number } & Record<string, unknown>;

export interface MigrationContext {
  /** A fresh overworld state for saves made before the overworld existed. */
  readonly freshWorld: () => WorldState;
}

/** One function per version step: MIGRATIONS[n] turns a version-n save into version n+1. */
const MIGRATIONS: Record<number, (save: RawSave, ctx: MigrationContext) => RawSave> = {
  // v1 (Phase 3) had no overworld: start the expedition fresh, keep party, storage, knockouts and bag.
  1: (save, ctx) => ({ ...save, version: 2, game: { ...(save.game as object), world: ctx.freshWorld() } }),
};

export class SaveError extends Error {}

/** Parses, migrates and validates a save. Throws SaveError with a readable message. */
export function loadSaveFile(content: BattleContent, json: string, ctx: MigrationContext): SaveFile {
  let data: RawSave;
  try {
    data = JSON.parse(json);
  } catch {
    throw new SaveError("save data is not valid JSON");
  }
  if (typeof data?.version !== "number") throw new SaveError("save data has no version");
  if (data.version > SAVE_VERSION) throw new SaveError(`save is from a newer game version (${data.version})`);
  while (data.version < SAVE_VERSION) {
    const step = MIGRATIONS[data.version];
    if (!step) throw new SaveError(`no migration from save version ${data.version}`);
    data = step(data, ctx);
  }
  const save = data as unknown as SaveFile;
  validateGame(content, save.game);
  return save;
}

function validateGame(content: BattleContent, game: GameState): void {
  const fail = (msg: string): never => {
    throw new SaveError(`invalid save: ${msg}`);
  };
  if (!game?.roster || !game.inventory) fail("missing roster or inventory");
  const { party, storage, fallen } = game.roster;
  if (!Array.isArray(party) || !Array.isArray(storage) || !Array.isArray(fallen)) fail("roster lists missing");
  if (party.length === 0 && storage.length === 0) fail("no living Pokémon");
  if (party.length > MAX_PARTY_SIZE) fail(`party has ${party.length} Pokémon (max ${MAX_PARTY_SIZE})`);
  const seen = new Set<string>();
  const check = (m: PartyMember, where: string) => {
    if (seen.has(m.uid)) fail(`duplicate Pokémon id ${m.uid}`);
    seen.add(m.uid);
    if (!content.species[m.speciesId]) fail(`unknown species ${m.speciesId}`);
    if (!Number.isInteger(m.knockouts) || m.knockouts < 0 || m.knockouts > KNOCKOUTS_TO_DEATH) fail(`bad knockout count for ${m.uid}`);
    if (where !== "fallen" && m.knockouts >= KNOCKOUTS_TO_DEATH) fail(`${m.uid} has 3 knockouts but is not fallen`);
    if (where === "fallen" && m.knockouts < KNOCKOUTS_TO_DEATH) fail(`${m.uid} is fallen without 3 knockouts`);
    if (typeof m.hp !== "number" || m.hp < 0) fail(`bad HP for ${m.uid}`);
  };
  party.forEach((m) => check(m, "party"));
  storage.forEach((m) => check(m, "storage"));
  fallen.forEach((m) => check(m, "fallen"));
  const w = game.world;
  if (!w || typeof w.fatigue !== "number" || w.fatigue < 0 || !w.pos || !Array.isArray(w.encounters)) fail("missing or invalid world state");
  for (const [id, n] of Object.entries(game.inventory.balls ?? {})) {
    if (!content.balls[id]) fail(`unknown ball ${id}`);
    if (!Number.isInteger(n) || n < 0) fail(`bad ball count for ${id}`);
  }
}
