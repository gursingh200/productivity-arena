/**
 * Skills for everyone at once (spec §6): raw measures from the last 30 days,
 * then each person's scores on three scales: absolute, team (percentile among
 * everyone active), guild (percentile within their guild). Bulk queries, cached
 * for the request, so a profile or a compare page computes them once.
 *
 * Sharing is applied by the caller (`visibleSkills` in profile.ts): a viewer
 * sees an axis only if they can see every category it's computed from.
 */
import { cache } from "react";
import { and, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { dailyRollup, quests, users } from "@/db/schema";
import { computeSkillMeasures, percentileScore, type SkillsRadar } from "@/lib/skills";
import { companyTimezone } from "@/lib/standings";
import { addDays, dayBounds, toUserDay } from "@/lib/timezone";

export type Axis = keyof SkillsRadar;
export type SkillScale = "team" | "guild" | "absolute";

export interface SkillScores {
  /** The measures themselves (absolute scale, not capped), for head-to-head comparisons. */
  raw: SkillsRadar;
  absolute: SkillsRadar;
  team: SkillsRadar;
  /** Null when the person has no guild. */
  guild: SkillsRadar | null;
}

const AXES: Axis[] = ["willpower", "consistency", "endurance", "intensity", "parallelism", "competitive", "camaraderie", "orchestration"];

/** Everyone's scores, keyed by user id. Only people active in the last 30 days are ranked. */
export const allSkillScores = cache(async (): Promise<Map<string, SkillScores>> => {
  const now = new Date();
  const tz = companyTimezone();
  const today = toUserDay(now, tz);
  const from = addDays(today, -29);
  const since = dayBounds(from, tz).start;
  const weekdays = Array.from({ length: 30 }, (_, i) => addDays(from, i))
    .filter((d) => ![0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())).length;

  const people = await db.select({ id: users.id, guildId: users.guildId }).from(users);
  const rollups = await db.select().from(dailyRollup).where(gte(dailyRollup.day, from));
  const questRows = await db.select({ userId: quests.userId, state: quests.state, n: sql<number>`COUNT(*)` })
    .from(quests).where(and(gte(quests.createdAt, since))).groupBy(quests.userId, quests.state);

  const byUser = new Map<string, typeof rollups>();
  for (const r of rollups) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);
  const hoursOf = (id: string) => (byUser.get(id) ?? []).reduce((s, r) => s + r.agentSec + r.humanSec, 0);
  const guildMembers = new Map<string, string[]>();
  for (const p of people) if (p.guildId) guildMembers.set(p.guildId, [...(guildMembers.get(p.guildId) ?? []), p.id]);

  const measures = new Map<string, SkillsRadar>();
  for (const p of people) {
    const rows = byUser.get(p.id) ?? [];
    if (!rows.some((r) => r.humanSec + r.meetingSec + r.agentSec > 0)) continue; // not active: not ranked
    const qs = questRows.filter((q) => q.userId === p.id);
    const count = (states: string[]) => qs.filter((q) => states.includes(q.state)).reduce((s, q) => s + Number(q.n), 0);
    const members = p.guildId ? guildMembers.get(p.guildId) ?? [] : [];
    const guildTotal = members.reduce((s, id) => s + hoursOf(id), 0);
    measures.set(p.id, computeSkillMeasures({
      // Skills measure focus time: human plus call time.
      dailyRollups: rows.map((r) => ({
        day: r.day, humanSec: r.humanSec + r.meetingSec, agentSec: r.agentSec, longestFocusSec: r.longestFocusSec,
        focusBlocks: r.focusBlocks, peakParallel: r.peakParallel, tokensOut: r.tokensOut,
      })),
      weekdays,
      questsOffered: count(["completed", "failed", "expired", "declined", "active", "offered"]),
      questsCompleted: count(["completed"]),
      guildContributionShare: guildTotal > 0 ? hoursOf(p.id) / guildTotal : 0,
      guildSize: members.length,
      totalOutputTokens: rows.reduce((s, r) => s + r.tokensOut, 0),
      totalAgentSec: rows.reduce((s, r) => s + r.agentSec, 0),
      totalAgentWorkSec: rows.reduce((s, r) => s + Math.max(r.agentWorkSec, r.agentSec), 0),
    }));
  }

  const rank = (id: string, group: string[]): SkillsRadar => {
    const mine = measures.get(id)!;
    const ranked = group.filter((g) => measures.has(g));
    return Object.fromEntries(AXES.map((axis) => [axis, percentileScore(mine[axis], ranked.map((g) => measures.get(g)![axis]))])) as unknown as SkillsRadar;
  };
  const everyone = [...measures.keys()];
  const guildOf = new Map(people.map((p) => [p.id, p.guildId]));

  const out = new Map<string, SkillScores>();
  for (const [id, m] of measures) {
    const guildId = guildOf.get(id);
    out.set(id, {
      raw: m,
      absolute: Object.fromEntries(AXES.map((axis) => [axis, Math.min(10, m[axis])])) as unknown as SkillsRadar,
      team: rank(id, everyone),
      guild: guildId ? rank(id, guildMembers.get(guildId) ?? []) : null,
    });
  }
  return out;
});

/** Zero scores for someone not active in the last 30 days. */
export function emptyScores(): SkillScores {
  const zero = Object.fromEntries(AXES.map((axis) => [axis, 0])) as unknown as SkillsRadar;
  return { raw: zero, absolute: zero, team: zero, guild: null };
}
