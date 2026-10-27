import { CONTENT, PROGRESSION, WORLD, WORLD_CONTENT, WORLDS } from "../content";
import type { WorldDef } from "../core/expedition";
import { toUnitSetup } from "../core/progression";
import { newWorld } from "../core/expedition";
import type { DeployCandidate } from "../core/battle";
import { newMember, type GameState } from "../core/party";
import { loadSaveFile, SaveError, toSaveFile } from "../core/save";
import { t } from "./i18n";

const SAVE_KEY = "pokemon-wildfront.save";

/** The classic choice of one, plus Pikachu. */
export const STARTERS = ["bulbasaur", "charmander", "squirtle", "pikachu"];
/** Fixed team for quick playtesting. */
export const PLAYTEST_TEAM = ["bulbasaur", "charmander", "squirtle", "pikachu", "geodude", "pidgey"];

/** Starters begin at level 1; the role choice unlocks at the role level. */
const STARTING_LEVEL = 1;

const freshWorld = () => newWorld(WORLD_CONTENT, WORLD, Date.now() >>> 0);

export function newGame(team: readonly string[] = PLAYTEST_TEAM): GameState {
  return {
    roster: { party: team.map((s, i) => newMember(CONTENT, PROGRESSION, s, i + 1, STARTING_LEVEL)), storage: [], fallen: [] },
    inventory: { balls: { "poke-ball": 5, "great-ball": 2, "ultra-ball": 1 }, items: { potion: 2, candy: 1, "oran-berry": 4, "cheri-berry": 2, "pecha-berry": 2 } },
    nextUid: team.length + 1,
    world: freshWorld(),
    money: 500,
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
      this.game = loadSaveFile(CONTENT, raw).game;
      this.loadError = null;
      return true;
    } catch (e) {
      // Prototype policy: incompatible or broken saves are discarded, the player starts fresh.
      this.loadError = t("{reason}; it was discarded", { reason: e instanceof SaveError ? e.message : t("save could not be read") });
      try {
        localStorage.removeItem(SAVE_KEY);
      } catch {
        // ignore
      }
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

  start(team: readonly string[]): void {
    // A single chosen starter is remembered: the rival picks its counter.
    this.update({ ...newGame(team), ...(team.length === 1 && { starter: team[0] }) });
  }

  partyCandidates(): DeployCandidate[] {
    return this.game.roster.party.map((m) => {
      const { speciesId: _s, hp: _h, ...setup } = toUnitSetup(CONTENT, PROGRESSION, m);
      return { id: m.uid, speciesId: m.speciesId, hp: m.hp, setup };
    });
  }
}

export const session = new Session();

/** The map the party is currently on. */
export const currentWorld = (): WorldDef => WORLDS[session.game.world.mapId] ?? WORLD;
