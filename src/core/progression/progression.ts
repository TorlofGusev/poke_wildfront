import type { BaseStats, BattleContent, SpeciesDef } from "../battle/content";
import { combineModifiers, type UnitModifiers } from "../battle/modifiers";
import type { UnitSetup } from "../battle/battle";
import type { ProgressionContent } from "./content";

/** The parts of a party member that progression reads and changes. */
export interface Progress {
  readonly speciesId: string;
  readonly level: number;
  readonly xp: number;
  readonly role: string | null;
  readonly talents: readonly string[];
  readonly heldItem: string | null;
  readonly knownMoves: readonly string[];
  /** Active moves besides the basic attack. */
  readonly activeMoves: readonly string[];
  readonly hp: number;
}

export const basicMoveOf = (content: BattleContent, species: SpeciesDef): string => {
  const basic = species.moves.find((m) => content.moves[m]?.kind === "basic");
  if (!basic) throw new Error(`${species.id} has no basic move`);
  return basic;
};

/** Every move a species knows at a level: its starting moves plus its learnset up to that level. */
export function movesKnownAt(species: SpeciesDef, level: number): string[] {
  const learned = (species.learnset ?? []).filter((l) => l.level <= level).map((l) => l.move);
  return [...new Set([...species.moves, ...learned])];
}

/** Default loadout: the most recently learned non-basic moves. */
export function defaultActiveMoves(content: BattleContent, prog: ProgressionContent, speciesId: string, known: readonly string[]): string[] {
  const basic = basicMoveOf(content, content.species[speciesId]!);
  return known.filter((m) => m !== basic).slice(-prog.rules.maxActiveMoves);
}

export const xpToNext = (prog: ProgressionContent, level: number): number => level * prog.rules.xpPerLevel;

/** Effective battle stats: base × level growth × stat talents; Speed talents are flat. */
export function memberStats(content: BattleContent, prog: ProgressionContent, m: Progress): { stats: BaseStats; maxHp: number } {
  const base = content.species[m.speciesId]!.stats;
  const growth = 1 + prog.rules.statGrowth * (m.level - 1);
  const pct = { hp: 0, attack: 0, defense: 0, speed: 0 };
  for (const t of m.talents) {
    const s = prog.talents[t]?.stats;
    if (!s) continue;
    pct.hp += s.hp ?? 0;
    pct.attack += s.attack ?? 0;
    pct.defense += s.defense ?? 0;
    pct.speed += s.speed ?? 0;
  }
  const stats: BaseStats = {
    hp: Math.round(base.hp * growth * (1 + pct.hp)),
    attack: Math.round(base.attack * growth * (1 + pct.attack)),
    defense: Math.round(base.defense * growth * (1 + pct.defense)),
    // Speed decides movement thresholds and turn order, so it grows slowly and talents add flat points.
    speed: Math.round(base.speed * (1 + (growth - 1) / 3) + pct.speed),
  };
  return { stats, maxHp: Math.round(stats.hp * content.rules.hpMultiplier) };
}

export function memberModifiers(prog: ProgressionContent, m: Progress): UnitModifiers {
  const parts: Partial<UnitModifiers>[] = m.talents.map((t) => prog.talents[t]?.mods ?? {});
  if (m.heldItem) parts.push(prog.items[m.heldItem]?.mods ?? {});
  return combineModifiers(...parts);
}

/** What a member brings into battle. */
export function toUnitSetup(content: BattleContent, prog: ProgressionContent, m: Progress): Omit<UnitSetup, "id" | "side" | "pos"> {
  const { stats, maxHp } = memberStats(content, prog, m);
  const basic = basicMoveOf(content, content.species[m.speciesId]!);
  return {
    speciesId: m.speciesId, level: m.level, stats, maxHp, hp: Math.min(m.hp, maxHp),
    moves: [basic, ...m.activeMoves], mods: memberModifiers(prog, m),
  };
}

/** A wild Pokémon of a given level, with its default loadout. */
export function wildSetup(content: BattleContent, prog: ProgressionContent, speciesId: string, level: number): Omit<UnitSetup, "id" | "side" | "pos"> {
  const known = movesKnownAt(content.species[speciesId]!, level);
  const m: Progress = {
    speciesId, level, xp: 0, role: null, talents: [], heldItem: null, knownMoves: known,
    activeMoves: defaultActiveMoves(content, prog, speciesId, known), hp: Number.MAX_SAFE_INTEGER,
  };
  return toUnitSetup(content, prog, m);
}

