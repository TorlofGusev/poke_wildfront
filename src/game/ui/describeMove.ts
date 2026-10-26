import type { BattleContent, MoveDef, StatusDef } from "../../core/battle";
import { tag } from "./markup";

/** Rules text (with colour markup) generated from move data, so it never drifts from the rules. */
export function describeMove(content: BattleContent, move: MoveDef): string {
  const kind =
    move.kind === "basic" ? `${tag("basic", "Basic attack")} · usable every turn`
    : move.kind === "special" ? `${tag("special", "Special")} · ${tag("num", move.cooldown ?? 0)}-turn cooldown`
    : move.kind === "bond" ? `${tag("ultimate", content.terms.bond)} · costs ${tag("num", move.bondCost ?? 0)} team ${content.terms.bond}`
    : `${tag("ultimate", "Ultimate")} · once per battle`;
  const range = move.range.min === move.range.max ? `${move.range.max}` : `${move.range.min}–${move.range.max}`;
  const shape =
    move.shape.kind === "single" ? "single target"
    : move.shape.kind === "burst" ? `area: target tile + ${tag("num", move.shape.radius)} around it`
    : `line: ${tag("num", move.shape.length)} tiles in a straight direction, stopped by rocks`;
  const lines = [
    `${tag("title", move.name)} — ${tag(move.type, move.type.toUpperCase())}`,
    kind,
    `Range ${tag("num", range)} · ${shape}${move.requiresLineOfSight ? " · needs line of sight (Pokémon in the way block it)" : ""}`,
    move.power > 0 ? `Power ${tag("dmg", move.power)} ${tag("dim", "(hover a target to see the exact damage)")}` : tag("dim", "No damage"),
  ];
  if (move.id === "struggle") lines.push(`Fallback while engaged when the basic attack is ranged: its basic attack's type at ${tag("num", `${Math.round(content.rules.engagement.fallbackPower * 100)}%`)} power`);
  for (const e of move.effects ?? []) {
    switch (e.kind) {
      case "push": lines.push(`Pushes ${tag("num", e.distance)} tile${e.distance > 1 ? "s" : ""} away; hitting an obstacle deals ${tag("dmg", content.rules.impactDamage)} damage`); break;
      case "pull": lines.push(`Pulls up to ${tag("num", e.distance)} tiles towards the user`); break;
      case "heal": lines.push(`Heals ${tag("heal", `${e.amount} HP`)}`); break;
      case "engage": lines.push(`${tag("bad", "Engages")} the target (taking it over from any other engagement): they may only attack each other`); break;
      case "bond": lines.push(`${tag("good", `+${e.amount} Bond`)} if it ${e.when === "combo" ? "lands a combo (hits a foe an ally set up)" : "knocks a foe out"}`); break;
      case "disengage": lines.push(`Ends the user's engagement ${tag("good", "without a free attack")}`); break;
      case "status": {
        const st = content.statuses[e.status];
        const verb = move.affects === "allies" ? "Grants" : "Inflicts";
        const what = st ? statusEffectText(st) : "";
        lines.push(`${verb} ${tag("status", st?.name ?? e.status)} for ${tag("num", e.duration)} turn${e.duration > 1 ? "s" : ""}${what ? ` (${what})` : ""}`);
        break;
      }
    }
  }
  const typeRule = content.types[move.type]?.summary?.split(". ").slice(1).join(". ");
  if (typeRule && move.affects === "enemies") lines.push(`${tag(move.type, "Type")}: ${typeRule}`);
  lines.push(tag("dim", move.range.max === 0 && move.affects === "allies" ? "Targets itself" : `Affects ${move.affects === "enemies" ? "enemies only" : "allies"}`));
  return lines.join("\n");
}

/** What a status does, in exact numbers. Durations count the affected Pokémon's own turns. */
export function statusEffectText(st: StatusDef): string {
  const parts: string[] = [];
  if (st.damagePerTurn) parts.push(`loses ${Math.round(st.damagePerTurn * 100)}% max HP each turn`);
  if (st.movePenalty) parts.push(st.movePenalty > 0 ? `−${st.movePenalty} movement` : `+${-st.movePenalty} movement`);
  if (st.noMove) parts.push("cannot move");
  if (st.noAction) parts.push("cannot use moves");
  if (st.damageDealt !== undefined && st.damageDealt !== 1) parts.push(`${st.damageDealt > 1 ? "+" : "−"}${Math.round(Math.abs(st.damageDealt - 1) * 100)}% damage dealt`);
  if (st.damageTaken !== undefined && st.damageTaken !== 1)
    parts.push(st.damageTaken === 0 ? "takes no damage" : `${st.damageTaken > 1 ? "+" : "−"}${Math.round(Math.abs(st.damageTaken - 1) * 100)}% damage taken`);
  if (st.stacks) parts.push("stacks");
  return parts.join(", ");
}
