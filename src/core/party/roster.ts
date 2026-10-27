import type { BattleContent } from "../battle/content";
import {
  defaultActiveMoves,
  gainXp,
  memberStats,
  movesKnownAt,
  playstylePoints,
  scaledXp,
  type Progress,
  type ProgressEvent,
  type ProgressionContent,
} from "../progression";
import type { BattleState } from "../battle/state";
import type { WorldState } from "../expedition/world";

export const MAX_PARTY_SIZE = 10;
export const KNOCKOUTS_TO_DEATH = 3;

export interface PartyMember extends Progress {
  readonly uid: string;
  /** Persistent combat knockouts, 0–3. Only remedies or Pokémon Center treatment remove them. */
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
  /** Potions and unequipped held items. */
  readonly items: Readonly<Record<string, number>>;
}

export interface GameState {
  readonly roster: Roster;
  readonly inventory: Inventory;
  /** Counter for unique Pokémon ids. */
  readonly nextUid: number;
  readonly world: WorldState;
  /** Pokédollars. */
  readonly money: number;
  /** EV (Effort): spent at level-ups to make an offered +1 stat a +2. */
  readonly ev?: number;
  /** Species met in battle (the spawn panel names only these). */
  readonly seen?: readonly string[];
  /** Story progress: flags set by NPCs and quests. */
  readonly flags?: readonly string[];
  /** Badges earned, by id (see core/story BADGES). */
  readonly badges?: readonly string[];
  /** Key items: HMs, Poké Flute, Silph Scope, tickets, fossils… */
  readonly keyItems?: readonly string[];
  /** The starter species chosen at the start (rival teams answer it). */
  readonly starter?: string;
}

/** Species the player knows: met in battle, or ever owned. */
export function knownSpecies(game: GameState): Set<string> {
  const { party, storage, fallen } = game.roster;
  return new Set([...(game.seen ?? []), ...[...party, ...storage, ...fallen].map((m) => m.speciesId)]);
}

export function newMember(
  content: BattleContent, prog: ProgressionContent, speciesId: string, uidNumber: number, level: number, hp?: number,
  /** Caught Pokémon: points from earlier levels are left for the player to spend (a stat reset). */
  playerSpendsPoints = false,
): PartyMember {
  const earned = (level - 1) * prog.rules.pointsPerLevel;
  const knownMoves = movesKnownAt(content.species[speciesId]!, level);
  const base: PartyMember = {
    uid: `pk${uidNumber}`, speciesId, level, xp: 0, focus: null, talents: [], heldItem: null, knownMoves,
    activeMoves: defaultActiveMoves(content, prog, speciesId, knownMoves), hp: 0, knockouts: 0,
    // Points from levels it already had are pre-spent along its playstyle; new levels are the player's choice.
    statPoints: playstylePoints(content, speciesId, playerSpendsPoints ? 0 : earned), unspentPoints: playerSpendsPoints ? earned : 0,
  };
  const max = memberMaxHp(content, prog, base);
  return { ...base, hp: Math.min(max, hp ?? max) };
}

export const memberMaxHp = (content: BattleContent, prog: ProgressionContent, m: Progress): number =>
  memberStats(content, prog, m).maxHp;

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
export function restAll(content: BattleContent, prog: ProgressionContent, roster: Roster): Roster {
  const heal = (m: PartyMember) => ({ ...m, hp: memberMaxHp(content, prog, m) });
  return { ...roster, party: roster.party.map(heal), storage: roster.storage.map(heal) };
}

export interface BattleSummary {
  readonly outcome: BattleState["outcome"];
  readonly knockedOut: readonly string[];
  readonly fallen: readonly string[];
  readonly captured: readonly { readonly member: PartyMember; readonly to: "party" | "storage" }[];
  /** XP given to each deployed Pokémon (victory only). */
  readonly xp: number;
  readonly money: number;
  readonly candies: number;
  /** Level-ups, new moves and evolutions, by Pokémon uid. */
  readonly progress: Readonly<Record<string, readonly ProgressEvent[]>>;
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
  prog: ProgressionContent,
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

  // Victory rewards: every deployed Pokémon still in the party gets the full XP, the rest of the party a share (Exp. Share).
  const defeatedLevels = battle.units.filter((u) => u.side === "enemy" && (u.hp <= 0 || u.captured)).reduce((s, u) => s + u.level, 0);
  const won = battle.outcome === "victory";
  const xp = won ? defeatedLevels * prog.rules.xpPerEnemyLevel : 0;
  const money = won ? defeatedLevels * prog.rules.moneyPerEnemyLevel : 0;
  const progress: Record<string, ProgressEvent[]> = {};
  if (xp > 0) {
    const deployed = new Set(battle.units.filter((u) => u.side === "player").map((u) => u.id));
    next = {
      ...next,
      roster: {
        ...next.roster,
        party: next.roster.party.map((m) => {
          const foeLevels = battle.units.filter((u) => u.side === "enemy" && (u.hp <= 0 || u.captured)).map((u) => u.level);
          const full = scaledXp(xp, m.level, foeLevels);
          const gained = deployed.has(m.uid) ? full : Math.floor(full * prog.rules.benchXpShare);
          if (gained <= 0) return m;
          const r = gainXp(content, prog, m, gained);
          progress[m.uid] = r.events;
          return r.member;
        }),
      },
    };
  }
  next = { ...next, money: next.money + money, ev: (next.ev ?? 0) + (won ? prog.rules.ev.wildWin : 0) };
  const candies = won ? prog.rules.candiesPerVictory : 0;
  if (candies) next = { ...next, inventory: { ...next.inventory, items: { ...next.inventory.items, candy: (next.inventory.items.candy ?? 0) + candies } } };

  const captured: { member: PartyMember; to: "party" | "storage" }[] = [];
  for (const u of battle.units.filter((x) => x.captured)) {
    const member = newMember(content, prog, u.speciesId, next.nextUid, u.level, u.hp, true);
    const added = addPokemon({ ...next, nextUid: next.nextUid + 1 }, member);
    next = added.game;
    captured.push({ member, to: added.to });
  }

  if (battle.outcome === "defeat") {
    // Prototype stand-in for "return to the last camp": the party rests there.
    next = { ...next, roster: restAll(content, prog, next.roster) };
  }

  const met = battle.units.filter((u) => u.side === "enemy").map((u) => u.speciesId);
  next = { ...next, seen: [...new Set([...(next.seen ?? []), ...met])] };
  return { game: next, summary: { outcome: battle.outcome, knockedOut, fallen: fallenIds, captured, xp, money, candies, progress } };
}
