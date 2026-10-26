import { CONTENT, PROGRESSION } from "../content";
import { addPokemon, newMember, type GameState } from "../core/party";
import type { StoryReward } from "../core/story";
import { t } from "./i18n";

/** Gift Pokémon of a reward join the party (or storage); returns readable notes for the reward. */
export function grantGifts(game: GameState, reward: StoryReward | undefined): { game: GameState; notes: string[] } {
  const notes: string[] = [];
  let g = game;
  for (const gift of reward?.pokemon ?? []) {
    const member = newMember(CONTENT, PROGRESSION, gift.species, g.nextUid, gift.level, undefined, true);
    const added = addPokemon({ ...g, nextUid: g.nextUid + 1 }, member);
    g = added.game;
    notes.push(t(added.to === "party" ? "{name} joined your party!" : "{name} joined storage!", { name: CONTENT.species[gift.species]!.name }));
  }
  if (reward?.badge) notes.push(t("Earned the {badge} Badge!", { badge: `${reward.badge[0]!.toUpperCase()}${reward.badge.slice(1)}` }));
  for (const k of reward?.keyItems ?? []) notes.push(t("Got {item}!", { item: PROGRESSION.keyItems?.[k]?.name ?? k }));
  if (reward?.money) notes.push(`+₽${reward.money}.`);
  for (const [id, n] of Object.entries(reward?.items ?? {})) notes.push(t("Got {n} {item}.", { n, item: PROGRESSION.items[id]?.name ?? id }));
  return { game: g, notes };
}
