import pkg from "../../package.json";

/** Kept in package.json; the minor number follows the published build. */
export const GAME_VERSION: string = pkg.version;

export const DISCLAIMER =
  "Unofficial fan game. Not affiliated with or endorsed by Nintendo, " +
  "Game Freak, Creatures Inc. or The Pokémon Company.";
