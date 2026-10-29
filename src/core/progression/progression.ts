import { maxHpAt } from "../battle/battle";
import type { BaseStats, BattleContent, SpeciesDef } from "../battle/content";
import { STAT_NAMES, type StatName } from "../battle/species";
import { combineModifiers, type UnitModifiers } from "../battle/modifiers";
import type { UnitSetup } from "../battle/battle";
import type { FocusOption, MasteryTree, ProgressionContent } from "./content";

/** The parts of a party member that progression reads and changes. */
export interface Progress {
  readonly speciesId: string;
  readonly level: number;
  readonly xp: number;
  /** The stat chosen at the focus level: it grows every level and its tree's skills scale with it. */
  readonly focus: StatName | null;
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
  /** The player stopped its evolution: it waits until they start it from the Pokémon screen. */
  readonly evolutionHeld?: boolean;
}

export const NO_POINTS: BaseStats = { hp: 0, attack: 0, defense: 0, speed: 0, willpower: 0, crit: 0 };

export const basicMoveOf = (content: BattleContent, species: SpeciesDef): string => {
  const basic = species.moves.find((m) => content.moves[m]?.kind === "basic");
  if (!basic) throw new Error(`${species.id} has no basic move`);
  return basic;
};

/** The moves a species knows without its tree: a basic attack and one typed move (every other move comes from the tree). */
export const startingMoves = (species: SpeciesDef): string[] => [...species.moves];

/** Loadout slots: one basic attack, two skills (specials and ultimates), one Bond move. */
export const LOADOUT = { basic: 1, skill: 2, bond: 1 } as const;
export type LoadoutSlot = keyof typeof LOADOUT;
export const slotOf = (content: BattleContent, moveId: string): LoadoutSlot => {
  const kind = content.moves[moveId]?.kind;
  return kind === "basic" ? "basic" : kind === "bond" ? "bond" : "skill";
};

/**
 * The moves a member fights with: its chosen basic attack (the species' own unless another one is active),
 * then up to two skills and one Bond move from its active list, in order (extras are left out).
 */
export function battleMoves(content: BattleContent, m: Progress): string[] {
  const used: Record<LoadoutSlot, number> = { basic: 0, skill: 0, bond: 0 };
  const picked = m.activeMoves.filter((mv) => content.moves[mv] && used[slotOf(content, mv)]++ < LOADOUT[slotOf(content, mv)]);
  const basic = picked.find((mv) => slotOf(content, mv) === "basic") ?? basicMoveOf(content, content.species[m.speciesId]!);
  return [basic, ...picked.filter((mv) => mv !== basic)];
}

