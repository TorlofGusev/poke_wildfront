import type { BattleContent, MoveDef, StatusDef } from "../../core/battle";
import { t } from "../i18n";
import { tag } from "./markup";

/** Rules text (with colour markup) generated from move data, so it never drifts from the rules. */
export function describeMove(content: BattleContent, move: MoveDef): string {
  const bond = content.terms.bond;
  const kind =
    move.kind === "basic" ? t("{x} · usable every turn", { x: tag("basic", t("Basic attack")) })
    : move.kind === "special" ? t("{x} · {n}-turn cooldown", { x: tag("special", t("Special")), n: tag("num", move.cooldown ?? 0) })
    : move.kind === "bond" ? t("{x} · costs {n} team {bond}", { x: tag("ultimate", bond), n: tag("num", move.bondCost ?? 0), bond })
    : t("{x} · once per battle", { x: tag("ultimate", t("Ultimate")) });
  const range = move.range.min === move.range.max ? `${move.range.max}` : `${move.range.min}–${move.range.max}`;
  const shape =
    move.shape.kind === "single" ? t("single target")
    : move.shape.kind === "burst" ? t("area: a circle of radius {n} around the aim", { n: tag("num", move.shape.radius) })
    : move.shape.kind === "cone" ? t("cone: {n} long, {a}° wide, hits everyone in it", { n: tag("num", move.shape.length), a: tag("num", move.shape.angle) })
    : t("line: {n} long in a straight direction, stopped by rocks and bushes", { n: tag("num", move.shape.length) });
  const los = move.requiresLineOfSight ? t(" · needs line of sight (Pokémon in the way block it)") : "";
  const lines = [
    `${tag("title", move.name)} — ${tag(move.type, move.type.toUpperCase())}`,
    kind,
    t("Range {n} · {shape}{los}", { n: tag("num", range), shape, los }),
    move.currentHpDamage ? t("Deals {n} of the target's current HP, whatever the stats and type", { n: tag("dmg", `${Math.round(move.currentHpDamage * 100)}%`) })
    : move.power > 0 ? t("Power {n} {hint}", { n: tag("dmg", move.power), hint: tag("dim", t("(hover a target to see the exact damage)")) }) : tag("dim", t("No damage")),
  ];
  if (move.hits) lines.push(t("Hits {n} times, its power split between them; each hit can be critical", { n: tag("num", move.hits) }));
  if (move.recoil) lines.push(t("Recoil: the user takes {n} of the damage it deals", { n: tag("bad", `${Math.round(move.recoil * 100)}%`) }));
  if (move.selfStatus) lines.push(t("Price: the user becomes {status} for {n} turns", { status: tag("status", content.statuses[move.selfStatus.status]?.name ?? move.selfStatus.status), n: tag("num", move.selfStatus.duration) }));
  if (move.nonLethal) lines.push(t("Never knocks out: leaves the target at 1 HP at least (handy for catching)"));
  if (move.statusedPower) lines.push(t("Hits harder while the user has an ailment: {n} power", { n: tag("dmg", Math.round(move.power * (1 + move.statusedPower))) }));
  if (move.ignoresBuffs) lines.push(t("Ignores the target's protective buffs"));
  if (move.vsLowHpPower) lines.push(t("Hits harder the more HP the target has lost: up to {n} power against a target at 0 HP", { n: tag("dmg", Math.round(move.power * (1 + move.vsLowHpPower))) }));
  if (move.vsFullHpPower) lines.push(t("Hits harder the more HP the target has left: {n} power against a target at full HP", { n: tag("dmg", Math.round(move.power * (1 + move.vsFullHpPower))) }));
  if (move.lowHpPower) lines.push(t("Hits harder the more HP the user has lost: up to {n} power at 0 HP", { n: tag("dmg", Math.round(move.power * (1 + move.lowHpPower))) }));
  if (move.timing === "delayed") lines.push(t("{x}: marks the ground now and strikes it at the start of its next turn, hitting whoever stands there (friend or foe)", { x: tag("special", t("Delayed")) }));
  if (move.timing === "watch") lines.push(t("{x}: guards the area until its next turn; the first foe moving in it is struck and stopped", { x: tag("special", t("Watch")) }));
  if (move.id === "struggle") lines.push(t("Fallback while engaged when the basic attack is ranged: its basic attack's type at {n} power", { n: tag("num", `${Math.round(content.rules.engagement.fallbackPower * 100)}%`) }));
  for (const e of move.effects ?? []) {
    switch (e.kind) {
      case "push": {
        const vars = { n: tag("num", e.distance), dmg: tag("dmg", content.rules.impactDamage) };
        lines.push(e.distance > 1
          ? t("Pushes {n} away; hitting an obstacle deals {dmg} damage", vars)
          : t("Pushes {n} away; hitting an obstacle deals {dmg} damage", vars));
        break;
      }
      case "pull": lines.push(t("Pulls up to {n} towards the user", { n: tag("num", e.distance) })); break;
      case "heal": lines.push(move.affects === "any" ? t("On an ally: heals {x} instead of damaging", { x: tag("heal", `${e.amount} HP`) }) : t("Heals {x}", { x: tag("heal", `${e.amount} HP`) })); break;
      case "healShare": lines.push(t("On an ally: heals {x} of its max HP instead of damaging", { x: tag("heal", `${Math.round(e.share * 100)}%`) })); break;
      case "drain": lines.push(t("Heals the user by {n} of the damage dealt", { n: tag("heal", `${Math.round(e.amount * 100)}%`) })); break;
      case "engage": lines.push(t("{x} the target (taking it over from any other engagement): they may only attack each other", { x: tag("bad", t("Engages")) })); break;
      case "bond": {
        const x = tag("good", t("+{n} Bond", { n: e.amount }));
        lines.push(e.when === "combo" ? t("{x} if it lands a combo (hits a foe an ally set up)", { x }) : t("{x} if it knocks a foe out", { x }));
        break;
      }
      case "cleanse": lines.push(t("Removes the statuses foes put on the target")); break;
      case "dispel": lines.push(t("Strips the target's buffs")); break;
      case "swap": lines.push(t("The user and the ally trade places; both leave their engagements {x}", { x: tag("good", t("without a free attack")) })); break;
      case "zone": {
        const turns = tag("num", content.rules.zones.turns);
        lines.push(e.hazard === "fire" ? t("Sets the ground on fire (radius {r}) for {n} turns: anyone walking in or starting a turn there loses {d} max HP", { r: tag("num", e.radius), n: turns, d: tag("dmg", `${Math.round(content.rules.zones.fireDamage * 100)}%`) })
          : e.hazard === "poison" ? t("Leaves a poison cloud (radius {r}) for {n} turns: anyone walking in or starting a turn there is poisoned", { r: tag("num", e.radius), n: turns })
          : t("Turns the ground to mud (radius {r}) for {n} turns: walking through it costs double", { r: tag("num", e.radius), n: turns }));
        break;
      }
      case "disengage": lines.push(t("Ends the user's engagement {x}", { x: tag("good", t("without a free attack")) })); break;
      case "status": {
        const st = content.statuses[e.status];
        const what = st ? statusEffectText(st) : "";
        const vars = { status: tag("status", st?.name ?? e.status), n: tag("num", e.duration), what: what ? ` (${what})` : "" };
        const grants = move.affects === "allies";
        lines.push(e.duration > 1
          ? (grants ? t("Grants {status} for {n} turns{what}", vars) : t("Inflicts {status} for {n} turns{what}", vars))
          : (grants ? t("Grants {status} for {n} turn{what}", vars) : t("Inflicts {status} for {n} turn{what}", vars)));
        break;
      }
    }
  }
  if (move.onlyVs) lines.push(t("Only targets a Pokémon with {status}", { status: tag("status", content.statuses[move.onlyVs]?.name ?? move.onlyVs) }));
  const typeRule = content.types[move.type]?.summary?.split(". ").slice(1).join(". ");
  if (typeRule && move.affects === "enemies") lines.push(`${tag(move.type, t("Type"))}: ${typeRule}`);
  lines.push(tag("dim", move.range.max === 0 && move.affects === "allies" ? t("Targets itself") : move.affects === "enemies" ? t("Affects enemies only") : move.affects === "any" ? t("Affects enemies or allies") : t("Affects allies")));
  return lines.join("\n");
}

