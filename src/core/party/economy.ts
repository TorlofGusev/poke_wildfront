import type { BattleContent } from "../battle/content";
import type { StatName } from "../battle/species";
import { resetMasteries, respecCost, spendPoints, type ProgressionContent } from "../progression";
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

/** Fraction of the Poké Mart price paid for items sold back. */
export const SELL_RATE = 0.5;

export function sellPrice(content: BattleContent, prog: ProgressionContent, id: string): number {
  const price = content.balls[id]?.price ?? prog.items[id]?.price;
  if (price === undefined) throw new Error(`${id} cannot be sold`);
  return Math.floor(price * SELL_RATE);
}

/** Sells `qty` of a ball or item from the bag at the Poké Mart for half its price. */
export function sell(content: BattleContent, prog: ProgressionContent, game: GameState, id: string, qty = 1): GameState {
  if (!Number.isInteger(qty) || qty < 1) throw new Error("quantity must be a positive whole number");
  const isBall = !!content.balls[id];
  const bag = isBall ? game.inventory.balls : game.inventory.items;
  if (count(bag, id) < qty) throw new Error(`not enough in the bag (have ${count(bag, id)})`);
  const total = sellPrice(content, prog, id) * qty;
  const next = { ...bag, [id]: count(bag, id) - qty };
  const inventory = isBall ? { ...game.inventory, balls: next } : { ...game.inventory, items: next };
  return { ...game, money: game.money + total, inventory };
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

/** Uses a remedy outside battle: removes knockout marks (the steps towards a permanent loss). */
export function useRemedy(prog: ProgressionContent, game: GameState, uid: string, itemId: string): GameState {
  const item = prog.items[itemId];
  if (item?.kind !== "remedy" || !item.clearsKnockouts) throw new Error(`${itemId} is not a remedy`);
  if (count(game.inventory.items, itemId) < 1) throw new Error(`no ${item.name} in the bag`);
  const member = findMember(game, uid);
  if (!member) throw new Error(`${uid} is not in party or storage`);
  if (member.knockouts <= 0) throw new Error("no knockout marks to remove");
  const next = updateMember(game, uid, (m) => ({ ...m, knockouts: Math.max(0, m.knockouts - item.clearsKnockouts!) }));
  return { ...next, inventory: { ...next.inventory, items: { ...next.inventory.items, [itemId]: count(next.inventory.items, itemId) - 1 } } };
}

/** Applies a change to one member (role, talent, moves) by uid. */
export const withMember = updateMember;

export const CANDY = "candy";

/** Spends one level-up point on any stat; with a Candy from the bag it counts double. */
export function allocatePoint(prog: ProgressionContent, game: GameState, uid: string, stat: StatName, useCandy = false): GameState {
  if (!findMember(game, uid)) throw new Error(`${uid} is not in party or storage`);
  let items = game.inventory.items;
  if (useCandy) {
    if (count(items, CANDY) < 1) throw new Error("no Candy in the bag");
    items = { ...items, [CANDY]: count(items, CANDY) - 1 };
  }
  const amount = 1 + (useCandy ? prog.rules.candyBonus : 0);
  const next = updateMember(game, uid, (m) => spendPoints(m, stat, amount, 1));
  return { ...next, inventory: { ...next.inventory, items } };
}

/** Forgets a member's role and masteries for Pokédollars, so they can be chosen again. */
export function respecMember(content: BattleContent, prog: ProgressionContent, game: GameState, uid: string): GameState {
  const member = findMember(game, uid);
  if (!member) throw new Error(`${uid} is not in party or storage`);
  if (member.role === null) throw new Error("nothing to reset");
  const cost = respecCost(prog, member);
  if (game.money < cost) throw new Error(`not enough money (need ₽${cost}, have ₽${game.money})`);
  return { ...updateMember(game, uid, (m) => resetMasteries(content, m)), money: game.money - cost };
}