/** Default loadout: the strongest skills (or the newest support ones), and the strongest Bond move. */
export function defaultActiveMoves(content: BattleContent, prog: ProgressionContent, speciesId: string, known: readonly string[]): string[] {
  void prog;
  const basic = basicMoveOf(content, content.species[speciesId]!);
  const best = (slot: LoadoutSlot, n: number) => {
    const options = known.filter((m) => m !== basic && content.moves[m] && slotOf(content, m) === slot);
    const damaging = options.filter((m) => content.moves[m]!.power > 0).sort((a, b) => content.moves[b]!.power - content.moves[a]!.power);
    const support = options.filter((m) => !damaging.includes(m)).reverse();
    // The strongest damaging moves, with the newest support move in the last skill slot.
    const picks = slot === "skill" ? [...damaging.slice(0, n - 1), ...support.slice(0, 1)] : damaging.slice(0, n);
    for (const m of [...damaging, ...support]) if (picks.length < n && !picks.includes(m)) picks.push(m);
    return picks;
  };
  const picks = [...best("skill", LOADOUT.skill), ...best("bond", LOADOUT.bond)];
  return known.filter((m) => picks.includes(m));
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

/**
 * Stats the focus adds: a bonus when chosen, then +1 every `focusGrowthEvery` levels (counted from Lv 1).
 * A mixed focus splits the points between its two stats, the main one taking the odd point.
 */
export function focusGrowth(prog: ProgressionContent, focus: StatName | null, level: number, second?: StatName): BaseStats {
  const out = { ...NO_POINTS };
  if (!focus) return out;
  const total = prog.rules.focusBonus + Math.floor((level - 1) / prog.rules.focusGrowthEvery);
  if (!second) out[focus] = total;
  else { out[focus] = Math.ceil(total / 2); out[second] += Math.floor(total / 2); }
  return out;
}

/** The focus growth of a member, its mixed focus included. */
export const memberFocusGrowth = (prog: ProgressionContent, m: Progress): BaseStats => focusGrowth(prog, m.focus, m.level, focusOf(prog, m)?.second);

/** Effective battle stats: species level-1 stats + focus growth + spent points + talent points. */
export function memberStats(content: BattleContent, prog: ProgressionContent, m: Progress): { stats: BaseStats; maxHp: number } {
  const base = content.species[m.speciesId]!.stats;
  const growth = memberFocusGrowth(prog, m);
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

export interface StatOffer {
  readonly stat: StatName;
  /** Points it gives when picked: 1, or 2 for a lucky "++" offer. */
  readonly plus: 1 | 2;
}

/**
 * The stats offered for the next level-up point (as in Wartales): `size` stats, the focus stat always
 * among them and the rest weighted by the species' base stats; sometimes one comes as "++". The offer
 * follows from the member's state, so it cannot be rerolled. Empty when no point is waiting.
 */
export function statOffer(content: BattleContent, prog: ProgressionContent, m: Progress): StatOffer[] {
  if (m.unspentPoints <= 0) return [];
  const base = content.species[m.speciesId]!.stats;
  const spent = STAT_NAMES.reduce((s, st) => s + m.statPoints[st], 0);
  let seed = [...`${m.speciesId}:${m.level}:${spent}:${m.unspentPoints}`].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 17);
  const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const picks: StatName[] = m.focus ? [m.focus] : [];
  while (picks.length < Math.min(prog.rules.statOffer.size, STAT_NAMES.length)) {
    const pool = STAT_NAMES.filter((st) => !picks.includes(st));
    const total = pool.reduce((s, st) => s + base[st] + 1, 0);
    let r = rand() * total;
    picks.push(pool.find((st) => (r -= base[st] + 1) < 0) ?? pool[pool.length - 1]!);
  }
  const lucky = rand() < prog.rules.statOffer.doubleChance ? Math.floor(rand() * picks.length) : -1;
  return picks.map((stat, i) => ({ stat, plus: i === lucky ? 2 : 1 }));
}

/** EV a level-up point costs: `offerCost` for a stat not offered, `upgradeCost` more to make a +1 a +2. */
export function offerEvCost(content: BattleContent, prog: ProgressionContent, m: Progress, stat: StatName, upgrade = false): number {
  const offer = statOffer(content, prog, m).find((o) => o.stat === stat);
  if (upgrade && offer?.plus === 2) throw new Error("already +2");
  return (offer ? 0 : prog.rules.ev.offerCost) + (upgrade ? prog.rules.ev.upgradeCost : 0);
}

/** Takes one level-up point into a stat: an offered one at its +1/+2, any other at +1; `upgrade` adds +1 (EV paid by the caller). */
export function takeOffer<T extends Progress>(content: BattleContent, prog: ProgressionContent, m: T, stat: StatName, upgrade = false): T {
  const offer = statOffer(content, prog, m).find((o) => o.stat === stat);
  if (upgrade && offer?.plus === 2) throw new Error("already +2");
  return spendPoints(m, stat, (offer?.plus ?? 1) + (upgrade ? 1 : 0), 1);
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
    moves: battleMoves(content, m), mods: memberModifiers(prog, m),
  };
}

/** A wild Pokémon of a given level, with its default loadout. */
function evolveInto<T extends Progress>(content: BattleContent, prog: ProgressionContent, m: T, into: string, events: ProgressEvent[]): T {
  events.push({ type: "evolved", from: m.speciesId, into });
  // An evolution may swap a starting move for one of its own type (Eevee's Quick Attack → Vaporeon's Water Pulse).
  const next = startingMoves(content.species[into]!);
  const dropped = startingMoves(content.species[m.speciesId]!).filter((mv) => !next.includes(mv));
  const taught = new Set(m.talents.map((id) => prog.talents[id]?.grantsMove));
  const keep = (mv: string) => !dropped.includes(mv) || taught.has(mv);
  return retrainForm(content, prog, {
    ...m, speciesId: into, unspentPoints: m.unspentPoints + prog.rules.evolutionPoints,
    knownMoves: m.knownMoves.filter(keep), activeMoves: m.activeMoves.filter(keep),
  });
}

