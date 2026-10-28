import { STAT_NAMES, type BaseStats, type BattleContent, type StatName, type UnitModifiers } from "../../core/battle";
import type { ItemDef, ProgressionContent, TalentDef } from "../../core/progression";
import { t } from "../i18n";
import { describeMove } from "./describeMove";
import { tag } from "./markup";

const pct = (x: number) => `${Math.round(Math.abs(x) * 100)}%`;

/** Exact, numeric rules text for a set of battle modifiers (talents, items). */
export function describeModifiers(content: BattleContent, m: Partial<UnitModifiers>): string[] {
  const out: string[] = [];
  const up = (s: string) => tag("good", s);
  const bond = content.terms.bond;
  if (m.rangeBonus) out.push(t("Ranged moves (range 2+) reach {n} further (max 3, Bond moves no limit)", { n: up(`+${m.rangeBonus}`) }));
  if (m.shootOver) out.push(t("Its ranged moves {x} in the way", { x: up(t("fire over Pokémon")) }));
  if (m.farDamage && m.farDamage !== 1) out.push(t("{v} damage to foes out of melee reach", { v: m.farDamage > 1 ? up(`+${pct(m.farDamage - 1)}`) : tag("bad", `−${pct(m.farDamage - 1)}`) }));
  if (m.closeDamage && m.closeDamage !== 1) out.push(t("{v} damage to adjacent foes", { v: m.closeDamage > 1 ? up(`+${pct(m.closeDamage - 1)}`) : tag("bad", `−${pct(m.closeDamage - 1)}`) }));
  if (m.moveBonus) out.push(t("{x} every turn", { x: up(t("{v} movement", { v: `${m.moveBonus > 0 ? "+" : ""}${m.moveBonus}` })) }));
  if (m.damageDealt && m.damageDealt !== 1) out.push(t("{x} with every move", { x: up(t("{v} damage", { v: `${m.damageDealt > 1 ? "+" : "−"}${pct(m.damageDealt - 1)}` })) }));
  if (m.damageTaken && m.damageTaken !== 1) out.push(t("Takes {x}", { x: up(m.damageTaken < 1 ? t("{v} less damage", { v: pct(1 - m.damageTaken) }) : t("{v} more damage", { v: pct(1 - m.damageTaken) })) }));
  const plusDmg = (x: number) => up(t("{v} damage", { v: `+${pct(x - 1)}` }));
  for (const [ty, x] of Object.entries(m.typeDamage ?? {})) out.push(t("{type} moves deal {x}", { type: tag(ty, ty), x: plusDmg(x) }));
  for (const [ty, x] of Object.entries(m.lowHpTypeDamage ?? {})) out.push(t("{type} moves deal {x} while below half HP", { type: tag(ty, ty), x: plusDmg(x) }));
  if (m.fullHpTargetDamage && m.fullHpTargetDamage !== 1) out.push(t("{x} against foes at full HP", { x: plusDmg(m.fullHpTargetDamage) }));
  if (m.lowHpDamage && m.lowHpDamage !== 1) out.push(t("{x} while its HP is below half", { x: plusDmg(m.lowHpDamage) }));
  if (m.vsStatusDamage && m.vsStatusDamage !== 1) out.push(t("{x} against foes with a status effect", { x: plusDmg(m.vsStatusDamage) }));
  if (m.healPerTurn) out.push(t("Heals {x} at the start of each of its turns", { x: up(t("{v} of max HP", { v: pct(m.healPerTurn) })) }));
  if (m.statusDurationBonus) out.push(t("Statuses it inflicts last {x}", { x: up(t("+{n} turn", { n: m.statusDurationBonus })) }));
  if (m.impactBonus) out.push(t("Pushing a foe into an obstacle deals {x} (base {base})", { x: up(`+${m.impactBonus}`), base: content.rules.impactDamage }));
  if (m.flankBonus) out.push(t("Fighting flank bonus {x}", { x: up(`+${pct(m.flankBonus)}`) }));
  if (m.swarmBonus) out.push(t("Bug swarm bonus {x}", { x: up(t("{v} per helper", { v: `+${pct(m.swarmBonus)}` })) }));
  if (m.drainBonus) out.push(t("Grass drain heals {x} more of the damage dealt", { x: up(`+${pct(m.drainBonus)}`) }));
  if (m.pushBonus) out.push(t("Pushes it causes go {x}", { x: up(t("+{n} further", { n: m.pushBonus })) }));
  if (m.pullBonus) out.push(t("Pulls it causes go {x}", { x: up(t("+{n} further", { n: m.pullBonus })) }));
  if (m.bondOnKo) out.push(t("{x} when it knocks out a foe", { x: up(t("+{n} extra {bond}", { n: m.bondOnKo, bond })) }));
  if (m.bondOnFaint) out.push(t("Team gains {x} when it faints", { x: up(`+${m.bondOnFaint} ${bond}`) }));
  if (m.bondCostReduction) out.push(t("Its {bond} moves cost {x} (minimum 1)", { bond, x: up(t("{n} less", { n: m.bondCostReduction })) }));
  if (m.contactStatus) {
    const d = m.contactStatus.duration;
    const status = tag("status", content.statuses[m.contactStatus.status]?.name ?? m.contactStatus.status);
    out.push(d > 1
      ? t("Its hits on adjacent foes inflict {status} ({n} turns)", { status, n: d })
      : t("Its hits on adjacent foes inflict {status} ({n} turn)", { status, n: d }));
  }
  if (m.vsEngagedDamage && m.vsEngagedDamage !== 1) out.push(t("{v} damage to foes engaged with an ally (combo)", { v: up(`+${pct(m.vsEngagedDamage - 1)}`) }));
  if (m.vsSetupDamage && m.vsSetupDamage !== 1) out.push(t("{v} damage to foes carrying an ally's status (combo)", { v: up(`+${pct(m.vsSetupDamage - 1)}`) }));
  if (m.comboBond) out.push(t("{v} Bond when it lands a combo", { v: up(`+${m.comboBond}`) }));
  if (m.disengage) out.push(t("Steps away from engaged foes {x}", { x: up(t("without free attacks")) }));
  const mul = (v: number | undefined, key: string, vars: Record<string, string> = {}) => {
    if (v && v !== 1) out.push(t(key, { ...vars, v: up(`${v > 1 ? "+" : "−"}${pct(v - 1)}`) }));
  };
  mul(m.pinDamage, "{v} damage foes it engages take from its allies");
  mul(m.strikeDamage, "{v} damage on its free strikes at foes breaking away");
  mul(m.vsMudDamage, "{v} damage to foes standing on mud");
  mul(m.surroundedDamage, "{v} damage while 2+ foes stand next to it");
  mul(m.statusedDamage, "{v} damage while it carries a status");
  mul(m.fullHpDamageTaken, "{v} damage taken while at full HP");
  for (const [st, v] of Object.entries(m.vsStatusIdDamage ?? {})) mul(v, "{v} damage to foes with {status}", { status: st });
  if (m.koAttackBoost) out.push(t("{x} per knockout (this battle, max +3)", { x: up(t("+{n} Attack", { n: m.koAttackBoost })) }));
  if (m.koMove) out.push(t("{x} when it knocks a foe out on its turn", { x: up(t("{v} movement", { v: `+${m.koMove}` })) }));
  if (m.koRefreshBasic) out.push(t("Its basic attack {x} when it knocks a foe out on its turn", { x: up(t("refreshes")) }));
  if (m.koResetCooldowns) out.push(t("Knockouts {x}", { x: up(t("reset its cooldowns")) }));
  if (m.statusSpreadOnKo) out.push(t("Its statuses {x} to adjacent foes when the carrier faints", { x: up(t("spread")) }));
  if (m.healWhileEngaged) out.push(t("Heals {v} of max HP per turn while engaged", { v: up(pct(m.healWhileEngaged)) }));
  if (m.bondOnStrike) out.push(t("{x} when its free strike hits", { x: up(t("+{n} Bond", { n: m.bondOnStrike })) }));
  if (m.furyCutter) out.push(t("{v} damage per hit in a row on the same foe (max 3)", { v: up(`+${pct(m.furyCutter)}`) }));
  if (m.statusedMove) out.push(t("{x} while it carries a status", { x: up(t("{v} movement", { v: `+${m.statusedMove}` })) }));
  if (m.statusCooldownReduction) out.push(t("Non-damaging specials recharge {x}", { x: up(t("{n} turn faster", { n: m.statusCooldownReduction })) }));
  if (m.shedStatuses) out.push(t("{x} statuses foes put on it each turn", { x: up(t("Sheds")) }));
  if (m.sturdy) out.push(t("{x} one knockout blow per battle at 1 HP", { x: up(t("Survives")) }));
  if (m.noEscape) out.push(t("Foes it engages {x} without its free strike", { x: up(t("cannot slip away")) }));
  if (m.koHeal) out.push(t("Heals {v} of its max HP when it knocks out a foe", { v: up(pct(m.koHeal)) }));
  if (m.thorns) out.push(t("Foes that hit it in melee take {x}", { x: up(t("{n} damage", { n: m.thorns })) }));
  mul(m.ownTypeDamage, "{v} damage with moves of its own types");
  mul(m.superEffectiveTaken, "{v} super-effective damage taken");
  mul(m.statusedDamageTaken, "{v} damage taken while it carries a status");
  for (const [ty, v] of Object.entries(m.typeDamageTaken ?? {})) mul(v, "{v} damage taken from {type} moves", { type: tag(ty, ty) });
  if (m.critImmune) out.push(t("{x} critical hits", { x: up(t("Never takes")) }));
  if (m.sheerForce) out.push(t("Moves with a status effect deal {x} but drop the status", { x: up("+30%") }));
  if (m.hitStatus) {
    const status = tag("status", content.statuses[m.hitStatus.status]?.name ?? m.hitStatus.status);
    out.push(t("Foes that hit it in melee get {status} ({n} turn)", { status, n: m.hitStatus.duration }));
  }
  if (m.statusImmune?.length) out.push(m.statusImmune.includes("*") ? t("Immune to all statuses") : t("Immune to {list}", { list: m.statusImmune.join(", ") }));
  return out;
}

