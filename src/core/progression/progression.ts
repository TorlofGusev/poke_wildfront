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
  /** A type an evolution added (Charmeleon → Charizard: Flying) and the level it came at: one extra row from its kit. */
  readonly bonusType?: { readonly type: string; readonly level: number } | null;
  /** The type half of the path chosen at the role level (role + type form the mastery tree). */
  readonly focus?: string | null;
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
function evolveInto<T extends Progress>(content: BattleContent, prog: ProgressionContent, m: T, into: string, events: ProgressEvent[]): T {
  events.push({ type: "evolved", from: m.speciesId, into });
  // A type the new form adds (and the path does not use) opens a gift row from that type's kit.
  const before = content.species[m.speciesId]!.types;
  const added = content.species[into]!.types.find((ty) => !before.includes(ty));
  const bonusType = m.bonusType ?? (added ? { type: added, level: m.level } : null);
  return retrainType(content, prog, { ...m, speciesId: into, bonusType, unspentPoints: m.unspentPoints + prog.rules.evolutionPoints });
}

function learnLevelMoves<T extends Progress>(content: BattleContent, prog: ProgressionContent, m: T, events: ProgressEvent[]): T {
  let cur = m;
  for (const move of movesKnownAt(content.species[cur.speciesId]!, cur.level)) {
    if (cur.knownMoves.includes(move)) continue;
    const basic = basicMoveOf(content, content.species[cur.speciesId]!);
    const activate = move !== basic && cur.activeMoves.length < prog.rules.maxActiveMoves;
    cur = { ...cur, knownMoves: [...cur.knownMoves, move], activeMoves: activate ? [...cur.activeMoves, move] : cur.activeMoves };
    events.push({ type: "learned", move, activated: activate });
  }
  return cur;
}

/** Forms a member may evolve into right now by the player's choice (Eevee at Lv 15), else []. */
export function evolutionChoices(content: BattleContent, m: Progress): string[] {
  const evo = content.species[m.speciesId]!.evolution;
  return evo?.choices && m.level >= evo.level ? evo.choices.filter((id) => content.species[id]) : [];
}

/** Evolves into the chosen form of a branching evolution. */
export function chooseEvolution<T extends Progress>(content: BattleContent, prog: ProgressionContent, m: T, into: string): { member: T; events: ProgressEvent[] } {
  if (!evolutionChoices(content, m).includes(into)) throw new Error(`${m.speciesId} cannot evolve into ${into} now`);
  const events: ProgressEvent[] = [];
  const before = memberStats(content, prog, m).maxHp;
  let cur = learnLevelMoves(content, prog, evolveInto(content, prog, m, into, events), events);
  const after = memberStats(content, prog, cur).maxHp;
  if (cur.hp > 0) cur = { ...cur, hp: Math.min(after, cur.hp + Math.max(0, after - before)) };
  return { member: cur, events };
}

/**
 * The form a wild Pokémon of a species has at a level: evolved as far as its level allows. A branching
 * evolution (Eevee) picks one of its forms from `salt` (e.g. the encounter id), so a group keeps its form.
 */
export function wildForm(content: BattleContent, speciesId: string, level: number, salt = ""): string {
  let id = speciesId;
  for (let evo = content.species[id]!.evolution; evo && level >= evo.level && content.species[evo.into]; evo = content.species[id]!.evolution) {
    const forms = evo.choices?.filter((f) => content.species[f]) ?? [];
    id = forms.length ? forms[[...`${salt}:${id}`].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % forms.length]! : evo.into;
  }
  return id;
}

export function wildSetup(content: BattleContent, prog: ProgressionContent, wildSpecies: string, level: number, salt = ""): Omit<UnitSetup, "id" | "side" | "pos"> {
  const speciesId = wildForm(content, wildSpecies, level, salt);
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
      const paths = pathOptions(content, prog, m);
      const role = paths.find((p) => p.startsWith(`${mon.role}:`)) ?? paths[0]!;
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
    // A branching evolution (Eevee) waits for the player's pick, see chooseEvolution.
    if (evo && !evo.choices && cur.level >= evo.level && content.species[evo.into]) cur = evolveInto(content, prog, cur, evo.into, events);
    cur = learnLevelMoves(content, prog, cur, events);
    const after = memberStats(content, prog, cur).maxHp;
    if (cur.hp > 0) cur = { ...cur, hp: Math.min(after, cur.hp + Math.max(0, after - before)) };
  }
  if (cur.level >= prog.rules.maxLevel) cur = { ...cur, xp: 0 };
  return { member: cur, events };
}

/**
 * The mastery tree: one tree per Pokémon, as in Wartales (docs/design/mastery-kits.md). At the role
 * level it takes a path = role + type, which grants the type's starting skill. Single-type species
 * choose one of their two roles; dual-type species have a fixed role and choose one of their types.
 * The tree is then fixed slots filled from the role kit and the type kit; each row pairs passives
 * with passives or skills with skills.
 */
