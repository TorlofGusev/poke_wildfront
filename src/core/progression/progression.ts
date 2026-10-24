import { hpFromStat } from "../battle/battle";
import type { BaseStats, BattleContent, SpeciesDef } from "../battle/content";
import { STAT_NAMES, type StatName } from "../battle/species";
import { combineModifiers, type UnitModifiers } from "../battle/modifiers";
import type { UnitSetup } from "../battle/battle";
import type { ProgressionContent, TreeNode } from "./content";

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
  /** Stat points the player has spent (added to the species' level-1 stats). */
  readonly statPoints: BaseStats;
  /** Points earned but not yet spent. */
  readonly unspentPoints: number;
}

export const NO_POINTS: BaseStats = { hp: 0, attack: 0, defense: 0, speed: 0 };

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

/** Effective battle stats: species level-1 stats + spent points + talent points. */
export function memberStats(content: BattleContent, prog: ProgressionContent, m: Progress): { stats: BaseStats; maxHp: number } {
  const base = content.species[m.speciesId]!.stats;
  const out = {} as Record<StatName, number>;
  for (const s of STAT_NAMES) {
    const fromTalents = m.talents.reduce((sum, t) => sum + (prog.talents[t]?.stats?.[s] ?? 0), 0);
    out[s] = base[s] + m.statPoints[s] + fromTalents;
  }
  return { stats: out, maxHp: hpFromStat(content, out.hp) };
}

/**
 * Spends points along a species' playstyle: its best stat, second best, then HP, repeating.
 * Used for wild Pokémon and for the points a new Pokémon arrives with.
 */
export function playstylePoints(content: BattleContent, speciesId: string, count: number): BaseStats {
  const base = content.species[speciesId]!.stats;
  const ranked = [...STAT_NAMES].filter((s) => s !== "hp").sort((a, b) => base[b] - base[a]);
  const cycle: StatName[] = [ranked[0]!, ranked[1]!, "hp"];
  const points = { ...NO_POINTS };
  for (let i = 0; i < count; i++) points[cycle[i % cycle.length]!] += 1;
  return points;
}

/** Spends unspent points on a stat. */
export function spendPoints<T extends Progress>(m: T, stat: StatName, amount: number, cost = amount): T {
  if (cost > m.unspentPoints) throw new Error("no stat points left");
  return { ...m, unspentPoints: m.unspentPoints - cost, statPoints: { ...m.statPoints, [stat]: m.statPoints[stat] + amount } };
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
  const points = playstylePoints(content, speciesId, (level - 1) * prog.rules.pointsPerLevel);
  const m: Progress = {
    speciesId, level, xp: 0, role: null, talents: [], heldItem: null, knownMoves: known,
    activeMoves: defaultActiveMoves(content, prog, speciesId, known), hp: Number.MAX_SAFE_INTEGER,
    statPoints: points, unspentPoints: 0,
  };
  return toUnitSetup(content, prog, m);
}

export type ProgressEvent =
  | { type: "levelUp"; level: number }
  | { type: "learned"; move: string; activated: boolean }
  | { type: "evolved"; from: string; into: string };

/**
 * Adds XP, applying level-ups, new moves and evolution. Knockouts, role and talents are kept.
 * HP rises by any max HP gained (evolution), so a level-up never leaves a Pokémon relatively weaker.
 */
export function gainXp<T extends Progress>(content: BattleContent, prog: ProgressionContent, m: T, xp: number): { member: T; events: ProgressEvent[] } {
  const events: ProgressEvent[] = [];
  let cur: T = { ...m, xp: m.xp + xp };
  while (cur.level < prog.rules.maxLevel && cur.xp >= xpToNext(prog, cur.level)) {
    const before = memberStats(content, prog, cur).maxHp;
    cur = { ...cur, xp: cur.xp - xpToNext(prog, cur.level), level: cur.level + 1, unspentPoints: cur.unspentPoints + prog.rules.pointsPerLevel };
    events.push({ type: "levelUp", level: cur.level });
    const evo = content.species[cur.speciesId]!.evolution;
    if (evo && cur.level >= evo.level && content.species[evo.into]) {
      events.push({ type: "evolved", from: cur.speciesId, into: evo.into });
      cur = { ...cur, speciesId: evo.into, unspentPoints: cur.unspentPoints + prog.rules.evolutionPoints };
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

/** Talent points earned by a level. */
export const talentPointsAt = (prog: ProgressionContent, level: number): number => prog.rules.talentLevels.filter((l) => l <= level).length;

/** The choice a member is waiting for, if any. */
export function pendingChoice(prog: ProgressionContent, m: Progress): "role" | "talent" | null {
  if (m.level < prog.rules.roleLevel) return null;
  if (m.role === null) return "role";
  return m.talents.length < talentPointsAt(prog, m.level) ? "talent" : null;
}

export function roleOptions(content: BattleContent, m: Progress): string[] {
  return [...(content.species[m.speciesId]!.roles ?? [])];
}

export function chooseRole<T extends Progress>(content: BattleContent, prog: ProgressionContent, m: T, roleId: string): T {
  if (pendingChoice(prog, m) !== "role") throw new Error("no role choice pending");
  if (!roleOptions(content, m).includes(roleId) || !prog.roles[roleId]) throw new Error(`${m.speciesId} cannot become ${roleId}`);
  return { ...m, role: roleId };
}

/** The talent a tree node stands for: "@type" becomes the talent of the Pokémon's primary type. */
export function nodeTalent(prog: ProgressionContent, node: TreeNode, types: readonly string[]): string | null {
  if (node.talent !== "@type") return node.talent;
  return Object.values(prog.talents).find((t) => t.requiresType === types[0])?.id ?? null;
}

export type NodeState = "learned" | "available" | "locked-level" | "locked-path";

/** State of a tree node for this Pokémon (ignores whether a talent point is free). */
export function nodeState(prog: ProgressionContent, m: Progress, node: TreeNode, types: readonly string[]): NodeState {
  const id = nodeTalent(prog, node, types);
  if (id && m.talents.includes(id)) return "learned";
  if (node.level > m.level) return "locked-level";
  const reqs = node.requires ?? [];
  return reqs.length === 0 || reqs.some((r) => m.talents.includes(r)) ? "available" : "locked-path";
}

/** Talents that can be learned right now (requires a free talent point). */
export function talentOptions(prog: ProgressionContent, m: Progress, types: readonly string[] = []): string[] {
  if (pendingChoice(prog, m) !== "talent" || !m.role) return [];
  return (prog.roles[m.role]?.tree ?? [])
    .filter((n) => nodeState(prog, m, n, types) === "available")
    .map((n) => nodeTalent(prog, n, types))
    .filter((id): id is string => id !== null);
}

export function chooseTalent<T extends Progress>(prog: ProgressionContent, m: T, talentId: string, types: readonly string[] = []): T {
  if (pendingChoice(prog, m) !== "talent") throw new Error("no talent choice pending");
  if (!talentOptions(prog, m, types).includes(talentId)) throw new Error(`talent ${talentId} is not available`);
  const next = { ...m, talents: [...m.talents, talentId] };
  const move = prog.talents[talentId]!.grantsMove;
  if (!move || next.knownMoves.includes(move)) return next;
  // A skill talent teaches a move; it becomes active if there is room.
  const room = next.activeMoves.length < prog.rules.maxActiveMoves;
  return { ...next, knownMoves: [...next.knownMoves, move], activeMoves: room ? [...next.activeMoves, move] : next.activeMoves };
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