export const STAT_LABEL: Record<StatName, string> = { hp: t("Vitality"), attack: t("Attack"), defense: t("Defense"), speed: t("Speed"), willpower: t("Willpower"), crit: t("Crit") };
export const STAT_SHORT: Record<StatName, string> = { hp: t("Vit"), attack: t("Atk"), defense: t("Def"), speed: t("Spe"), willpower: t("Will"), crit: t("Crit") };

/** "Atk 7  Def 3  SpA 8  SpD 5  Spe 6" (HP is shown separately as current/max). */
export const statLine = (stats: BaseStats): string =>
  STAT_NAMES.filter((s) => s !== "hp").map((s) => `${STAT_SHORT[s]} ${stats[s]}`).join("  ");

/** "Attack focus": the stat the Lv 3 pick grows. */
export const focusLabel = (stat: StatName): string => t("{stat} focus", { stat: STAT_LABEL[stat] });

export function describeTalent(content: BattleContent, prog: ProgressionContent, talent: TalentDef): string[] {
  const out: string[] = [];
  const bond = content.terms.bond;
  for (const [s, v] of Object.entries(talent.stats ?? {}) as [StatName, number][]) {
    const extra = s === "hp" ? t(" (max HP +{n})", { n: v * content.rules.hpPerPoint })
      : s === "speed" ? t(" (+{n} movement)", { n: Math.round(v * content.rules.movement.perSpeed * 10) / 10 }) : "";
    out.push(`${tag("good", `+${v} ${STAT_LABEL[s]}`)}${tag("dim", extra)}`);
  }
  out.push(...describeModifiers(content, talent.mods ?? {}));
  if (talent.team?.startBond) out.push(t("While deployed, the team starts battles with {x} (base {base})", { x: tag("good", `+${talent.team.startBond} ${bond}`), base: content.rules.bond.start }));
  if (talent.team?.maxBond) out.push(t("While deployed, the team's {bond} cap is {x} (base {base})", { bond, x: tag("good", `+${talent.team.maxBond}`), base: content.rules.bond.max }));
  if (talent.grantsMove && content.moves[talent.grantsMove]) out.push(t("{x} (joins the move list):", { x: tag("special", t("New skill")) }), describeMove(content, content.moves[talent.grantsMove]!));
  return out;
}

export function describeItem(content: BattleContent, item: ItemDef): string[] {
  if (item.kind === "potion") return [t("Restores {x} outside battle (not to fainted Pokémon).", { x: tag("heal", `${item.heal} HP`) })];
  if (item.kind === "candy" || item.kind === "food") return [item.description];
  if (item.kind === "remedy") return [t("Removes {x} from a Pokémon.", { x: tag("heal", t("{n} knockout mark", { n: String(item.clearsKnockouts) })) })];
  return describeModifiers(content, item.mods ?? {});
}
