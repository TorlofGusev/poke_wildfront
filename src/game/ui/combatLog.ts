import type { BattleEvent } from "../../core/battle";

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
}

/** Turns one battle event into a log line; returns null for events not worth logging. */
export function formatEvent(e: BattleEvent, ctx: LogContext): LogEntry | null {
  const side = (id: string): LogTone => (ctx.isPlayer(id) ? "player" : "enemy");
  switch (e.type) {
    case "roundStarted":
      return { text: `— Round ${e.round} —`, tone: "info" };
    case "turnStarted":
      return null;
    case "moved":
      return { text: `${ctx.name(e.unitId)} moves ${e.path.length} tile${e.path.length === 1 ? "" : "s"}`, tone: side(e.unitId) };
    case "moveUsed": {
      const targets = e.affected.length ? ` → ${e.affected.map(ctx.name).join(", ")}` : "";
      return { text: `${ctx.name(e.unitId)} uses ${ctx.moveName(e.moveId)}${targets}`, tone: side(e.unitId) };
    }
    case "damaged": {
      const why = e.source === "status" ? " from status" : e.source === "impact" ? " from impact" : "";
      const eff = e.effectiveness === undefined || e.effectiveness === 1 ? ""
        : e.effectiveness > 1 ? ` (super effective ×${e.effectiveness})` : ` (not very effective ×${e.effectiveness})`;
      return { text: `${ctx.name(e.unitId)} takes ${e.amount} damage${why}${eff} — ${e.hp} HP left`, tone: "damage" };
    }
    case "healed":
      return { text: `${ctx.name(e.unitId)} recovers ${e.amount} HP — ${e.hp} HP`, tone: "heal" };
    case "displaced":
      return {
        text: e.blocked && e.from.x === e.to.x && e.from.y === e.to.y
          ? `${ctx.name(e.unitId)} is slammed into an obstacle`
          : `${ctx.name(e.unitId)} is knocked back${e.blocked ? " into an obstacle" : ""}`,
        tone: "info",
      };
    case "statusApplied":
      return { text: `${ctx.name(e.unitId)} is afflicted with ${ctx.statusName(e.status)} (${e.duration} turn${e.duration === 1 ? "" : "s"})`, tone: "status" };
    case "statusExpired":
      return { text: `${ctx.name(e.unitId)} is no longer affected by ${ctx.statusName(e.status)}`, tone: "status" };
    case "fainted":
      return { text: `${ctx.name(e.unitId)} fainted!`, tone: "ko" };
    case "turnEnded":
      return null;
    case "battleEnded":
      return { text: e.outcome === "victory" ? "Victory!" : "Defeat…", tone: "result" };
  }
}
