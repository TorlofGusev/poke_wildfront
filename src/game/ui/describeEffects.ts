import { STAT_NAMES, type BaseStats, type BattleContent, type StatName, type UnitModifiers } from "../../core/battle";
import type { ItemDef, ProgressionContent, RoleDef, TalentDef } from "../../core/progression";
import { describeMove } from "./describeMove";
import { tag } from "./markup";

const pct = (x: number) => `${Math.round(Math.abs(x) * 100)}%`;

/** Exact, numeric rules text for a set of battle modifiers (talents, items). */
export function describeModifiers(content: BattleContent, m: Partial<UnitModifiers>): string[] {
  const out: string[] = [];
  const up = (s: string) => tag("good", s);
  if (m.rangeBonus) out.push(`Ranged moves (2+ tiles) reach ${up(`+${m.rangeBonus} tile${m.rangeBonus > 1 ? "s" : ""}`)} further`);
  if (m.farDamage && m.farDamage !== 1) out.push(`${m.farDamage > 1 ? up(`+${pct(m.farDamage - 1)}`) : tag("bad", `−${pct(m.farDamage - 1)}`)} damage to foes 3+ tiles away`);
  if (m.closeDamage && m.closeDamage !== 1) out.push(`${m.closeDamage > 1 ? up(`+${pct(m.closeDamage - 1)}`) : tag("bad", `−${pct(m.closeDamage - 1)}`)} damage to adjacent foes`);
  if (m.moveBonus) out.push(`${up(`${m.moveBonus > 0 ? "+" : ""}${m.moveBonus} movement`)} every turn`);
  if (m.damageDealt && m.damageDealt !== 1) out.push(`${up(`${m.damageDealt > 1 ? "+" : "−"}${pct(m.damageDealt - 1)} damage`)} with every move`);
  if (m.damageTaken && m.damageTaken !== 1) out.push(`Takes ${up(`${pct(1 - m.damageTaken)} ${m.damageTaken < 1 ? "less" : "more"} damage`)}`);
  for (const [t, x] of Object.entries(m.typeDamage ?? {})) out.push(`${tag(t, t)} moves deal ${up(`+${pct(x - 1)} damage`)}`);
  for (const [t, x] of Object.entries(m.lowHpTypeDamage ?? {})) out.push(`${tag(t, t)} moves deal ${up(`+${pct(x - 1)} damage`)} while below half HP`);
  if (m.fullHpTargetDamage && m.fullHpTargetDamage !== 1) out.push(`${up(`+${pct(m.fullHpTargetDamage - 1)} damage`)} against foes at full HP`);
  if (m.lowHpDamage && m.lowHpDamage !== 1) out.push(`${up(`+${pct(m.lowHpDamage - 1)} damage`)} while its HP is below half`);
  if (m.vsStatusDamage && m.vsStatusDamage !== 1) out.push(`${up(`+${pct(m.vsStatusDamage - 1)} damage`)} against foes with a status effect`);
  if (m.healPerTurn) out.push(`Heals ${up(`${pct(m.healPerTurn)} of max HP`)} at the start of each of its turns`);
  if (m.statusDurationBonus) out.push(`Statuses it inflicts last ${up(`+${m.statusDurationBonus} turn`)}`);
  if (m.impactBonus) out.push(`Pushing a foe into an obstacle deals ${up(`+${m.impactBonus}`)} (base ${content.rules.impactDamage})`);
  if (m.flankBonus) out.push(`Fighting flank bonus ${up(`+${pct(m.flankBonus)}`)}`);
  if (m.swarmBonus) out.push(`Bug swarm bonus ${up(`+${pct(m.swarmBonus)} per helper`)}`);
  if (m.drainBonus) out.push(`Grass drain heals ${up(`+${pct(m.drainBonus)}`)} more of the damage dealt`);
  if (m.pushBonus) out.push(`Pushes it causes go ${up(`+${m.pushBonus} tile`)}`);
  if (m.pullBonus) out.push(`Pulls it causes go ${up(`+${m.pullBonus} tile`)}`);
  if (m.bondOnKo) out.push(`${up(`+${m.bondOnKo} extra ${content.terms.bond}`)} when it knocks out a foe`);
  if (m.bondOnFaint) out.push(`Team gains ${up(`+${m.bondOnFaint} ${content.terms.bond}`)} when it faints`);
  if (m.bondCostReduction) out.push(`Its ${content.terms.bond} moves cost ${up(`${m.bondCostReduction} less`)} (minimum 1)`);
  if (m.contactStatus) out.push(`Its hits on adjacent foes inflict ${tag("status", content.statuses[m.contactStatus.status]?.name ?? m.contactStatus.status)} (${m.contactStatus.duration} turn${m.contactStatus.duration > 1 ? "s" : ""})`);
  if (m.vsEngagedDamage && m.vsEngagedDamage !== 1) out.push(`${up(`+${pct(m.vsEngagedDamage - 1)}`)} damage to foes engaged with an ally (combo)`);
  if (m.vsSetupDamage && m.vsSetupDamage !== 1) out.push(`${up(`+${pct(m.vsSetupDamage - 1)}`)} damage to foes carrying an ally's status (combo)`);
  if (m.comboBond) out.push(`${up(`+${m.comboBond}`)} Bond when it lands a combo`);
  if (m.disengage) out.push(`Steps away from engaged foes ${up("without free attacks")}`);
  const mul = (v: number | undefined, text: string) => { if (v && v !== 1) out.push(`${up(`${v > 1 ? "+" : "−"}${pct(v - 1)}`)} ${text}`); };
  mul(m.pinDamage, "damage foes it engages take from its allies");
  mul(m.strikeDamage, "damage on its free strikes at foes breaking away");
  mul(m.vsMudDamage, "damage to foes standing on mud");
  mul(m.surroundedDamage, "damage while 2+ foes stand next to it");
  mul(m.statusedDamage, "damage while it carries a status");
  mul(m.fullHpDamageTaken, "damage taken while at full HP");
  for (const [st, v] of Object.entries(m.vsStatusIdDamage ?? {})) mul(v, `damage to foes with ${st}`);
  if (m.koAttackBoost) out.push(`${up(`+${m.koAttackBoost} Attack`)} per knockout (this battle, max +3)`);
  if (m.koMove) out.push(`${up(`+${m.koMove} movement`)} when it knocks a foe out on its turn`);
  if (m.koRefreshBasic) out.push(`Its basic attack ${up("refreshes")} when it knocks a foe out on its turn`);
  if (m.koResetCooldowns) out.push(`Knockouts ${up("reset its cooldowns")}`);
  if (m.statusSpreadOnKo) out.push(`Its statuses ${up("spread")} to adjacent foes when the carrier faints`);
  if (m.healWhileEngaged) out.push(`Heals ${up(pct(m.healWhileEngaged))} of max HP per turn while engaged`);
  if (m.bondOnStrike) out.push(`${up(`+${m.bondOnStrike} Bond`)} when its free strike hits`);
  if (m.furyCutter) out.push(`${up(`+${pct(m.furyCutter)}`)} damage per hit in a row on the same foe (max 3)`);
  if (m.statusedMove) out.push(`${up(`+${m.statusedMove} movement`)} while it carries a status`);
  if (m.statusCooldownReduction) out.push(`Non-damaging specials recharge ${up(`${m.statusCooldownReduction} turn faster`)}`);
  if (m.shedStatuses) out.push(`${up("Sheds")} statuses foes put on it each turn`);
  if (m.sturdy) out.push(`${up("Survives")} one knockout blow per battle at 1 HP`);
  if (m.noEscape) out.push(`Foes it engages ${up("cannot slip away")} without its free strike`);
  if (m.koHeal) out.push(`Heals ${up(pct(m.koHeal))} of its max HP when it knocks out a foe`);
  if (m.thorns) out.push(`Foes that hit it from an adjacent tile take ${up(`${m.thorns} damage`)}`);
  if (m.statusImmune?.length) out.push(`Immune to ${m.statusImmune.includes("*") ? "all statuses" : m.statusImmune.join(", ")}`);
  return out;
}

