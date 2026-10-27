// Builds src/content/mastery/moves.json: one definition per canon move a Kanto line can learn (Let's Go style).
// Canon name, type and category come from tools/data/canon-moves.json (PokeAPI); power follows the canon power
// formula (rules.json movePower). Battle mechanics are kept from an existing hand-tuned definition of the same
// move when there is one, else derived from the canon data (target, ailment, stat changes, healing).
// Usage: node tools/build-move-library.mjs   (re-run after changing the canon data or the formula)
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const canon = read("tools/data/canon-moves.json");
const rules = read("src/content/rules.json");
const base = read("src/content/moves.json");
const f = rules.movePower;

const slug = (name) => name.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").replace(/^mimic-/, "");
const hitsOf = (c) => (c.max && c.max > 1 ? (c.min === c.max ? c.max : 3) : 1);
const powerOf = (m, canonPower) => {
  const shape = m.shape.kind === "burst" ? (m.shape.radius >= 2 ? f.burst2 : f.burst1) : m.shape.kind === "line" ? f.line : 1;
  const reach = m.range.max >= 3 ? f.range3 : m.range.max === 2 ? f.range2 : 1;
  const kind = m.kind === "basic" ? f.basic : m.kind === "bond" || m.kind === "ultimate" ? f.paid : 1;
  return Math.min(f.max, Math.max(f.round, Math.round((f.scale * canonPower ** f.exponent * shape * reach * kind) / f.round) * f.round));
};

// Existing hand-tuned mechanics, by canon slug: the library's own previous output.
const existing = new Map();
const lib = "src/content/mastery/moves.json";
if (fs.existsSync(path.join(root, lib))) for (const d of Object.values(read(lib))) existing.set(slug(d.name), d);

// Canon → battle mechanics for moves nobody tuned yet.
const STATUS = { paralysis: ["paralysis", 1], burn: ["burn", 2], freeze: ["freeze", 1], poison: ["poison", 3], sleep: ["sleep", 2], confusion: ["confused", 1], trap: ["slow", 1] };
const SELF_BUFF = { attack: "focused", "special-attack": "focused", defense: "fortified", "special-defense": "fortified", speed: "hasted", evasion: "fortified" };
const FOE_DEBUFF = { attack: "weakened", "special-attack": "weakened", defense: "exposed", "special-defense": "exposed", speed: "slow", accuracy: "marked" };
const RANGED_PHYSICAL = new Set(["rock-throw", "rock-slide", "rock-tomb", "stone-edge", "pin-missile", "bonemerang", "bone-club", "bone-rush", "seed-bomb", "bullet-seed", "egg-bomb", "barrage", "spike-cannon", "razor-leaf", "icicle-spear", "icicle-crash", "poison-sting", "twineedle", "sand-tomb", "fling", "rock-blast", "smack-down", "gunk-shot", "sky-attack", "aerial-ace"]);
function derive(id, c) {
  const status = c.cls === "status";
  const toAllies = ["user", "ally", "user-and-allies", "users-field", "user-or-ally", "all-allies"].includes(c.target);
  const area = ["all-opponents", "all-other-pokemon", "all-pokemon", "opponents-field", "entire-field"].includes(c.target);
  const selfOnly = c.target === "user" || c.target === "users-field";
  const effects = [];
  const ail = STATUS[c.ailment];
  if (ail && (status || (c.ailmentChance ?? 0) >= 30)) effects.push({ kind: "status", status: ail[0], duration: ail[1] });
  for (const part of (c.stat || "").split(",").filter(Boolean)) {
    const [stat, ch] = part.split(":");
    const up = Number(ch) > 0;
    if (up && toAllies && SELF_BUFF[stat] && !effects.some((e) => e.status === SELF_BUFF[stat])) effects.push({ kind: "status", status: SELF_BUFF[stat], duration: 2 });
    if (!up && !toAllies && FOE_DEBUFF[stat] && (status || c.effect.includes("100%") || !/chance/.test(c.effect)) && !effects.some((e) => e.status === FOE_DEBUFF[stat]))
      effects.push({ kind: "status", status: FOE_DEBUFF[stat], duration: 2 });
  }
  if (c.healing > 0) effects.push({ kind: "heal", amount: Math.round(c.healing * 0.7) });
  if (id === "protect" || id === "detect") effects.push({ kind: "status", status: "protected", duration: 1 });
  const melee = c.cls === "physical" && !RANGED_PHYSICAL.has(id);
  const range = toAllies ? (selfOnly ? { min: 0, max: 0 } : { min: 0, max: 2 })
    : area ? { min: 0, max: 0 }
    : melee ? { min: 1, max: 1 } : { min: 1, max: 2 };
  const shape = area || (toAllies && !selfOnly && c.target !== "ally" && c.target !== "user-or-ally") ? { kind: "burst", radius: 1 } : { kind: "single" };
  const power = c.power ?? 0;
  const cooldown = status ? 3 : power >= 110 ? 4 : power >= 80 ? 3 : 2;
  return {
    id, name: c.name, type: c.type, kind: "special", power: 0, range, requiresLineOfSight: !toAllies && !melee && !area,
    shape, affects: toAllies ? "allies" : "enemies", cooldown, ...(effects.length && { effects }),
  };
}

