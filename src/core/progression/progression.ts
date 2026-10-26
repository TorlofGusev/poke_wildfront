import { maxHpAt } from "../battle/battle";
import type { BaseStats, BattleContent, SpeciesDef } from "../battle/content";
import { STAT_NAMES, type StatName } from "../battle/species";
import { combineModifiers, type UnitModifiers } from "../battle/modifiers";
import type { UnitSetup } from "../battle/battle";
import type { ProgressionContent, TalentDef, TreeNode } from "./content";

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

export const NO_POINTS: BaseStats = { hp: 0, attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0 };

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

/**
 * XP scaled by level gap (as in Gen 5): a Pokémon above the foes' average level gets 30% less per level of gap
 * (at least 10%), one below them 10% more per level (at most +50%). Keeps the team near the area's level.
 */
export function scaledXp(base: number, memberLevel: number, foeLevels: readonly number[]): number {
  if (!foeLevels.length || base <= 0) return base;
  const gap = memberLevel - foeLevels.reduce((s, l) => s + l, 0) / foeLevels.length;
  const factor = gap > 0 ? Math.max(0.1, 1 - 0.3 * gap) : Math.min(1.5, 1 - 0.1 * gap);
  return Math.max(1, Math.round(base * factor));
}

/** Stats a role adds automatically by a level. */
export function roleGrowth(prog: ProgressionContent, roleId: string | null, level: number): BaseStats {
  const growth = (roleId && prog.roles[roleId]?.growth) || {};
  const out = { ...NO_POINTS } as Record<StatName, number>;
  for (const s of STAT_NAMES) out[s] = Math.floor((growth[s] ?? 0) * (level - 1));
  return out;
}