export interface GridRow {
  readonly level: number;
  readonly options: readonly string[];
}

/** Path ids are "role:type". */
export const pathId = (role: string, type: string): string => `${role}:${type}`;

export function resolvePath(content: BattleContent, speciesId: string, path: string): { role: string; type: string } {
  const [role, type] = path.split(":") as [string, string | undefined];
  return { role, type: type ?? content.species[speciesId]!.types[0]! };
}

/** The fixed role of a dual-type species (its listed first role if none is set). */
export function fixedRole(content: BattleContent, prog: ProgressionContent, speciesId: string): string {
  return prog.speciesRoles?.[speciesId] ?? content.species[speciesId]!.roles![0]!;
}

/** The paths offered at the role level. */
export function pathOptions(content: BattleContent, prog: ProgressionContent, m: { readonly speciesId: string }): string[] {
  const s = content.species[m.speciesId]!;
  if (s.types.length > 1) return s.types.map((t) => pathId(fixedRole(content, prog, m.speciesId), t));
  return (s.roles ?? []).map((r) => pathId(r, s.types[0]!));
}

/** The path a member took, or null before choosing. */
export function pathOf(content: BattleContent, m: Progress): string | null {
  if (!m.role) return null;
  return pathId(m.role, m.focus ?? content.species[m.speciesId]!.types[0]!);
}

/** Display name of a path, e.g. "Grass Tank". */
export function pathName(prog: ProgressionContent, path: string): string {
  const [role, type = ""] = path.split(":");
  return `${type.charAt(0).toUpperCase()}${type.slice(1)} ${prog.roles[role!]?.name ?? role}`;
}

/** The skill a path grants when chosen (a species' unique tree may have its own). */
export const pathStartSkill = (prog: ProgressionContent, path: string, speciesId?: string): string | null =>
  (speciesId && prog.speciesKits?.[speciesId]?.start) || (prog.kits?.types[path.split(":")[1] ?? ""]?.start ?? null);

/** Tree slots: level and which kit entries fill them ([role or type, passive or skill, index]). */
const SLOTS: readonly { level: number; options: readonly (readonly ["r" | "t", "p" | "s", number])[] }[] = [
  { level: 4, options: [["t", "p", 0], ["t", "p", 1]] },
  { level: 6, options: [["r", "s", 0], ["r", "s", 1]] },
  { level: 9, options: [["r", "p", 0], ["r", "p", 1]] },
  { level: 12, options: [["t", "s", 0], ["t", "s", 1]] },
  { level: 15, options: [["r", "p", 2], ["t", "p", 2]] },
  { level: 18, options: [["r", "s", 2], ["t", "s", 2]] },
  { level: 21, options: [["t", "p", 3], ["r", "p", 3]] },
  { level: 24, options: [["t", "s", 3], ["r", "s", 3]] },
  { level: 27, options: [["r", "p", 4], ["t", "p", 4]] },
];

export function masteryGrid(content: BattleContent, prog: ProgressionContent, speciesId: string, path: string | null): GridRow[] {
  if (!path) return [];
  const { role, type } = resolvePath(content, speciesId, path);
  const r = prog.kits?.roles[role];
  const t = prog.kits?.types[type];
  if (!r || !t) return [];
  const pick = ([who, kind, i]: readonly ["r" | "t", "p" | "s", number]) => (who === "r" ? r : t)[kind === "p" ? "passives" : "skills"][i];
  const rows: GridRow[] = [
    ...SLOTS.map((s) => ({ level: s.level, options: s.options.map(pick) })),
    { level: 30, options: [r.capstone, t.capstone] },
  ]
    // Kits still missing late entries simply leave those rows out.
    .filter((row) => row.options.every((o): o is string => typeof o === "string"))
    .map((row) => ({ level: row.level, options: row.options as string[] }));
  // A species' unique tree or signature slot replaces whole rows.
  const own = prog.speciesKits?.[speciesId]?.rows ?? {};
  return rows.map((row) => (own[row.level] ? { level: row.level, options: [...own[row.level]!] } : row));
}

export function memberGrid(content: BattleContent, prog: ProgressionContent, m: Progress): GridRow[] {
  const rows = masteryGrid(content, prog, m.speciesId, pathOf(content, m));
  const gift = m.bonusType && m.bonusType.type !== m.focus ? prog.kits?.types[m.bonusType.type] : undefined;
  if (!gift || !rows.length) return rows;
  // The gift row: the added type's starting skill or its first skill (both new to this tree).
  const taken = new Set(rows.flatMap((r) => r.options));
  const options = [gift.start, gift.skills[0]].filter((o): o is string => !!o && !taken.has(o));
  return options.length ? [...rows, { level: m.bonusType!.level, options }].sort((a, b) => a.level - b.level) : rows;
}

/**
 * After an evolution that drops the path's type (Eevee → Vaporeon), the path moves to the new form's
 * first type: masteries no longer in the tree (and the moves they taught) are forgotten, so those rows
 * open again, and the new type's start skill is learned.
 */
