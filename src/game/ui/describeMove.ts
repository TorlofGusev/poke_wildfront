import type { BattleContent, MoveDef } from "../../core/battle";
import { tag } from "./markup";

/** Rules text (with colour markup) generated from move data, so it never drifts from the rules. */
export function describeMove(content: BattleContent, move: MoveDef): string {
  const kind =
    move.kind === "basic" ? `${tag("basic", "Basic attack")} · usable every turn`
    : move.kind === "special" ? `${tag("special", "Special")} · ${tag("num", move.cooldown ?? 0)}-turn cooldown`
    : `${tag("ultimate", "Ultimate")} · once per battle`;
  const range = move.range.min === move.range.max ? `${move.range.max}` : `${move.range.min}–${move.range.max}`;
  const shape =
    move.shape.kind === "single" ? "single target"
    : move.shape.kind === "burst" ? `area: target tile + ${tag("num", move.shape.radius)} around it`
    : `line: ${tag("num", move.shape.length)} tiles in a straight direction, stopped by rocks`;
  const lines = [
    `${tag("title", move.name)} — ${tag(move.type, move.type.toUpperCase())}`,
    kind,
    `Range ${tag("num", range)} · ${shape}${move.requiresLineOfSight ? " · needs line of sight" : ""}`,
    move.power > 0 ? `Power ${tag("dmg", move.power)} · always hits` : tag("dim", "No damage"),
  ];
  for (const e of move.effects ?? []) {
    switch (e.kind) {
      case "push": lines.push(`Pushes ${tag("num", e.distance)} tile${e.distance > 1 ? "s" : ""} away; hitting an obstacle deals ${tag("dmg", content.rules.impactDamage)} damage`); break;
      case "pull": lines.push(`Pulls up to ${tag("num", e.distance)} tiles towards the user`); break;
      case "heal": lines.push(`Heals ${tag("heal", `${e.amount} HP`)}`); break;
      case "status": {
        const st = content.statuses[e.status];
        const what = st?.damagePerTurn ? `loses ${Math.round(st.damagePerTurn * 100)}% max HP each turn`
          : st?.movePenalty ? `−${st.movePenalty} movement` : "";
        lines.push(`Inflicts ${tag("status", st?.name ?? e.status)} for ${tag("num", e.duration)} turn${e.duration > 1 ? "s" : ""}${what ? ` (${what})` : ""}`);
        break;
      }
    }
  }
  lines.push(tag("dim", `Affects ${move.affects === "enemies" ? "enemies only" : "allies"}`));
  return lines.join("\n");
}
