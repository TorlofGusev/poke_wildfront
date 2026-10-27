import { CONTENT, PROGRESSION } from "../src/content";
import { planTurn, type AiWeights } from "../src/core/ai";
import { applyAction, createBattle, STAT_NAMES, type BattleState, type UnitSetup } from "../src/core/battle";
import { hexDistance } from "../src/core/grid/hex";
import { newMember, type PartyMember } from "../src/core/party";
import { chooseFocus, chooseTalent, defaultActiveMoves, focusOptions, gainXp, memberStats, pendingChoice, statOffer, takeOffer, talentOptions, teamBond, xpToNext } from "../src/core/progression";

/** AI-vs-AI battle helpers shared by the report tests (not pass/fail tests). */
// Mirror-symmetric arena and start positions, so neither side has a terrain advantage.
export const HALF = ["......", "..\"\"..", ".....#", "..##..", "......", "....\"\"", ".#....", "......"];
export const arena = HALF.map((row) => row + [...row].reverse().join(""));
export const START = [{ x: 1, y: 1 }, { x: 1, y: 3 }, { x: 1, y: 5 }];
export const STARTERS = ["bulbasaur", "charmander", "squirtle", "pikachu", "geodude", "pidgey", "rattata", "zubat", "oddish", "mankey", "weedle", "spearow", "diglett", "caterpie"];

export type Pick = (options: readonly string[], seed: number) => string;
export const firstPick: Pick = (o) => o[0]!;
export const seededPick: Pick = (o, seed) => o[seed % o.length]!;

/** Makes every pending choice: focus, masteries, stat points along the species' best stats. */
export function develop(m: PartyMember, pick: Pick, seed: number, candies = { n: 0 }): PartyMember {
  let cur = m;
  for (let guard = 0; guard < 50; guard++) {
    const p = pendingChoice(CONTENT, PROGRESSION, cur);
    if (p === "focus") {
      const skills = focusOptions(PROGRESSION, cur.speciesId).map((f) => f.skill);
      cur = chooseFocus(CONTENT, PROGRESSION, cur, pick(skills, seed));
    } else if (p === "talent") {
      const opts = talentOptions(CONTENT, PROGRESSION, cur);
      if (!opts.length) throw new Error(`${cur.speciesId} L${cur.level}: talent pending but no options`);
      cur = chooseTalent(CONTENT, PROGRESSION, cur, pick(opts, seed + guard));
    } else break;
  }
  const base = CONTENT.species[cur.speciesId]!.stats;
  // A sensible player: the focus stat, then the better of Attack / Defense, then HP.
  const best = [cur.focus ?? "attack", ...(["attack", "defense"] as const).filter((s) => s !== cur.focus).sort((a, b) => base[b] - base[a])];
  for (let i = 0; cur.unspentPoints > 0; i++) {
    const want = [best[0]!, "hp", best[1]!][i % 3]!;
    const offer = statOffer(CONTENT, PROGRESSION, cur);
    cur = takeOffer(CONTENT, PROGRESSION, cur, (offer.find((o) => o.stat === want) ?? offer[0]!).stat);
  }
  // A sensible player swaps in the best loadout of what it knows.
  return { ...cur, activeMoves: defaultActiveMoves(CONTENT, PROGRESSION, cur.speciesId, cur.knownMoves) };
}

/**
 * The held item a sensible player gives this Pokémon: a booster for its main type if the Mart sells one,
 * else Muscle Band. `owned` limits it to what the team can afford.
 */
export function bestHeldItem(speciesId: string): string {
  const type = CONTENT.species[speciesId]!.types[0]!;
  const typed = Object.values(PROGRESSION.items).find((i) => i.kind === "held" && i.mods?.typeDamage?.[type]);
  return typed?.id ?? "muscle-band";
}
export const withItem = (m: PartyMember): PartyMember => ({ ...m, heldItem: bestHeldItem(m.speciesId) });

/** A Pokémon raised from level 1 to `level` through XP (so it evolves), developing at every level. */
export function raise(species: string, level: number, pick: Pick, seed: number): PartyMember {
  let m = develop(newMember(CONTENT, PROGRESSION, species, seed, 1), pick, seed);
  while (m.level < level) {
    m = gainXp(CONTENT, PROGRESSION, m, xpToNext(PROGRESSION, m.level) - m.xp).member;
    m = develop(m, pick, seed);
  }
  const max = memberStats(CONTENT, PROGRESSION, m).maxHp;
  // A player swaps in newly learned moves when the loadout is full; the default loadout (latest learned) stands in for that.
  return withItem({ ...m, hp: max, activeMoves: defaultActiveMoves(CONTENT, PROGRESSION, m.speciesId, m.knownMoves) });
}

