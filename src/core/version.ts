import pkg from "../../package.json";

/** Kept in package.json; the minor number follows the published build. */
export const GAME_VERSION: string = pkg.version;

export const DISCLAIMER =
  "Unofficial fan game. Not affiliated with or endorsed by Nintendo, " +
  "Game Freak, Creatures Inc. or The Pokémon Company.";

/** The full legal notice at the top of the Credits screen. */
export const LEGAL_NOTICE =
  "Legal notice: Pokémon Wildfront is an unofficial, free, non-commercial fan project. Pokémon, the Pokémon " +
  "names, characters and related marks are trademarks and copyrights of Nintendo, Game Freak, Creatures Inc. " +
  "and The Pokémon Company. This project is not affiliated with, endorsed or sponsored by them, makes no money " +
  "and accepts no payments or donations. All rights to the original works stay with their owners.";
