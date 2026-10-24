import type { BattleContent, UnitModifiers } from "../../core/battle";
import type { ItemDef, ProgressionContent, TalentDef } from "../../core/progression";
import { describeMove } from "./describeMove";
import { tag } from "./markup";

const pct = (x: number) => `${Math.round(Math.abs(x) * 100)}%`;

/** Exact, numeric rules text for a set of battle modifiers (talents, items). */
export function describeModifiers(content: BattleContent, m: Partial<UnitModifiers>): string[] {
  const out: string[] = [];
  const up = (s: string) => tag("good", s);
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
  if (m.statusImmune?.length) out.push(`Immune to ${m.statusImmune.includes("*") ? "all statuses" : m.statusImmune.join(", ")}`);
  return out;
}

const STAT_LABEL = { hp: "HP", attack: "Attack", defense: "Defense", speed: "Speed" } as const;

export function describeTalent(content: BattleContent, prog: ProgressionContent, t: TalentDef): string[] {
  const out: string[] = [];
  for (const [s, v] of Object.entries(t.stats ?? {}) as [keyof typeof STAT_LABEL, number][]) {
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
  return describeModifiers(content, item.mods ?? {});
}