/** A team's starting and maximum Bond from its members' team masteries (Leader…), as in a real battle. */
export type Bond = { readonly start: number; readonly max: number };
export const bondOf = (members: readonly PartyMember[]): Bond => teamBond(CONTENT, PROGRESSION, members);

/**
 * Per-unit battle diagnostics, tallied from the battle events (reset by the reports that read them):
 * damage dealt and taken by source, actions, free strikes, type effectiveness of its hits, knockouts.
 */
export interface UnitLog {
  battles: number; turns: number; roundsAlive: number; fainted: number;
  dealt: number; taken: number; strikesDealt: number; strikesTaken: number; strikeDamageTaken: number;
  basic: number; special: number; bond: number; idleTurns: number; idleStill: number; idleDist: number; moved: number;
  hitsResisted: number; hitsNeutral: number; hitsSuper: number; knockouts: number; firstHitRound: number; combos: number;
}
export const logs = new Map<string, UnitLog>();
const emptyLog = (): UnitLog => ({ battles: 0, turns: 0, roundsAlive: 0, fainted: 0, dealt: 0, taken: 0, strikesDealt: 0, strikesTaken: 0, strikeDamageTaken: 0,
  basic: 0, special: 0, bond: 0, idleTurns: 0, idleStill: 0, idleDist: 0, moved: 0, hitsResisted: 0, hitsNeutral: 0, hitsSuper: 0, knockouts: 0, firstHitRound: 0, combos: 0 });
/** Set to a key function to collect logs (e.g. by species line); null turns logging off. */
export const logging: { key: ((unit: { id: string; speciesId: string; side: string }) => string | null) | null; aSide: "player" | "enemy" } = { key: null, aSide: "player" };

function tally(state: BattleState, events: readonly { type: string; [k: string]: unknown }[], first: Map<string, number>, acted: Set<string>, faint: Map<string, number>) {
  const key = (id: string) => { const u = state.units.find((x) => x.id === id); return u && logging.key ? logging.key(u) : null; };
  const log = (id: string) => { const k = key(id); if (!k) return null; if (!logs.has(k)) logs.set(k, emptyLog()); return logs.get(k)!; };
  let actor: string | null = null;
  let strike = false;
  for (const e of events) {
    if (e.type === "moveUsed") {
      // A free strike emits its own moveUsed right after engagementStrike: not the striker's turn action.
      if (strike && actor === e.unitId) continue;
      actor = e.unitId as string; strike = false; acted.add(actor);
      const kind = CONTENT.moves[e.moveId as string]?.kind;
      const l = log(actor); if (l) { if (kind === "basic") l.basic++; else if (kind === "bond") l.bond++; else l.special++; }
    } else if (e.type === "engagementStrike") {
      actor = e.unitId as string; strike = true;
      const l = log(actor); if (l) l.strikesDealt++;
      const t = log(e.targetId as string); if (t) t.strikesTaken++;
    } else if (e.type === "moved") { const l = log(e.unitId as string); if (l) l.moved++; actor = null; }
    else if (e.type === "turnStarted") { actor = null; const l = log(e.unitId as string); if (l) l.turns++; }
    else if (e.type === "combo") { const l = log(e.unitId as string); if (l) l.combos++; }
    else if (e.type === "damaged") {
      const amount = e.amount as number;
      const t = log(e.unitId as string); if (t) { t.taken += amount; if (strike) t.strikeDamageTaken += amount; }
      if (e.source === "move" && actor && actor !== e.unitId) {
        const l = log(actor);
        if (l) {
          l.dealt += amount;
          const eff = (e.effectiveness as number | undefined) ?? 1;
          if (eff < 1) l.hitsResisted++; else if (eff > 1) l.hitsSuper++; else l.hitsNeutral++;
          if (!first.has(actor)) { first.set(actor, state.round); l.firstHitRound += state.round; }
        }
      }
    } else if (e.type === "fainted") {
      const t = log(e.unitId as string); if (t) t.fainted++;
      faint.set(e.unitId as string, state.round);
      if (actor && actor !== e.unitId) { const l = log(actor); if (l) l.knockouts++; }
    }
  }
}

