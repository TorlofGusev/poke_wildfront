import { CONTENT, WORLD, WORLD_CONTENT } from "../content";
import { newWorld } from "../core/expedition";
import type { DeployCandidate } from "../core/battle";
import { newMember, type GameState } from "../core/party";
import { loadSaveFile, SaveError, toSaveFile } from "../core/save";

const SAVE_KEY = "pokemon-wildfront.save";

const STARTERS = ["bulbasaur", "charmander", "squirtle", "pikachu", "geodude", "pidgey"];

const freshWorld = () => newWorld(WORLD_CONTENT, WORLD, Date.now() >>> 0);

export function newGame(): GameState {
  return {
    roster: { party: STARTERS.map((s, i) => newMember(CONTENT, s, i + 1)), storage: [], fallen: [] },
    inventory: { balls: { "poke-ball": 5, "great-ball": 2, "ultra-ball": 1 } },
    nextUid: STARTERS.length + 1,
    world: freshWorld(),
  };
}

/** The running game. Scenes read and replace it; every replacement is autosaved. */
class Session {
  game: GameState = newGame();
  /** Set when an existing save could not be loaded, so the title screen can explain it. */
  loadError: string | null = null;

  hasSave(): boolean {
    try {
      return localStorage.getItem(SAVE_KEY) !== null;
    } catch {
      return false;
    }
  }

  load(): boolean {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      this.game = loadSaveFile(CONTENT, raw, { freshWorld }).game;
      this.loadError = null;
      return true;
    } catch (e) {
      this.loadError = e instanceof SaveError ? e.message : "save could not be read";
      return false;
    }
  }

  update(game: GameState): void {
    this.game = game;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(toSaveFile(game, new Date())));
    } catch {
      // Storage unavailable (private mode, blocked): the game keeps running without saving.
    }
  }

  start(): void {
    this.update(newGame());
  }

  partyCandidates(): DeployCandidate[] {
    return this.game.roster.party.map((m) => ({ id: m.uid, speciesId: m.speciesId, hp: m.hp }));
  }
}

export const session = new Session();
