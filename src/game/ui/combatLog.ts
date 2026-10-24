import type { BattleEvent } from "../../core/battle";
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
}

/** Turns one battle event into a log line; returns null for events not worth logging. */
export function formatEvent(e: BattleEvent, ctx: LogContext): LogEntry | null {
  const side = (id: string): LogTone => (ctx.isPlayer(id) ? "player" : "enemy");
  // Unit names are coloured by side; everything else by meaning.
  const name = (id: string) => tag(side(id), ctx.name(id));
  switch (e.type) {
    case "roundStarted":
      return { text: `— Round ${e.round} —`, tone: "info" };
    case "turnStarted":
      return null;
    case "moved":
      return { text: `${name(e.unitId)} moves ${e.path.length} tile${e.path.length === 1 ? "" : "s"}`, tone: side(e.unitId) };
    case "moveUsed": {
      const targets = e.affected.length ? ` → ${e.affected.map(name).join(", ")}` : "";
      return { text: `${name(e.unitId)} uses ${tag("title", ctx.moveName(e.moveId))}${targets}`, tone: side(e.unitId) };
    }
    case "damaged": {
      const why = e.source === "status" ? " from status" : e.source === "impact" ? " from impact" : "";
      const eff = e.effectiveness === undefined || e.effectiveness === 1 ? ""
        : e.effectiveness > 1 ? ` ${tag("good", `(super effective ×${e.effectiveness})`)}` : ` ${tag("dim", `(not very effective ×${e.effectiveness})`)}`;
      return { text: `${name(e.unitId)} takes ${tag("dmg", `${e.amount} damage`)}${why}${eff} — ${e.hp} HP left`, tone: "damage" };
    }
    case "healed":
      return { text: `${name(e.unitId)} recovers ${tag("heal", `${e.amount} HP`)} — ${e.hp} HP`, tone: "heal" };
    case "displaced":
      return {
        text: e.blocked && e.from.x === e.to.x && e.from.y === e.to.y
          ? `${name(e.unitId)} is slammed into an obstacle`
          : `${name(e.unitId)} is knocked back${e.blocked ? " into an obstacle" : ""}`,
        tone: "info",
      };
    case "statusApplied":
      return { text: `${name(e.unitId)} is afflicted with ${tag("status", ctx.statusName(e.status))} (${e.duration} turn${e.duration === 1 ? "" : "s"})`, tone: "status" };
    case "statusExpired":
      return { text: `${name(e.unitId)} is no longer affected by ${tag("status", ctx.statusName(e.status))}`, tone: "status" };
    case "fainted":
      return { text: `${name(e.unitId)} ${tag("ko", "fainted!")}`, tone: "ko" };
    case "ballThrown":
      return {
        text: `${name(e.unitId)} throws a ${ctx.ballName(e.ballId)} at ${name(e.targetId)} (${Math.round(e.chance * 100)}%) — ${e.success ? tag("good", "caught!") : tag("bad", "it broke free")}`,
        tone: e.success ? "result" : "info",
      };
    case "captured":
      return null;
    case "turnEnded":
      return null;
    case "battleEnded":
      return { text: e.outcome === "victory" ? "Victory!" : e.outcome === "defeat" ? "Defeat…" : "Retreated from battle", tone: "result" };
  }
}
