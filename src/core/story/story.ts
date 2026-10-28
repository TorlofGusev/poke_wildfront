import type { BattleScenario, UnitSetup } from "../battle";
import type { FreeField } from "../free/field";
import { key, type Point } from "../grid/types";
import type { GameState } from "../party/roster";

/** The eight Kanto badges, in order. */
export const BADGES = ["boulder", "cascade", "thunder", "rainbow", "soul", "marsh", "volcano", "earth"] as const;
export type BadgeId = (typeof BADGES)[number];

/** Field moves usable outside battle: the HM item plus the badge that allows it (as in Gen 1). */
export const FIELD_MOVES = {
  cut: { item: "hm-cut", badge: "cascade" },
  flash: { item: "hm-flash", badge: "boulder" },
  surf: { item: "hm-surf", badge: "soul" },
  strength: { item: "hm-strength", badge: "rainbow" },
} as const;
export type FieldMove = keyof typeof FIELD_MOVES;

/** All of it must hold. */
export interface Condition {
  readonly flags?: readonly string[];
  readonly notFlags?: readonly string[];
  /** Number of badges at least. */
  readonly badges?: number;
  readonly keyItems?: readonly string[];
  readonly fieldMove?: FieldMove;
}

export interface TrainerMon {
  readonly species: string;
  readonly level: number;
  /** Role to specialise into (default: the species' first). */
  readonly role?: string;
  readonly heldItem?: string;
  /** Active moves (default: the latest learned). */
  readonly moves?: readonly string[];
}

export interface StoryReward {
  readonly money?: number;
  readonly items?: Readonly<Record<string, number>>;
  readonly balls?: Readonly<Record<string, number>>;
  readonly keyItems?: readonly string[];
  readonly badge?: BadgeId;
  readonly flags?: readonly string[];
  /** Gift Pokémon. */
  readonly pokemon?: readonly { readonly species: string; readonly level: number }[];
  /** Key items handed over (e.g. Tea to the guard, a fossil to the lab). */
  readonly takesKeyItems?: readonly string[];
}

export type NpcKind = "trainer" | "leader" | "rival" | "rocket" | "elite" | "champion" | "talk" | "gift" | "wild";

export interface NpcDef {
  readonly id: string;
  readonly name: string;
  readonly kind: NpcKind;
  readonly pos: Point;
  /** Species shown on the map (default: the lead of its team, or a marker). */
  readonly sprite?: string;
  /** Shown only while this holds (e.g. Rockets until the quest is solved). */
  readonly visibleIf?: Condition;
  /** Needed before it will battle or help; otherwise `lockedText` is shown. */
  readonly requires?: Condition;
  readonly lockedText?: readonly string[];
  readonly text?: readonly string[];
  /** Said once it is done. */
  readonly afterText?: readonly string[];
  readonly team?: readonly TrainerMon[];
  /** Rival teams by the player's starter; falls back to `team`. */
  readonly teamByStarter?: Readonly<Record<string, readonly TrainerMon[]>>;
  readonly reward?: StoryReward;
  /** A pick-one reward (fossils, Hitmonlee or Hitmonchan). */
  readonly choices?: readonly { readonly label: string; readonly reward: StoryReward }[];
  /** Biome whose arena hosts the battle (default: the biome under the NPC). */
  readonly arena?: string;
  /** A wild boss (Snorlax, legendaries) may be caught. */
  readonly capture?: boolean;
  /** Losing to any NPC of the group clears the group's progress (the Elite Four). */
  readonly group?: string;
}

export interface ObstacleDef {
  readonly pos: Point;
  readonly kind: "cut" | "boulder" | "dark" | "guard" | "rock";
  /** Passable once this holds. */
  readonly opensIf: Condition;
  readonly text: string;
}

/** Ordered story goals; the first unmet one is shown as the current goal. */
export interface StoryStep {
  readonly flag: string;
  readonly text: string;
}

export const doneFlag = (npcId: string) => `npc:${npcId}`;

const flagsOf = (g: GameState) => g.flags ?? [];
export const badgeCount = (g: GameState): number => (g.badges ?? []).length;

export function fieldMoveUsable(g: GameState, move: FieldMove): boolean {
  const req = FIELD_MOVES[move];
  return (g.keyItems ?? []).includes(req.item) && (g.badges ?? []).includes(req.badge);
}

export function meets(g: GameState, c: Condition | undefined): boolean {
  if (!c) return true;
  const flags = flagsOf(g);
  if (c.flags && !c.flags.every((f) => flags.includes(f))) return false;
  if (c.notFlags && c.notFlags.some((f) => flags.includes(f))) return false;
  if (c.badges !== undefined && badgeCount(g) < c.badges) return false;
  if (c.keyItems && !c.keyItems.every((k) => (g.keyItems ?? []).includes(k))) return false;
  if (c.fieldMove && !fieldMoveUsable(g, c.fieldMove)) return false;
  return true;
}

