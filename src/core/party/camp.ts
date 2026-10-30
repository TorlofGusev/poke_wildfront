import type { BattleContent, UnitModifiers } from "../battle";
import { makeCamp, type ActiveMeal, type WorldContent, type WorldDef } from "../expedition/world";
import type { ProgressionContent } from "../progression";
import { memberMaxHp, type GameState, type PartyMember } from "./roster";

/** A camp recipe: ingredients from the bag, and an effect that lasts until the next rest. */
export interface MealDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly ingredients: Readonly<Record<string, number>>;
  readonly bond?: { readonly startBond?: number; readonly maxBond?: number };
  readonly mods?: Partial<UnitModifiers>;
}

export interface CampRules {
  /** Pokémon Center treatment price per knockout mark. */
  readonly treatmentPerMark: number;
  /** Each berry of an area's forage turns up after a won wild battle with this chance. */
  readonly forageChance: number;
  /** Resting without a meal: fraction of max HP restored, fatigue left, and the lasting penalty. */
  readonly hungry: {
    readonly hpFraction: number;
    readonly fatigue: number;
    readonly effect: Omit<MealDef, "ingredients">;
  };
}

export function canCook(game: GameState, meal: MealDef): boolean {
  return Object.entries(meal.ingredients).every(([id, n]) => (game.inventory.items[id] ?? 0) >= n);
}

/**
 * Rests at the current tile. With a meal: ingredients are used, HP and fatigue fully restored,
 * and the meal's effect lasts until the next rest. Without: partial rest and a hunger penalty.
 * Either way wild groups move and this becomes the respawn point.
 */
export function rest(
  content: BattleContent,
  prog: ProgressionContent,
  world: { content: WorldContent; def: WorldDef },
  rules: CampRules,
  game: GameState,
  meal: MealDef | null,
): GameState {
  if (meal && !canCook(game, meal)) throw new Error(`not enough ingredients for ${meal.name}`);
  const items: Record<string, number> = { ...game.inventory.items };
  for (const [id, n] of Object.entries(meal?.ingredients ?? {})) items[id] = (items[id] ?? 0) - n;
  const fraction = meal ? 1 : rules.hungry.hpFraction;
  const heal = (m: PartyMember): PartyMember => {
    const max = memberMaxHp(content, prog, m);
    return { ...m, hp: Math.min(max, Math.max(m.hp, Math.round(max * fraction))) };
  };
  const effect = meal ?? rules.hungry.effect;
  const active: ActiveMeal = { id: effect.id, name: effect.name, ...(effect.bond && { bond: effect.bond }), ...(effect.mods && { mods: effect.mods }) };
  const camped = makeCamp(world.content, world.def, game.world);
  return {
    ...game,
    inventory: { ...game.inventory, items },
    roster: { ...game.roster, party: game.roster.party.map(heal), storage: game.roster.storage.map(heal) },
    world: { ...camped, fatigue: meal ? 0 : rules.hungry.fatigue, meal: active },
  };
}

/** Town healing (Pokémon Center): every party and storage member back to full HP, free. */
export function centerHeal(content: BattleContent, prog: ProgressionContent, game: GameState): GameState {
  const heal = (m: PartyMember): PartyMember => ({ ...m, hp: memberMaxHp(content, prog, m) });
  return { ...game, roster: { ...game.roster, party: game.roster.party.map(heal), storage: game.roster.storage.map(heal) } };
}

/** Pokémon Center treatment: removes every knockout mark in the party for a price per mark. */
export function centerTreatmentCost(game: GameState, pricePerMark: number): number {
  return game.roster.party.reduce((n, m) => n + m.knockouts, 0) * pricePerMark;
}

export function centerTreatment(game: GameState, pricePerMark: number): GameState {
  const cost = centerTreatmentCost(game, pricePerMark);
  if (cost <= 0) throw new Error("no knockout marks to treat");
  if (game.money < cost) throw new Error(`not enough money (need ₽${cost}, have ₽${game.money})`);
  return { ...game, money: game.money - cost, roster: { ...game.roster, party: game.roster.party.map((m) => ({ ...m, knockouts: 0 })) } };
}
