// Downloads the Gen 1 ("legacy") Pokémon cries #1–#151 from the PokeAPI cries repository.
// Usage: node tools/fetch-cries.mjs   (needs network access to raw.githubusercontent.com)
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const BASE = "https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/legacy";
const OUT = "src/assets/cries";
mkdirSync(OUT, { recursive: true });
let fetched = 0;
for (let dex = 1; dex <= 151; dex++) {
  const file = `${OUT}/${String(dex).padStart(4, "0")}.ogg`;
  if (existsSync(file)) continue;
  const res = await fetch(`${BASE}/${dex}.ogg`);
  if (!res.ok) {
    console.warn(`#${dex}: HTTP ${res.status}`);
    continue;
  }
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  fetched++;
}
console.log(`fetched ${fetched} cries`);