export const npcDone = (g: GameState, npc: NpcDef): boolean => flagsOf(g).includes(doneFlag(npc.id));
export const npcVisible = (g: GameState, npc: NpcDef): boolean => meets(g, npc.visibleIf);
export const isBattler = (npc: NpcDef): boolean => npc.kind !== "talk" && npc.kind !== "gift";

/** NPCs standing on this map right now. */
export function visibleNpcs(g: GameState, npcs: readonly NpcDef[] = []): NpcDef[] {
  return npcs.filter((n) => npcVisible(g, n));
}

/**
 * Tiles the party cannot enter: unopened obstacles and every visible NPC (they are talked to from a
 * neighbouring tile). A defeated wild boss is gone.
 */
export function blockedTiles(g: GameState, npcs: readonly NpcDef[] = [], obstacles: readonly ObstacleDef[] = []): Set<string> {
  const out = new Set<string>();
  for (const o of obstacles) if (!meets(g, o.opensIf)) out.add(key(o.pos));
  for (const n of visibleNpcs(g, npcs)) if (!(n.kind === "wild" && npcDone(g, n))) out.add(key(n.pos));
  return out;
}

export function teamOf(g: GameState, npc: NpcDef): readonly TrainerMon[] {
  return (g.starter && npc.teamByStarter?.[g.starter]) || npc.team || [];
}

export function addFlags(g: GameState, flags: readonly string[]): GameState {
  return { ...g, flags: [...new Set([...flagsOf(g), ...flags])] };
}

/** Applies a reward; gift Pokémon are created by the caller (they need content to build members). */
export function applyReward(g: GameState, r: StoryReward | undefined): GameState {
  if (!r) return g;
  const items: Record<string, number> = { ...g.inventory.items };
  for (const [id, n] of Object.entries(r.items ?? {})) items[id] = (items[id] ?? 0) + n;
  const balls: Record<string, number> = { ...g.inventory.balls };
  for (const [id, n] of Object.entries(r.balls ?? {})) balls[id] = (balls[id] ?? 0) + n;
  const keyItems = [...new Set([...(g.keyItems ?? []), ...(r.keyItems ?? [])])].filter((k) => !(r.takesKeyItems ?? []).includes(k));
  const badges = r.badge ? [...new Set([...(g.badges ?? []), r.badge])] : g.badges ?? [];
  return addFlags({ ...g, money: g.money + (r.money ?? 0), inventory: { ...g.inventory, items, balls }, keyItems, badges }, r.flags ?? []);
}

/** Finishing an NPC: its flag plus its reward. */
export function completeNpc(g: GameState, npc: NpcDef, choice?: number, ev?: { readonly trainerWin: number; readonly badge: number; readonly quest: number }): GameState {
  const reward = choice !== undefined ? npc.choices?.[choice]?.reward : npc.reward;
  const done = applyReward(addFlags(g, [doneFlag(npc.id)]), reward);
  if (!ev) return done;
  // EV: badges and the League pay most, other trainers some, helping people a little.
  const gain = npc.kind === "leader" || npc.kind === "elite" || npc.kind === "champion" ? ev.badge : isBattler(npc) ? ev.trainerWin : reward ? ev.quest : 0;
  return { ...done, ev: (done.ev ?? 0) + gain };
}

/** Losing to a grouped NPC (the Elite Four) resets the whole group. */
export function failNpc(g: GameState, npc: NpcDef, allNpcs: readonly NpcDef[]): GameState {
  if (!npc.group) return g;
  const groupFlags = new Set(allNpcs.filter((n) => n.group === npc.group).map((n) => doneFlag(n.id)));
  return { ...g, flags: flagsOf(g).filter((f) => !groupFlags.has(f)) };
}

/** Builds the battle against an NPC's team on an arena. */
export function trainerScenario(
  g: GameState,
  npc: NpcDef,
  arena: { readonly field: FreeField; readonly deploymentZone: readonly Point[]; readonly enemySpawns: readonly Point[] },
  setup: (mon: TrainerMon) => Omit<UnitSetup, "id" | "side" | "pos">,
  maxDeploy: number,
): BattleScenario & { name: string; captureAllowed: boolean; countsKnockouts: boolean } {
  const team = teamOf(g, npc).slice(0, arena.enemySpawns.length);
  return {
    id: `npc-${npc.id}`,
    name: npc.name,
    field: arena.field,
    deploymentZone: arena.deploymentZone,
    enemies: team.map((mon, i) => ({ ...setup(mon), id: `${npc.id}-${i}`, side: "enemy", pos: arena.enemySpawns[i]! })),
    captureAllowed: npc.capture ?? false,
    countsKnockouts: true,
    maxDeploy,
  };
}

export function currentGoal(g: GameState, steps: readonly StoryStep[]): string | null {
  return steps.find((s) => !flagsOf(g).includes(s.flag))?.text ?? null;
}