export const STAT_LABEL: Record<StatName, string> = { hp: "HP", attack: "Attack", defense: "Defense", spAttack: "Sp. Atk", spDefense: "Sp. Def", speed: "Speed" };
export const STAT_SHORT: Record<StatName, string> = { hp: "HP", attack: "Atk", defense: "Def", spAttack: "SpA", spDefense: "SpD", speed: "Spe" };

/** "Atk 7  Def 3  SpA 8  SpD 5  Spe 6" (HP is shown separately as current/max). */
export const statLine = (stats: BaseStats): string =>
  STAT_NAMES.filter((s) => s !== "hp").map((s) => `${STAT_SHORT[s]} ${stats[s]}`).join("  ");

/** A role's automatic growth as a hint: "Def ++ · SpD ++ · HP +". */
export function describeGrowth(role: RoleDef): string {
  return STAT_NAMES.filter((s) => (role.growth[s] ?? 0) > 0)
    .sort((a, b) => role.growth[b]! - role.growth[a]!)
    .map((s) => `${STAT_SHORT[s]} ${role.growth[s]! >= 0.25 ? "++" : "+"}`).join(" · ");
}

export function describeTalent(content: BattleContent, prog: ProgressionContent, t: TalentDef): string[] {
  const out: string[] = [];
  for (const [s, v] of Object.entries(t.stats ?? {}) as [StatName, number][]) {
    const extra = s === "hp" ? ` (max HP +${v * content.rules.hpPerPoint})` : s === "speed" ? ` (movement +1 every ${content.rules.speedPerMove} Speed)` : "";
    out.push(`${tag("good", `+${v} ${STAT_LABEL[s]}`)}${tag("dim", extra)}`);
  }
  out.push(...describeModifiers(content, t.mods ?? {}));
  if (t.team?.startBond) out.push(`While deployed, the team starts battles with ${tag("good", `+${t.team.startBond} ${content.terms.bond}`)} (base ${content.rules.bond.start})`);
  if (t.team?.maxBond) out.push(`While deployed, the team's ${content.terms.bond} cap is ${tag("good", `+${t.team.maxBond}`)} (base ${content.rules.bond.max})`);
  if (t.grantsMove && content.moves[t.grantsMove]) out.push(`${tag("special", "New skill")} (joins the move list):`, describeMove(content, content.moves[t.grantsMove]!));
  return out;
}

export function describeItem(content: BattleContent, item: ItemDef): string[] {
  if (item.kind === "potion") return [`Restores ${tag("heal", `${item.heal} HP`)} outside battle (not to fainted Pokémon).`];
  if (item.kind === "candy" || item.kind === "food") return [item.description];
  if (item.kind === "remedy") return [`Removes ${tag("heal", `${item.clearsKnockouts} knockout mark`)} from a Pokémon.`];
  return describeModifiers(content, item.mods ?? {});
}