/** Combo events tallied across battles, by side (reset by the sections that report them). */
export const combos = { player: 0, enemy: 0 };

/** `foeAi` drives the team listed second (the wild side), whichever side it plays. */
export function battle(players: Omit<UnitSetup, "id" | "side" | "pos">[], enemies: Omit<UnitSetup, "id" | "side" | "pos">[], seed: number, ai: { player?: AiWeights; enemy?: AiWeights } = {}, bond: { player?: Bond; enemy?: Bond } = {}) {
  const units: UnitSetup[] = [
    ...players.map((p, i) => ({ ...p, id: `p${i}`, side: "player" as const, pos: START[i]! })),
    ...enemies.map((e, i) => ({ ...e, id: `e${i}`, side: "enemy" as const, pos: { x: arena[0]!.length - 1 - START[i]!.x, y: START[(i + seed) % 3]!.y } })),
  ];
  let { state } = createBattle(CONTENT, arena, units, { bond });
  const first = new Map<string, number>();
  const faint = new Map<string, number>();
  for (let i = 0; i < 600 && state.outcome === "ongoing"; i++) {
    const acted = new Set<string>();
    const mover = state.turn?.unitId;
    let movedThisTurn = false;
    for (const a of planTurn(state, CONTENT, (state.turn?.unitId.startsWith("p") ? ai.player : ai.enemy))) if (state.outcome === "ongoing") {
      const r = applyAction(state, CONTENT, a);
      for (const e of r.events) if (e.type === "combo") combos[e.unitId.startsWith("p") ? "player" : "enemy"]++;
      if (r.events.some((e) => e.type === "moved" && e.unitId === mover)) movedThisTurn = true;
      if (logging.key) tally(r.state, r.events as never, first, acted, faint);
      state = r.state;
    }
    if (logging.key && mover && !acted.has(mover)) {
      const u = state.units.find((x) => x.id === mover); const k = u && logging.key(u);
      if (k) {
        if (!logs.has(k)) logs.set(k, emptyLog());
        const l = logs.get(k)!; l.idleTurns++;
        if (!movedThisTurn) l.idleStill++;
        const foes = state.units.filter((x) => x.side !== u.side && x.hp > 0);
        if (u.hp > 0 && foes.length) l.idleDist += Math.min(...foes.map((f) => hexDistance(f.pos, u.pos)));
      }
    }
  }
  if (logging.key) for (const u of state.units) {
    const k = logging.key(u); if (!k) continue;
    if (!logs.has(k)) logs.set(k, emptyLog());
    const l = logs.get(k)!; l.battles++; l.roundsAlive += u.hp > 0 ? state.round : (faint.get(u.id) ?? state.round);
  }
  return state;
}

/**
 * Team A vs team B, played twice with sides swapped (the side that moves first tends to walk into
 * the other's range, so one game alone is biased). `win` is A's share of the two games.
 */
export function fight(a: Omit<UnitSetup, "id" | "side" | "pos">[], b: Omit<UnitSetup, "id" | "side" | "pos">[], seed: number, bAi?: AiWeights, bond: { a?: Bond; b?: Bond } = {}) {
  logging.aSide = "player";
  const g1 = battle(a, b, seed, { enemy: bAi }, { player: bond.a, enemy: bond.b });
  logging.aSide = "enemy";
  const g2 = battle(b, a, seed, { player: bAi }, { player: bond.b, enemy: bond.a });
  const hpShare = (st: BattleState, side: "player" | "enemy") => {
    const us = st.units.filter((u) => u.side === side);
    return us.reduce((s, u) => s + u.hp, 0) / us.reduce((s, u) => s + u.maxHp, 0);
  };
  const win = ((g1.outcome === "victory" ? 1 : 0) + (g2.outcome === "defeat" ? 1 : 0)) / 2;
  return {
    win, outcome: win >= 0.5 ? "victory" : "defeat", rounds: (g1.round + g2.round) / 2,
    alive: g1.units.filter((u) => u.side === "player" && u.hp > 0).length,
    hpLeft: (hpShare(g1, "player") + hpShare(g2, "enemy")) / 2,
    timeouts: (g1.outcome === "ongoing" ? 1 : 0) + (g2.outcome === "ongoing" ? 1 : 0),
  };
}

export const pct = (x: number) => `${Math.round(x * 100)}%`;