function retrainType<T extends Progress>(content: BattleContent, prog: ProgressionContent, m: T): T {
  if (!m.role || !m.focus || content.species[m.speciesId]!.types.includes(m.focus)) return m;
  const focus = content.species[m.speciesId]!.types[0]!;
  const moved = { ...m, focus };
  const tree = new Set(memberGrid(content, prog, moved).flatMap((r) => r.options));
  const keep = (id: string) => tree.has(id);
  const dropped = m.talents.filter((id) => !keep(id));
  const lost = new Set(dropped.map((id) => prog.talents[id]?.grantsMove).filter((x): x is string => !!x).flatMap((mv) => [mv, ...m.knownMoves.filter((k) => k.startsWith(`${mv}--`))]));
  const natural = new Set(movesKnownAt(content.species[m.speciesId]!, m.level));
  const forget = (mv: string) => lost.has(mv) && !natural.has(mv);
  const cleaned = {
    ...moved,
    talents: m.talents.filter(keep),
    knownMoves: m.knownMoves.filter((mv) => !forget(mv)),
    activeMoves: m.activeMoves.filter((mv) => !forget(mv)),
  };
  const start = pathStartSkill(prog, pathOf(content, cleaned)!, m.speciesId);
  return start && prog.talents[start] && !cleaned.talents.includes(start) ? grantTalent(content, prog, cleaned, start) : cleaned;
}

/** The mastery picked in a row, if any. */
export const rowPick = (row: GridRow, m: Progress): string | null => row.options.find((o) => m.talents.includes(o)) ?? null;

/** Reached rows still waiting for a pick. */
function openRows(content: BattleContent, prog: ProgressionContent, m: Progress): GridRow[] {
  if (m.role === null) return [];
  return memberGrid(content, prog, m).filter((r) => r.level <= m.level && rowPick(r, m) === null);
}

/** The choice a member is waiting for, if any. */
export function pendingChoice(content: BattleContent, prog: ProgressionContent, m: Progress): "evolution" | "role" | "talent" | null {
  if (evolutionChoices(content, m).length) return "evolution";
  if (m.level < prog.rules.roleLevel) return null;
  if (m.role === null) return "role";
  return openRows(content, prog, m).length ? "talent" : null;
}

export function chooseRole<T extends Progress>(content: BattleContent, prog: ProgressionContent, m: T, roleId: string): T {
  if (pendingChoice(content, prog, m) !== "role") throw new Error("no role choice pending");
  if (!pathOptions(content, prog, m).includes(roleId)) throw new Error(`${m.speciesId} cannot take the path ${roleId}`);
  const { role, type } = resolvePath(content, m.speciesId, roleId);
  if (!prog.roles[role]) throw new Error(`unknown role ${role}`);
  // The path is kept as role + type (focus), so it survives evolutions that change the types.
  const chosen = { ...m, role, focus: type };
  const start = pathStartSkill(prog, roleId, m.speciesId);
  return start && prog.talents[start] ? grantTalent(content, prog, chosen, start) : chosen;
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
  return grantTalent(content, prog, m, talentId);
}

/** Adds a talent; a skill talent also teaches its move (active if there is room). */
function grantTalent<T extends Progress>(content: BattleContent, prog: ProgressionContent, m: T, talentId: string): T {
  const next = { ...m, talents: [...m.talents, talentId] };
  const move = talentFor(content, prog, talentId, m.focus ? [m.focus] : content.species[m.speciesId]!.types).grantsMove;
  if (!move || next.knownMoves.includes(move)) return next;
  // A skill talent teaches a move; it becomes active if there is room.
  const room = next.activeMoves.length < prog.rules.maxActiveMoves;
  return { ...next, knownMoves: [...next.knownMoves, move], activeMoves: room ? [...next.activeMoves, move] : next.activeMoves };
}

export const respecCost = (prog: ProgressionContent, m: Progress): number => prog.rules.respecCostPerLevel * m.level;

/** Forgets the role and every mastery, with the moves the masteries taught. */
export function resetMasteries<T extends Progress>(content: BattleContent, m: T): T {
  const natural = new Set(movesKnownAt(content.species[m.speciesId]!, m.level));
  return { ...m, role: null, focus: null, talents: [], knownMoves: m.knownMoves.filter((mv) => natural.has(mv)), activeMoves: m.activeMoves.filter((mv) => natural.has(mv)) };
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
  // Team talents do not stack between Pokémon: the team gets the best one of each kind.
  const best = (k: "startBond" | "maxBond") =>
    Math.max(0, ...deployed.flatMap((m) => m.talents.map((t) => prog.talents[t]?.team?.[k] ?? 0)));
  const start = content.rules.bond.start + (bonus.startBond ?? 0) + best("startBond");
  const max = content.rules.bond.max + (bonus.maxBond ?? 0) + best("maxBond");
  return { start: Math.min(start, max), max };
}
