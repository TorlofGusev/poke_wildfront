import type { BattleContent, MoveDef } from "../../core/battle";

/** Human-readable rules text generated from move data, so it never drifts from the rules. */
export function describeMove(content: BattleContent, move: MoveDef): string {
  const kind =
    move.kind === "basic" ? "Basic attack · usable every turn"
    : move.kind === "special" ? `Special · ${move.cooldown}-turn cooldown`
    : "Ultimate · once per battle";
  const range = move.range.min === move.range.max ? `${move.range.max}` : `${move.range.min}–${move.range.max}`;
  const shape =
    move.shape.kind === "single" ? "single target"
    : move.shape.kind === "burst" ? `area: target tile + ${move.shape.radius} around it`
    : `line: ${move.shape.length} tiles in a straight direction, stopped by rocks`;
  const lines = [
    `${move.name} — ${move.type.toUpperCase()}`,
    kind,
    `Range ${range} · ${shape}${move.requiresLineOfSight ? " · needs line of sight" : ""}`,
    move.power > 0 ? `Power ${move.power} · always hits` : "No damage",
  ];
  for (const e of move.effects ?? []) {
    switch (e.kind) {
      case "push": lines.push(`Pushes ${e.distance} tile${e.distance > 1 ? "s" : ""} away; hitting an obstacle deals ${content.rules.impactDamage} damage`); break;
      case "pull": lines.push(`Pulls up to ${e.distance} tiles towards the user`); break;
      case "heal": lines.push(`Heals ${e.amount} HP`); break;
      case "status": {
        const st = content.statuses[e.status];
        const what = st?.damagePerTurn ? `loses ${Math.round(st.damagePerTurn * 100)}% max HP each turn`
          : st?.movePenalty ? `−${st.movePenalty} movement` : "";
        lines.push(`Inflicts ${st?.name ?? e.status} for ${e.duration} turn${e.duration > 1 ? "s" : ""}${what ? ` (${what})` : ""}`);
        break;
      }
    }
  }
  lines.push(`Affects ${move.affects === "enemies" ? "enemies only" : "allies"}`);
  return lines.join("\n");
}