/** What a status does, in exact numbers. Durations count the affected Pokémon's own turns. */
export function statusEffectText(st: StatusDef): string {
  const parts: string[] = [];
  if (st.damagePerTurn) parts.push(t("loses {n}% max HP each turn", { n: Math.round(st.damagePerTurn * 100) }));
  if (st.movePenalty) parts.push(t("{v} movement", { v: st.movePenalty > 0 ? `−${st.movePenalty}` : `+${-st.movePenalty}` }));
  if (st.noMove) parts.push(t("cannot move"));
  if (st.drainsToSource) parts.push(t("the HP lost heals the Pokémon that applied it"));
  if (st.forcesTarget) parts.push(t("may only attack the Pokémon that applied it"));
  if (st.noAction) parts.push(t("cannot use moves"));
  if (st.damageDealt !== undefined && st.damageDealt !== 1) parts.push(t("{v} damage dealt", { v: `${st.damageDealt > 1 ? "+" : "−"}${Math.round(Math.abs(st.damageDealt - 1) * 100)}%` }));
  if (st.damageTaken !== undefined && st.damageTaken !== 1)
    parts.push(st.damageTaken === 0 ? t("takes no damage") : t("{v} damage taken", { v: `${st.damageTaken > 1 ? "+" : "−"}${Math.round(Math.abs(st.damageTaken - 1) * 100)}%` }));
  if (st.stacks) parts.push(t("stacks"));
  return parts.join(", ");
}
