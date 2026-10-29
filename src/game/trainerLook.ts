/** The trainer classes drawn on the map (trainerSprites.ts dresses each one). */
export const LOOK_IDS = [
  "youngster", "bug", "hiker", "camper", "lass", "picnicker", "beauty", "swimmer", "sailor", "fisherman", "biker", "blackbelt", "channeler", "psychic", "scientist", "gentleman", "rocket", "cooltrainer", "leader", "elite", "rival", "trainer",
] as const;
export type LookId = (typeof LOOK_IDS)[number];

/** Names whose first word is not a class of its own, mapped to the closest look. */
const ALIAS: Readonly<Record<string, LookId>> = {
  team: "rocket", karate: "blackbelt", cue: "biker", juggler: "gentleman", tamer: "hiker", gambler: "gentleman",
  engineer: "hiker", burglar: "biker", pokmaniac: "psychic", super: "scientist", bird: "camper", jr: "youngster", lt: "leader", gym: "leader",
};

const isLook = (id: string): id is LookId => (LOOK_IDS as readonly string[]).includes(id);

/** Which look a trainer gets: from the first word of the name ("Bug Catcher Rick" → bug), else the NPC kind. */
export function trainerLook(name: string, kind: string): LookId {
  const word = (name.split(/\s+/)[0] ?? "").toLowerCase().replace(/[^a-z]/g, "");
  const id = ALIAS[word] ?? word;
  if (isLook(id)) return id;
  if (kind === "leader") return "leader";
  if (kind === "elite" || kind === "champion") return "elite";
  if (kind === "rocket" || kind === "rival") return kind;
  return "trainer";
}