const out = {};
// Moves whose whole point is a mechanic the game doesn't have (held items, weather, terrain, switching
// partners, team rounds, IVs): no empty names in the library. Pursuit lives on as a passive.
const EXCLUDED = new Set([
  "thief", "covet", "knock-off", "incinerate", "pluck", "poltergeist", "acrobatics", "belch", "fling",
  "weather-ball", "terrain-pulse", "grassy-glide", "rising-voltage", "expanding-force", "misty-explosion", "steel-roller", "secret-power",
  "sandstorm", "rain-dance", "sunny-day", "hail", "snowscape", "grassy-terrain", "electric-terrain", "psychic-terrain", "baton-pass",
  "round", "echoed-voice", "grass-pledge", "fire-pledge", "water-pledge", "hidden-power", "dive", "snore", "pursuit",
]);
/** Moves whose point is their reach (Taunt calls a foe from afar). */
const LONG_REACH = new Set(["taunt"]);
let kept = 0, made = 0, dropped = 0;
for (const [id, c] of Object.entries(canon).sort(([a], [b]) => a.localeCompare(b))) {
  if (!c || base[id] || EXCLUDED.has(id)) continue; // base moves stay in moves.json
  const old = existing.get(id);
  const def = old ? { ...old } : derive(id, c);
  old ? kept++ : made++;
  def.id = id;
  def.name = c.name;
  def.type = c.type;
  if (c.cls !== "status") def.category = c.cls; else delete def.category;
  if (def.kind !== "bond" && def.kind !== "ultimate") def.kind = "special";
  delete def.bondCost;
  if (def.kind === "bond" || def.kind === "ultimate") def.kind = "special";
  def.cooldown ??= c.power >= 110 ? 4 : c.power >= 80 ? 3 : 2;
  // Reach cap for ordinary skills (bond moves may go further, see content tests): range + area ≤ 2.
  if (def.range.max > 2 && !LONG_REACH.has(id)) def.range = { ...def.range, max: 2 };
  if (def.shape.kind === "line" && def.shape.length > 2) def.shape = { kind: "line", length: 2 };
  if (def.shape.kind === "burst" && def.range.max + def.shape.radius > 2) def.range = { min: Math.min(def.range.min, Math.max(0, 2 - def.shape.radius)), max: Math.max(0, 2 - def.shape.radius) };
  if (c.power && c.cls !== "status") {
    def.canonPower = c.power * hitsOf(c);
    def.power = powerOf(def, def.canonPower);
  } else {
    delete def.canonPower;
    if (c.cls === "status") def.power = 0;
  }
  // No damage and no effect: nothing behind the name (Mimic, Helping Hand, Return…).
  if (!def.power && !def.effects?.length) { dropped++; continue; }
  out[id] = def;
}
fs.writeFileSync(path.join(root, "src/content/mastery/moves.json"), JSON.stringify(out, null, 1) + "\n");
console.log(`moves ${Object.keys(out).length} (kept tuned mechanics ${kept}, derived ${made}; dropped ${dropped} with no effect)`);
