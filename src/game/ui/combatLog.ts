import type { BattleEvent } from "../../core/battle";
import { t } from "../i18n";
import { tag } from "./markup";

export type LogTone = "info" | "player" | "enemy" | "damage" | "heal" | "status" | "ko" | "result";

export interface LogEntry {
  readonly text: string;
  readonly tone: LogTone;
}

export interface LogContext {
  /** Display name, e.g. "Charmander" or "Foe Mankey" (or "???" while hidden). */
  name(unitId: string): string;
  isPlayer(unitId: string): boolean;
  moveName(moveId: string): string;
  statusName(statusId: string): string;
  ballName(ballId: string): string;
  abilityName(abilityId: string): string;
  /** Display name of a named combo (rules.combos). */
  comboName(comboId: string): string;
  /** Display name of the team resource (a content term). */
  readonly bondName: string;
  /** Primary type of the unit, or null while it is hidden. */
  typeOf(unitId: string): string | null;
}

/** Turns one battle event into a log line; returns null for events not worth logging. */
export function formatEvent(e: BattleEvent, ctx: LogContext): LogEntry | null {
  const side = (id: string): LogTone => (ctx.isPlayer(id) ? "player" : "enemy");
  // Unit names are coloured by side; everything else by meaning.
  const name = (id: string) => tag(`${ctx.isPlayer(id) ? "ally" : "foe"}:${ctx.typeOf(id) ?? "unknown"}`, ctx.name(id));
  switch (e.type) {
    case "roundStarted":
      return { text: t("— Round {n} —", { n: e.round }), tone: "info" };
    case "turnStarted":
      return null;
    case "moved":
      // Walks are measured in movement spent.
      return { text: t("{unit} walks ({cost} movement)", { unit: name(e.unitId), cost: e.cost.toFixed(1) }), tone: side(e.unitId) };
    case "engagementStrike":
      return { text: t("{unit} strikes {target} as it breaks away", { unit: name(e.unitId), target: name(e.targetId) }), tone: side(e.unitId) };
    case "combo":
      return { text: t("{combo} {unit} exploits an ally's setup on {target}", { combo: tag("good", `${ctx.comboName(e.combo)}!`), unit: name(e.unitId), target: name(e.targetId) }), tone: side(e.unitId) };
    case "engaged":
      return { text: t("{unit} and {target} are {x}", { unit: name(e.unitId), target: name(e.targetId), x: tag("bad", t("engaged")) }), tone: "info" };
    case "disengaged":
      return { text: t("{unit} and {target} are no longer engaged", { unit: name(e.unitId), target: name(e.targetId) }), tone: "info" };
    case "moveUsed": {
      const targets = e.affected.length ? ` → ${e.affected.map(name).join(", ")}` : "";
      return { text: t("{unit} uses {move}{targets}", { unit: name(e.unitId), move: tag("title", ctx.moveName(e.moveId)), targets }), tone: side(e.unitId) };
    }
    case "damaged": {
      const why = e.source === "status" ? t(" from status") : e.source === "impact" ? t(" from impact") : e.source === "thorns" ? t(" from spikes") : e.source === "recoil" ? t(" from recoil") : "";
      const eff = e.effectiveness === undefined || e.effectiveness === 1 ? ""
        : e.effectiveness > 1 ? ` ${tag("good", t("(super effective ×{n})", { n: e.effectiveness }))}` : ` ${tag("dim", t("(not very effective ×{n})", { n: e.effectiveness }))}`;
      return { text: t("{unit} takes {dmg}{why}{eff} — {hp} HP left", { unit: name(e.unitId), dmg: tag("dmg", t("{n} damage", { n: e.amount })), why, eff, hp: e.hp }), tone: "damage" };
    }
    case "critical":
      return { text: t("{x} {unit} lands a critical hit on {target}", { x: tag("good", t("Critical!")), unit: name(e.unitId), target: name(e.targetId) }), tone: side(e.unitId) };
    case "statusResisted":
      return { text: t("{unit} shrugs off {status} through willpower", { unit: name(e.unitId), status: e.status }), tone: "info" };
    case "healed":
      return { text: t("{unit} recovers {x} — {hp} HP", { unit: name(e.unitId), x: tag("heal", `${e.amount} HP`), hp: e.hp }), tone: "heal" };
    case "displaced": {
      // An engaged pair stepping together needs no line: "are engaged" says it.
      if (e.engage) return null;
      const unit = name(e.unitId);
      return {
        text: e.blocked && e.from.x === e.to.x && e.from.y === e.to.y
          ? t("{unit} is slammed into an obstacle", { unit })
          : e.blocked ? t("{unit} is knocked back into an obstacle", { unit }) : t("{unit} is knocked back", { unit }),
        tone: "info",
      };
    }
    case "statusApplied": {
      const vars = { unit: name(e.unitId), status: tag("status", ctx.statusName(e.status)), n: e.duration };
      return { text: e.duration === 1 ? t("{unit} is afflicted with {status} ({n} turn)", vars) : t("{unit} is afflicted with {status} ({n} turns)", vars), tone: "status" };
    }
    case "statusExpired":
      return { text: t("{unit} is no longer affected by {status}", { unit: name(e.unitId), status: tag("status", ctx.statusName(e.status)) }), tone: "status" };
    case "fainted":
      return { text: t("{unit} {x}", { unit: name(e.unitId), x: tag("ko", t("fainted!")) }), tone: "ko" };
    case "ballThrown":
      return {
        text: t("{unit} throws a {ball} at {target} ({chance}%) — {result}", {
          unit: name(e.unitId), ball: ctx.ballName(e.ballId), target: name(e.targetId), chance: Math.round(e.chance * 100),
          result: e.success ? tag("good", t("caught!")) : tag("bad", t("it broke free")),
        }),
        tone: e.success ? "result" : "info",
      };
    case "captured":
      return null;
    case "bondChanged": {
      const reason = e.reason === "knockout" ? t(" (knockout)") : e.reason === "fainted" ? t(" (a fallen ally)") : e.reason === "combo" ? t(" (combo)") : "";
      const player = e.side === "player";
      const vars = { who: tag(player ? "player" : "enemy", player ? t("Your team") : t("Foes")), x: tag("num", `${Math.abs(e.amount)} ${ctx.bondName}`), total: e.total, reason };
      const text = e.amount > 0
        ? t("{who} gain {x} — {total} left{reason}", vars)
        : t("{who} spend {x} — {total} left{reason}", vars);
      return { text, tone: "info" };
    }
    case "abilityTriggered":
      return { text: t("{unit}'s {ability}!", { unit: name(e.unitId), ability: tag("special", ctx.abilityName(e.ability)) }), tone: "info" };
    case "terrainChanged":
      return { text: tag("dim", t("The ground turns to mud.")), tone: "info" };
    case "hazardCreated":
      return { text: tag("dim", e.hazard.kind === "fire" ? t("The ground catches fire.") : e.hazard.kind === "poison" ? t("A poison cloud settles.") : t("The ground turns to mud.")), tone: "info" };
    case "hazardExpired":
      return { text: tag("dim", e.kind === "fire" ? t("The fire dies down.") : e.kind === "poison" ? t("The poison cloud clears.") : t("The mud dries up.")), tone: "info" };
    case "hazardTouched":
      return { text: e.kind === "fire" ? t("{unit} is caught in the fire", { unit: name(e.unitId) }) : t("{unit} breathes the poison cloud", { unit: name(e.unitId) }), tone: side(e.unitId) };
    case "strikePrepared":
      return {
        text: e.timing === "delayed"
          ? t("{unit} readies {move}: it strikes the marked ground next turn", { unit: name(e.unitId), move: tag("special", ctx.moveName(e.moveId)) })
          : t("{unit} watches with {move}: the first foe moving there is struck", { unit: name(e.unitId), move: tag("special", ctx.moveName(e.moveId)) }),
        tone: side(e.unitId),
      };
    case "watchTriggered":
      return { text: t("{unit} strikes {target} on the move!", { unit: name(e.unitId), target: name(e.targetId) }), tone: side(e.unitId) };
    case "strikeEnded":
      return { text: tag("dim", t("{unit}'s {move} hits nothing", { unit: name(e.unitId), move: ctx.moveName(e.moveId) })), tone: "info" };
    case "turnEnded":
      return null;
    case "battleEnded":
      return { text: e.outcome === "victory" ? t("Victory!") : e.outcome === "defeat" ? t("Defeat…") : t("Retreated from battle"), tone: "result" };
  }
}