function learnLevelMoves<T extends Progress>(content: BattleContent, prog: ProgressionContent, m: T, events: ProgressEvent[]): T {
  let cur = m;
  for (const move of startingMoves(content.species[cur.speciesId]!)) {
    if (cur.knownMoves.includes(move)) continue;
    const basic = basicMoveOf(content, content.species[cur.speciesId]!);
    const slot = slotOf(content, move);
    const activate = move !== basic && slot !== "basic" && cur.activeMoves.filter((x) => slotOf(content, x) === slot).length < LOADOUT[slot];
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
  return evolveTo(content, prog, m, into);
}

/** The form a (non-branching) evolution would make now that its level is reached, held or not; else null. */
export function evolutionDue(content: BattleContent, m: Progress): string | null {
  const evo = content.species[m.speciesId]!.evolution;
  return evo && !evo.choices && m.level >= evo.level && content.species[evo.into] ? evo.into : null;
}

/** Due to evolve and not held back by the player: the evolution scene plays for it. */
export const readyToEvolve = (content: BattleContent, m: Progress): boolean => !m.evolutionHeld && evolutionDue(content, m) !== null;

/** Runs a due evolution (the end of the evolution scene, or the Pokémon screen's Evolve button). */
export function evolveNow<T extends Progress>(content: BattleContent, prog: ProgressionContent, m: T): { member: T; events: ProgressEvent[] } {
  const into = evolutionDue(content, m);
  if (!into) throw new Error(`${m.speciesId} cannot evolve now`);
  return evolveTo(content, prog, { ...m, evolutionHeld: false }, into);
}

/** The player stopped the evolution: no more tries on level-ups until they start it themselves. */
export const holdEvolution = <T extends Progress>(m: T): T => ({ ...m, evolutionHeld: true });

function evolveTo<T extends Progress>(content: BattleContent, prog: ProgressionContent, m: T, into: string): { member: T; events: ProgressEvent[] } {
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
  const known = startingMoves(content.species[speciesId]!);
  const points = playstylePoints(content, speciesId, (level - 1) * prog.rules.pointsPerLevel);
  const m: Progress = {
    speciesId, level, xp: 0, focus: null, talents: [], heldItem: null, knownMoves: known,
    activeMoves: defaultActiveMoves(content, prog, speciesId, known), hp: Number.MAX_SAFE_INTEGER,
    statPoints: points, unspentPoints: 0,
  };
  // Wild Pokémon grow their tree like the player's (moves come only from it): one focus and one pick per row,
  // chosen from `salt`, so a whole group shares them.
  const pick = <T>(options: readonly T[], key: string) => options[hash(`${salt}:${key}`) % options.length]!;
  const grown = developTree(content, prog, m, (o) => pick(o, "focus").skill, (o, row) => pick(o, `row${row}`));
  return toUnitSetup(content, prog, { ...grown, activeMoves: defaultActiveMoves(content, prog, speciesId, grown.knownMoves) });
}

/**
 * A trainer's Pokémon: fully developed like a player's (role, the first mastery of every reached
 * row, stat points) with an optional held item and fixed moves. Gym leaders and rivals use it.
 */
export function trainerSetup(
  content: BattleContent, prog: ProgressionContent,
  mon: { readonly species: string; readonly level: number; readonly focus?: StatName; readonly heldItem?: string; readonly moves?: readonly string[] },
): Omit<UnitSetup, "id" | "side" | "pos"> {
  const species = content.species[mon.species]!;
  const known = startingMoves(species);
  let m: Progress = {
    speciesId: mon.species, level: mon.level, xp: 0, focus: null, talents: [], heldItem: mon.heldItem ?? null, knownMoves: known,
    activeMoves: defaultActiveMoves(content, prog, mon.species, known), hp: Number.MAX_SAFE_INTEGER,
    statPoints: playstylePoints(content, mon.species, (mon.level - 1) * prog.rules.pointsPerLevel), unspentPoints: 0,
  };
  m = developTree(content, prog, m, (options) => (options.find((o) => o.stat === mon.focus) ?? options[0]!).skill, (options) => options[0]!);
  if (mon.moves) {
    const basic = basicMoveOf(content, species);
    m = { ...m, activeMoves: mon.moves.filter((id) => id !== basic && content.moves[id]) };
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
 * `evolve: false` leaves a due evolution for the evolution scene (see readyToEvolve); a held one never runs here.
 */
export function gainXp<T extends Progress>(
  content: BattleContent, prog: ProgressionContent, m: T, xp: number, { evolve = true }: { evolve?: boolean } = {},
): { member: T; events: ProgressEvent[] } {
  const events: ProgressEvent[] = [];
  let cur: T = { ...m, xp: m.xp + xp };
  while (cur.level < prog.rules.maxLevel && cur.xp >= xpToNext(prog, cur.level)) {
    const before = memberStats(content, prog, cur).maxHp;
    cur = { ...cur, xp: cur.xp - xpToNext(prog, cur.level), level: cur.level + 1, unspentPoints: cur.unspentPoints + prog.rules.pointsPerLevel };
    events.push({ type: "levelUp", level: cur.level });
    const evo = content.species[cur.speciesId]!.evolution;
    // A branching evolution (Eevee) waits for the player's pick, see chooseEvolution.
    if (evolve && !cur.evolutionHeld && evo && !evo.choices && cur.level >= evo.level && content.species[evo.into]) cur = evolveInto(content, prog, cur, evo.into, events);
    cur = learnLevelMoves(content, prog, cur, events);
    const after = memberStats(content, prog, cur).maxHp;
    if (cur.hp > 0) cur = { ...cur, hp: Math.min(after, cur.hp + Math.max(0, after - before)) };
  }
  if (cur.level >= prog.rules.maxLevel) cur = { ...cur, xp: 0 };
  return { member: cur, events };
}

/**
 * The mastery tree, as in Wartales: hand-made archetype trees shared by evolution lines of one type and role
 * (src/content/mastery/archetypes, docs/design/archetype-trees.md). At the focus level the Pokémon picks one of three focuses = a stat that
 * grows every level + a Bond skill that scales with it; then each row offers 2–3 skills or 2–3 passives.
 */
export interface GridRow {
  readonly level: number;
  readonly options: readonly string[];
}

/** The tree of a species' line, if it has one. */
export const treeOf = (prog: ProgressionContent, speciesId: string): MasteryTree | undefined => prog.trees[speciesId];

/** The three focuses offered at the focus level. */
export const focusOptions = (prog: ProgressionContent, speciesId: string): readonly FocusOption[] => treeOf(prog, speciesId)?.focus ?? [];

/** The focus option a member took. */
export const focusOf = (prog: ProgressionContent, m: Progress): FocusOption | undefined =>
  m.focus ? focusOptions(prog, m.speciesId).find((o) => m.talents.includes(o.skill)) : undefined;

/** A wild Pokémon's focus: picked from `salt` so a group shares it, none below the focus level. */
const hash = (text: string) => [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** Makes every choice a Pokémon's level allows: its focus, then one mastery per reached row. */
function developTree<T extends Progress>(
  content: BattleContent, prog: ProgressionContent, start: T,
  focus: (options: ReturnType<typeof focusOptions>) => string, talent: (options: string[], row: number) => string,
): T {
  let m = start;
  for (let guard = 0; guard < 40; guard++) {
    const p = pendingChoice(content, prog, m);
    if (p === "focus") m = chooseFocus(content, prog, m, focus(focusOptions(prog, m.speciesId)));
    else if (p === "talent") m = chooseTalent(content, prog, m, talent(talentOptions(content, prog, m), guard));
    else break;
  }
  return m;
}

/** The rows of a species' tree: the line's rows, with its current form's rows replacing them (Eevee's forms). */
export function masteryGrid(prog: ProgressionContent, speciesId: string): GridRow[] {
  const tree = treeOf(prog, speciesId);
  if (!tree) return [];
  const rows = { ...tree.rows, ...(tree.forms?.[speciesId]?.rows ?? {}) };
  return Object.entries(rows).map(([level, options]) => ({ level: Number(level), options: [...options] })).sort((a, b) => a.level - b.level);
}

export const memberGrid = (prog: ProgressionContent, m: Progress): GridRow[] => masteryGrid(prog, m.speciesId);

/**
 * After an evolution into a form with its own rows (Eevee → Vaporeon), masteries no longer in the tree
 * (and the moves they taught) are forgotten, so those rows open again for a free pick.
 */
function retrainForm<T extends Progress>(content: BattleContent, prog: ProgressionContent, m: T): T {
  const tree = new Set([...memberGrid(prog, m).flatMap((r) => r.options), ...focusOptions(prog, m.speciesId).map((o) => o.skill)]);
  const dropped = m.talents.filter((id) => !tree.has(id));
  if (!dropped.length) return m;
  const lost = new Set(dropped.map((id) => prog.talents[id]?.grantsMove).filter((x): x is string => !!x));
  const natural = new Set(startingMoves(content.species[m.speciesId]!));
  const forget = (mv: string) => lost.has(mv) && !natural.has(mv);
  return {
    ...m,
    talents: m.talents.filter((id) => tree.has(id)),
    knownMoves: m.knownMoves.filter((mv) => !forget(mv)),
    activeMoves: m.activeMoves.filter((mv) => !forget(mv)),
  };
}

/**
 * Brings a saved member up to date with the content: it knows its species' starting moves, forgets moves of
 * the other reach (melee/ranged) and masteries its tree no longer has (their rows open again), and its loadout
 * fits the slots.
 */
export function refreshMember<T extends Progress>(content: BattleContent, prog: ProgressionContent, m: T): T {
  const role = content.species[m.speciesId]?.role;
  const start = startingMoves(content.species[m.speciesId]!);
  const fits = (mv: string) => start.includes(mv) || !role || !content.moves[mv]?.reach || content.moves[mv]!.reach === role;
  let cur: T = retrainForm(content, prog, {
    ...m,
    knownMoves: [...new Set([...start, ...m.knownMoves.filter((mv) => content.moves[mv] && fits(mv))])],
  });
  const basic = basicMoveOf(content, content.species[cur.speciesId]!);
  const active = cur.activeMoves.filter((mv) => mv !== basic && cur.knownMoves.includes(mv));
  const used: Record<LoadoutSlot, number> = { basic: 0, skill: 0, bond: 0 };
  cur = { ...cur, activeMoves: active.filter((mv) => used[slotOf(content, mv)]++ < LOADOUT[slotOf(content, mv)]) };
  return cur;
}

/** The mastery picked in a row, if any. */
export const rowPick = (row: GridRow, m: Progress): string | null => row.options.find((o) => m.talents.includes(o)) ?? null;

/** Reached rows still waiting for a pick. */
function openRows(content: BattleContent, prog: ProgressionContent, m: Progress): GridRow[] {
  if (m.focus === null) return [];
  return memberGrid(prog, m).filter((r) => r.level <= m.level && rowPick(r, m) === null);
}

/** The choice a member is waiting for, if any. */
export function pendingChoice(content: BattleContent, prog: ProgressionContent, m: Progress): "evolution" | "focus" | "talent" | null {
  if (evolutionChoices(content, m).length) return "evolution";
  if (m.level < prog.rules.focusLevel || !treeOf(prog, m.speciesId)) return null;
  if (m.focus === null) return "focus";
  return openRows(content, prog, m).length ? "talent" : null;
}

/** Takes the focus option with this Bond skill: its stat gets the focus bonus and the skill is learned. */
export function chooseFocus<T extends Progress>(content: BattleContent, prog: ProgressionContent, m: T, skill: string): T {
  if (pendingChoice(content, prog, m) !== "focus") throw new Error("no focus choice pending");
  const option = focusOptions(prog, m.speciesId).find((o) => o.skill === skill);
  if (!option) throw new Error(`${m.speciesId} has no focus ${skill}`);
  return grantTalent(content, prog, { ...m, focus: option.stat }, option.skill);
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
  const move = prog.talents[talentId]?.grantsMove;
  if (!move || next.knownMoves.includes(move)) return next;
  // A skill talent teaches a move; it becomes active if there is room.
  const room = next.activeMoves.length < prog.rules.maxActiveMoves;
  return { ...next, knownMoves: [...next.knownMoves, move], activeMoves: room ? [...next.activeMoves, move] : next.activeMoves };
}

export const respecCost = (prog: ProgressionContent, m: Progress): number => prog.rules.respecCostPerLevel * m.level;

/** Forgets the focus and every mastery, with the moves the masteries taught. */
export function resetMasteries<T extends Progress>(content: BattleContent, m: T): T {
  const natural = new Set(startingMoves(content.species[m.speciesId]!));
  return { ...m, focus: null, talents: [], knownMoves: m.knownMoves.filter((mv) => natural.has(mv)), activeMoves: m.activeMoves.filter((mv) => natural.has(mv)) };
}

/** Sets the active moves (besides the basic attack). */
export function setActiveMoves<T extends Progress>(content: BattleContent, prog: ProgressionContent, m: T, moves: readonly string[]): T {
  void prog;
  const basic = basicMoveOf(content, content.species[m.speciesId]!);
  if (new Set(moves).size !== moves.length) throw new Error("a move is listed twice");
  for (const mv of moves) {
    if (!m.knownMoves.includes(mv)) throw new Error(`${m.speciesId} does not know ${mv}`);
    if (mv === basic) throw new Error("the species' basic attack is used when no other basic is active");
  }
  for (const slot of Object.keys(LOADOUT) as LoadoutSlot[]) {
    if (moves.filter((mv) => slotOf(content, mv) === slot).length > LOADOUT[slot]) throw new Error(`at most ${LOADOUT[slot]} ${slot} move(s)`);
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