/** Effective battle stats: species level-1 stats + role growth + spent points + talent points. */
export function memberStats(content: BattleContent, prog: ProgressionContent, m: Progress): { stats: BaseStats; maxHp: number } {
  const base = content.species[m.speciesId]!.stats;
  const growth = roleGrowth(prog, m.role, m.level);
  const out = {} as Record<StatName, number>;
  for (const s of STAT_NAMES) {
    const fromTalents = m.talents.reduce((sum, t) => sum + (prog.talents[t]?.stats?.[s] ?? 0), 0);
    out[s] = base[s] + growth[s] + m.statPoints[s] + fromTalents;
  }
  return { stats: out, maxHp: maxHpAt(content, out.hp, base.defense, m.level) };
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
  if (m.role) parts.push(prog.roles[m.role]?.mods ?? {});
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
/** The form a wild Pokémon of a species has at a level: evolved as far as its level allows. */
export function wildForm(content: BattleContent, speciesId: string, level: number): string {
  let id = speciesId;
  for (let evo = content.species[id]!.evolution; evo && level >= evo.level && content.species[evo.into]; evo = content.species[id]!.evolution) id = evo.into;
  return id;
}

export function wildSetup(content: BattleContent, prog: ProgressionContent, wildSpecies: string, level: number): Omit<UnitSetup, "id" | "side" | "pos"> {
  const speciesId = wildForm(content, wildSpecies, level);
  const known = movesKnownAt(content.species[speciesId]!, level);
  const points = playstylePoints(content, speciesId, (level - 1) * prog.rules.pointsPerLevel);
  const m: Progress = {
    // Wild Pokémon grow along their species' first role.
    speciesId, level, xp: 0, role: content.species[speciesId]!.roles?.[0] ?? null, talents: [], heldItem: null, knownMoves: known,
    activeMoves: defaultActiveMoves(content, prog, speciesId, known), hp: Number.MAX_SAFE_INTEGER,
    statPoints: points, unspentPoints: 0,
  };
  return toUnitSetup(content, prog, m);
}

/**
 * A trainer's Pokémon: fully developed like a player's (role, the first mastery of every reached
 * row, stat points) with an optional held item and fixed moves. Gym leaders and rivals use it.
 */
export function trainerSetup(
  content: BattleContent, prog: ProgressionContent,
  mon: { readonly species: string; readonly level: number; readonly role?: string; readonly heldItem?: string; readonly moves?: readonly string[] },
): Omit<UnitSetup, "id" | "side" | "pos"> {
  const species = content.species[mon.species]!;
  const known = movesKnownAt(species, mon.level);
  let m: Progress = {
    speciesId: mon.species, level: mon.level, xp: 0, role: null, talents: [], heldItem: mon.heldItem ?? null, knownMoves: known,
    activeMoves: defaultActiveMoves(content, prog, mon.species, known), hp: Number.MAX_SAFE_INTEGER,
    statPoints: playstylePoints(content, mon.species, (mon.level - 1) * prog.rules.pointsPerLevel), unspentPoints: 0,
  };
  for (let guard = 0; guard < 40; guard++) {
    const p = pendingChoice(content, prog, m);
    if (p === "role") {
      const role = mon.role && species.roles?.includes(mon.role) ? mon.role : species.roles![0]!;
      m = chooseRole(content, prog, m, role);
    } else if (p === "talent") {
      m = chooseTalent(content, prog, m, talentOptions(content, prog, m)[0]!);
    } else break;
  }
  if (mon.moves) {
    const basic = basicMoveOf(content, species);
    m = { ...m, activeMoves: mon.moves.filter((id) => id !== basic && content.moves[id]).slice(0, prog.rules.maxActiveMoves) };
  }
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

/**
 * The mastery grid: one row per level, each row a set of mutually exclusive masteries (pick one).
 * Rows come from the role's tree and the trees of all the species' types; without a role only the
 * type rows are known.
 */
export interface GridRow {
  readonly level: number;
  readonly options: readonly string[];
}

export function masteryGrid(content: BattleContent, prog: ProgressionContent, speciesId: string, role: string | null): GridRow[] {
  const types = content.species[speciesId]!.types;
  const nodes = [...((role && prog.roles[role]?.tree) || []), ...types.flatMap((t) => prog.typeTrees[t]?.tree ?? [])];
  const byLevel = new Map<number, string[]>();
  for (const n of nodes) {
    const id = nodeTalent(prog, n, types);
    if (!id || !prog.talents[id]) continue;
    const row = byLevel.get(n.level) ?? [];
    if (!row.includes(id)) row.push(id);
    byLevel.set(n.level, row);
  }
  return [...byLevel.entries()].sort((a, b) => a[0] - b[0]).map(([level, options]) => ({ level, options }));
}

export const memberGrid = (content: BattleContent, prog: ProgressionContent, m: Progress): GridRow[] =>
  masteryGrid(content, prog, m.speciesId, m.role);

/** The mastery picked in a row, if any. */
export const rowPick = (row: GridRow, m: Progress): string | null => row.options.find((o) => m.talents.includes(o)) ?? null;

/** Reached rows still waiting for a pick. */
function openRows(content: BattleContent, prog: ProgressionContent, m: Progress): GridRow[] {
  if (m.role === null) return [];
  return memberGrid(content, prog, m).filter((r) => r.level <= m.level && rowPick(r, m) === null);
}

/** The choice a member is waiting for, if any. */
export function pendingChoice(content: BattleContent, prog: ProgressionContent, m: Progress): "role" | "talent" | null {
  if (m.level < prog.rules.roleLevel) return null;
  if (m.role === null) return "role";
  return openRows(content, prog, m).length ? "talent" : null;
}

export function roleOptions(content: BattleContent, m: Progress): string[] {
  return [...(content.species[m.speciesId]!.roles ?? [])];
}

export function chooseRole<T extends Progress>(content: BattleContent, prog: ProgressionContent, m: T, roleId: string): T {
  if (pendingChoice(content, prog, m) !== "role") throw new Error("no role choice pending");
  if (!roleOptions(content, m).includes(roleId) || !prog.roles[roleId]) throw new Error(`${m.speciesId} cannot become ${roleId}`);
  return { ...m, role: roleId };
}

/** The talent a tree node stands for: "@type" becomes the talent of the Pokémon's primary type. */
export function nodeTalent(prog: ProgressionContent, node: TreeNode, types: readonly string[]): string | null {
  if (node.talent !== "@type") return node.talent;
  return Object.values(prog.talents).find((t) => t.requiresType === types[0])?.id ?? null;
}

/**
 * A talent as a Pokémon of these types sees it: a skill with a type-flavoured version (primary type
 * first) teaches that move instead and takes its name.
 */
export function talentFor(content: BattleContent, prog: ProgressionContent, talentId: string, types: readonly string[]): TalentDef {
  const t = prog.talents[talentId]!;
  const move = types.map((ty) => t.typedMoves?.[ty]).find((x) => x !== undefined);
  return move ? { ...t, grantsMove: move, name: content.moves[move]?.name ?? t.name } : t;
}

/** Masteries that can be picked right now (the options of every open row). */
export function talentOptions(content: BattleContent, prog: ProgressionContent, m: Progress): string[] {
  return openRows(content, prog, m).flatMap((r) => r.options);
}

export function chooseTalent<T extends Progress>(content: BattleContent, prog: ProgressionContent, m: T, talentId: string): T {
  if (pendingChoice(content, prog, m) !== "talent") throw new Error("no talent choice pending");
  if (!talentOptions(content, prog, m).includes(talentId)) throw new Error(`talent ${talentId} is not available`);
  const next = { ...m, talents: [...m.talents, talentId] };
  const move = talentFor(content, prog, talentId, content.species[m.speciesId]!.types).grantsMove;
  if (!move || next.knownMoves.includes(move)) return next;
  // A skill talent teaches a move; it becomes active if there is room.
  const room = next.activeMoves.length < prog.rules.maxActiveMoves;
  return { ...next, knownMoves: [...next.knownMoves, move], activeMoves: room ? [...next.activeMoves, move] : next.activeMoves };
}

export const respecCost = (prog: ProgressionContent, m: Progress): number => prog.rules.respecCostPerLevel * m.level;

/** Forgets the role and every mastery, with the moves the masteries taught. */
export function resetMasteries<T extends Progress>(content: BattleContent, m: T): T {
  const natural = new Set(movesKnownAt(content.species[m.speciesId]!, m.level));
  return { ...m, role: null, talents: [], knownMoves: m.knownMoves.filter((mv) => natural.has(mv)), activeMoves: m.activeMoves.filter((mv) => natural.has(mv)) };
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

/** Team Bond for a battle: rules defaults plus the team talents of the deployed Pokémon and any bonus (meals). */
export function teamBond(
  content: BattleContent,
  prog: ProgressionContent,
  deployed: readonly Progress[],
  bonus: { readonly startBond?: number; readonly maxBond?: number } = {},
): { start: number; max: number } {
  let start = content.rules.bond.start + (bonus.startBond ?? 0);
  let max = content.rules.bond.max + (bonus.maxBond ?? 0);
  for (const m of deployed)
    for (const t of m.talents) {
      start += prog.talents[t]?.team?.startBond ?? 0;
      max += prog.talents[t]?.team?.maxBond ?? 0;
    }
  return { start: Math.min(start, max), max };
}
