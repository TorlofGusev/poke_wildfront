import type { BattleContent } from "../battle/content";
import type { StatName } from "../battle/species";
import { spendPoints, type ProgressionContent } from "../progression";
import { memberMaxHp, type GameState, type PartyMember } from "./roster";

const count = (bag: Readonly<Record<string, number>>, id: string) => bag[id] ?? 0;

/** Buys `qty` of a ball or item at the Poké Mart. */
export function buy(content: BattleContent, prog: ProgressionContent, game: GameState, id: string, qty = 1): GameState {
  if (!Number.isInteger(qty) || qty < 1) throw new Error("quantity must be a positive whole number");
  const ball = content.balls[id];
  const item = prog.items[id];
  const price = ball?.price ?? item?.price;
  if (price === undefined) throw new Error(`${id} is not sold here`);
  const total = price * qty;
  if (game.money < total) throw new Error(`not enough money (need ₽${total}, have ₽${game.money})`);
  const inventory = ball
    ? { ...game.inventory, balls: { ...game.inventory.balls, [id]: count(game.inventory.balls, id) + qty } }
    : { ...game.inventory, items: { ...game.inventory.items, [id]: count(game.inventory.items, id) + qty } };
  return { ...game, money: game.money - total, inventory };
}

function updateMember(game: GameState, uid: string, f: (m: PartyMember) => PartyMember): GameState {
  const inParty = game.roster.party.some((m) => m.uid === uid);
  const inStorage = game.roster.storage.some((m) => m.uid === uid);
  if (!inParty && !inStorage) throw new Error(`${uid} is not in party or storage`);
  return {
    ...game,
    roster: {
      ...game.roster,
      party: game.roster.party.map((m) => (m.uid === uid ? f(m) : m)),
      storage: game.roster.storage.map((m) => (m.uid === uid ? f(m) : m)),
    },
  };
}

export function findMember(game: GameState, uid: string): PartyMember | undefined {
  return [...game.roster.party, ...game.roster.storage].find((m) => m.uid === uid);
}

/** Gives a held item from the bag to a Pokémon (its previous item returns to the bag). `null` takes the item off. */
export function equipItem(prog: ProgressionContent, game: GameState, uid: string, itemId: string | null): GameState {
  const member = findMember(game, uid);
  if (!member) throw new Error(`${uid} is not in party or storage`);
  const items: Record<string, number> = { ...game.inventory.items };
  if (itemId !== null) {
    if (prog.items[itemId]?.kind !== "held") throw new Error(`${itemId} cannot be held`);
    if (count(items, itemId) < 1) throw new Error(`no ${prog.items[itemId]!.name} in the bag`);
    items[itemId] = count(items, itemId) - 1;
  }
  if (member.heldItem) items[member.heldItem] = count(items, member.heldItem) + 1;
  const next = updateMember(game, uid, (m) => ({ ...m, heldItem: itemId }));
  return { ...next, inventory: { ...next.inventory, items } };
}

/** Uses a potion outside battle. Fainted Pokémon cannot be revived with potions. */
export function usePotion(content: BattleContent, prog: ProgressionContent, game: GameState, uid: string, itemId: string): GameState {
  const item = prog.items[itemId];
  if (item?.kind !== "potion" || !item.heal) throw new Error(`${itemId} is not a potion`);
  if (count(game.inventory.items, itemId) < 1) throw new Error(`no ${item.name} in the bag`);
  const member = findMember(game, uid);
  if (!member) throw new Error(`${uid} is not in party or storage`);
  if (member.hp <= 0) throw new Error("a fainted Pokémon needs rest at camp, not a potion");
  const max = memberMaxHp(content, prog, member);
  if (member.hp >= max) throw new Error("already at full HP");
  const next = updateMember(game, uid, (m) => ({ ...m, hp: Math.min(max, m.hp + item.heal!) }));
  return { ...next, inventory: { ...next.inventory, items: { ...next.inventory.items, [itemId]: count(next.inventory.items, itemId) - 1 } } };
}

/** Applies a change to one member (role, talent, moves) by uid. */
export const withMember = updateMember;

/** Spends one level-up point on a stat; with a matching vitamin from the bag it counts double. */
export function allocatePoint(
  prog: ProgressionContent, game: GameState, uid: string, stat: StatName, vitaminId: string | null = null,
): GameState {
  const member = findMember(game, uid);
  if (!member) throw new Error(`${uid} is not in party or storage`);
  let amount = 1;
  let items = game.inventory.items;
  if (vitaminId) {
    const v = prog.items[vitaminId];
    if (v?.kind !== "vitamin" || v.stat !== stat) throw new Error(`${vitaminId} does not boost ${stat}`);
    if (count(items, vitaminId) < 1) throw new Error(`no ${v.name} in the bag`);
    items = { ...items, [vitaminId]: count(items, vitaminId) - 1 };
    amount += prog.rules.vitaminBonus;
  }
  const next = updateMember(game, uid, (m) => spendPoints(m, stat, amount, 1));
  return { ...next, inventory: { ...next.inventory, items } };
}