export type ProgressEvent =
  | { type: "levelUp"; level: number }
  | { type: "learned"; move: string; activated: boolean }
  | { type: "evolved"; from: string; into: string };

/**
 * Adds XP, applying level-ups, new moves and evolution. Knockouts, role and talents are kept.
 * HP rises by the max HP gained, so a level-up never leaves a Pokémon relatively weaker.
 */
export function gainXp<T extends Progress>(content: BattleContent, prog: ProgressionContent, m: T, xp: number): { member: T; events: ProgressEvent[] } {
  const events: ProgressEvent[] = [];
  let cur: T = { ...m, xp: m.xp + xp };
  while (cur.level < prog.rules.maxLevel && cur.xp >= xpToNext(prog, cur.level)) {
    const before = memberStats(content, prog, cur).maxHp;
    cur = { ...cur, xp: cur.xp - xpToNext(prog, cur.level), level: cur.level + 1 };
    events.push({ type: "levelUp", level: cur.level });
    const evo = content.species[cur.speciesId]!.evolution;
    if (evo && cur.level >= evo.level && content.species[evo.into]) {
      events.push({ type: "evolved", from: cur.speciesId, into: evo.into });
      cur = { ...cur, speciesId: evo.into };
    }
    for (const move of movesKnownAt(content.species[cur.speciesId]!, cur.level)) {
      if (cur.knownMoves.includes(move)) continue;
      const basic = basicMoveOf(content, content.species[cur.speciesId]!);
      const activate = move !== basic && cur.activeMoves.length < prog.rules.maxActiveMoves;
      cur = { ...cur, knownMoves: [...cur.knownMoves, move], activeMoves: activate ? [...cur.activeMoves, move] : cur.activeMoves };
      events.push({ type: "learned", move, activated: activate });
    }
    const after = memberStats(content, prog, cur).maxHp;
    if (cur.hp > 0) cur = { ...cur, hp: Math.min(after, cur.hp + Math.max(0, after - before)) };
  }
  if (cur.level >= prog.rules.maxLevel) cur = { ...cur, xp: 0 };
  return { member: cur, events };
}

/** The choice a member is waiting for, if any. */
export function pendingChoice(prog: ProgressionContent, m: Progress): "role" | "talent" | null {
  if (m.level < prog.rules.roleLevel) return null;
  if (m.role === null) return "role";
  return m.talents.length < m.level - prog.rules.roleLevel ? "talent" : null;
}

export function roleOptions(content: BattleContent, m: Progress): string[] {
  return [...(content.species[m.speciesId]!.roles ?? [])];
}

export function chooseRole<T extends Progress>(content: BattleContent, prog: ProgressionContent, m: T, roleId: string): T {
  if (pendingChoice(prog, m) !== "role") throw new Error("no role choice pending");
  if (!roleOptions(content, m).includes(roleId) || !prog.roles[roleId]) throw new Error(`${m.speciesId} cannot become ${roleId}`);
  return { ...m, role: roleId };
}

/** Role talents not yet taken, then the stackable stat talents. */
export function talentOptions(prog: ProgressionContent, m: Progress): string[] {
  const role = m.role ? prog.roles[m.role] : undefined;
  const roleTalents = (role?.talents ?? []).filter((t) => !m.talents.includes(t));
  const statTalents = Object.values(prog.talents).filter((t) => t.stackable).map((t) => t.id);
  return [...roleTalents, ...statTalents];
}

export function chooseTalent<T extends Progress>(prog: ProgressionContent, m: T, talentId: string): T {
  if (pendingChoice(prog, m) !== "talent") throw new Error("no talent choice pending");
  if (!talentOptions(prog, m).includes(talentId)) throw new Error(`talent ${talentId} is not available`);
  return { ...m, talents: [...m.talents, talentId] };
}

/** Sets the active moves (besides the basic attack). */
export function setActiveMoves<T extends Progress>(content: BattleContent, prog: ProgressionContent, m: T, moves: readonly string[]): T {
  const basic = basicMoveOf(content, content.species[m.speciesId]!);
  if (moves.length > prog.rules.maxActiveMoves) throw new Error(`at most ${prog.rules.maxActiveMoves} moves besides ${basic}`);
  if (new Set(moves).size !== moves.length) throw new Error("a move is listed twice");
  for (const mv of moves) {
    if (!m.knownMoves.includes(mv)) throw new Error(`${m.speciesId} does not know ${mv}`);
    if (mv === basic) throw new Error("the basic attack is always active");
  }
  return { ...m, activeMoves: [...moves] };
}
