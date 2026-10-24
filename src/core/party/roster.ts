import { maxHpOf } from "../battle/battle";
import type { BattleContent } from "../battle/content";
import type { BattleState } from "../battle/state";

export const MAX_PARTY_SIZE = 6;
export const KNOCKOUTS_TO_DEATH = 3;

export interface PartyMember {
  readonly uid: string;
  readonly speciesId: string;
  readonly hp: number;
  /** Persistent combat knockouts, 0–3. Never reset by healing, resting or evolution. */
  readonly knockouts: number;
}

export interface Roster {
  /** Max 6; the only Pokémon that can be deployed. */
  readonly party: readonly PartyMember[];
  /** Unlimited PC box. */
  readonly storage: readonly PartyMember[];
  /** Permanently lost (3/3 knockouts). */
  readonly fallen: readonly PartyMember[];
}

export interface Inventory {
  readonly balls: Readonly<Record<string, number>>;
}

export interface GameState {
  readonly roster: Roster;
  readonly inventory: Inventory;
  /** Counter for unique Pokémon ids. */
  readonly nextUid: number;
}

export function newMember(content: BattleContent, speciesId: string, uidNumber: number, hp?: number): PartyMember {
  return { uid: `pk${uidNumber}`, speciesId, hp: hp ?? maxHpOf(content, speciesId), knockouts: 0 };
}

/** Adds a Pokémon to the party, or to storage when the party is full. */
export function addPokemon(game: GameState, member: PartyMember): { game: GameState; to: "party" | "storage" } {
  const { roster } = game;
  const to = roster.party.length < MAX_PARTY_SIZE ? "party" : "storage";
  const next: Roster = to === "party"
    ? { ...roster, party: [...roster.party, member] }
    : { ...roster, storage: [...roster.storage, member] };
  return { game: { ...game, roster: next }, to };
}

/** Moves a Pokémon between party and storage. Throws when the party would exceed 6 or become empty. */
export function moveBetweenPartyAndStorage(roster: Roster, uid: string): Roster {
  const inParty = roster.party.find((m) => m.uid === uid);
  if (inParty) {
    if (roster.party.length === 1) throw new Error("the party needs at least one Pokémon");
    return { ...roster, party: roster.party.filter((m) => m !== inParty), storage: [...roster.storage, inParty] };
  }
  const inStorage = roster.storage.find((m) => m.uid === uid);
  if (!inStorage) throw new Error(`${uid} is not in party or storage`);
  if (roster.party.length >= MAX_PARTY_SIZE) throw new Error(`the party is full (${MAX_PARTY_SIZE})`);
  return { ...roster, storage: roster.storage.filter((m) => m !== inStorage), party: [...roster.party, inStorage] };
}

/** Full rest: restores HP of every living Pokémon. Knockout counters are untouched. */
export function restAll(content: BattleContent, roster: Roster): Roster {
  const heal = (m: PartyMember) => ({ ...m, hp: maxHpOf(content, m.speciesId) });
  return { ...roster, party: roster.party.map(heal), storage: roster.storage.map(heal) };
}

export interface BattleSummary {
  readonly outcome: BattleState["outcome"];
  readonly knockedOut: readonly string[];
  readonly fallen: readonly string[];
  readonly captured: readonly { readonly member: PartyMember; readonly to: "party" | "storage" }[];
}

export interface ResolveOptions {
  /** Scripted battles may disable knockout counting. */
  readonly countsKnockouts?: boolean;
}

/**
 * Applies a finished battle to the game: HP, knockout counters, permanent death,
 * captured Pokémon and consumed balls. Player battle units must use party uids as ids.
 */
export function resolveBattle(
  content: BattleContent,
  game: GameState,
  battle: BattleState,
  options: ResolveOptions = {},
): { game: GameState; summary: BattleSummary } {
  if (battle.outcome === "ongoing") throw new Error("battle is not finished");
  const countsKnockouts = options.countsKnockouts ?? true;
  const knockedOut: string[] = [];
  const fallenIds: string[] = [];

  const update = (m: PartyMember): PartyMember => {
    const unit = battle.units.find((u) => u.side === "player" && u.id === m.uid);
    if (!unit) return m;
    const ko = unit.hp <= 0;
    if (ko) knockedOut.push(m.uid);
    const knockouts = ko && countsKnockouts ? Math.min(KNOCKOUTS_TO_DEATH, m.knockouts + 1) : m.knockouts;
    if (knockouts >= KNOCKOUTS_TO_DEATH) fallenIds.push(m.uid);
    return { ...m, hp: unit.hp, knockouts };
  };

  const party = game.roster.party.map(update);
  let next: GameState = {
    ...game,
    roster: {
      party: party.filter((m) => !fallenIds.includes(m.uid)),
      storage: game.roster.storage,
      fallen: [...game.roster.fallen, ...party.filter((m) => fallenIds.includes(m.uid)).map((m) => ({ ...m, hp: 0 }))],
    },
    inventory: { ...game.inventory, balls: { ...battle.balls } },
  };

  const captured: { member: PartyMember; to: "party" | "storage" }[] = [];
  for (const u of battle.units.filter((x) => x.captured)) {
    const member = newMember(content, u.speciesId, next.nextUid, u.hp);
    const added = addPokemon({ ...next, nextUid: next.nextUid + 1 }, member);
    next = added.game;
    captured.push({ member, to: added.to });
  }

  if (battle.outcome === "defeat") {
    // Prototype stand-in for "return to the last camp": the party rests there.
    next = { ...next, roster: restAll(content, next.roster) };
  }

  return { game: next, summary: { outcome: battle.outcome, knockedOut, fallen: fallenIds, captured } };
}
