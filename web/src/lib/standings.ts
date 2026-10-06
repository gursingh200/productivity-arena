/**
 * Weekly standings shared by the leaderboard, profiles and the Mac status
 * payload, so every surface shows the same rank, league and level (spec §4).
 *
 * Weeks run Monday→Monday in the company timezone (ARENA_TIMEZONE, default
 * UTC). XP rows are already bucketed into each user's local day, so a week
 * is the set of local days from that Monday's date to the next Monday's.
 */
import { and, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { dailyRollup, xpLedger } from "@/db/schema";
import { leagueOf, leaguesForWeek } from "@/lib/league-db";
import { type League } from "@/lib/leagues";
import { computeLevel } from "@/lib/levels";
import { addDays, getWeekRange, toUserDay } from "@/lib/timezone";

export interface Standing {
  userId: string;
  name: string | null;
  handle: string | null;
  image: string | null;
  guild: { id: string; name: string; color: string } | null;
  weeklyXp: number;
  weeklyHumanSec: number;
  weeklyAgentSec: number;
  /** Total agent time this week, sub-agents counted separately (≥ weeklyAgentSec). */
  weeklyAgentWorkSec: number;
  totalXp: number;
  level: number;
  league: League;
  /** Rank by weekly XP; ties share a rank. */
  rank: number;
}

export function companyTimezone(): string {
  return process.env.ARENA_TIMEZONE || "UTC";
}

export function weekDays(now: Date): { thisWeek: string; nextWeek: string; lastWeek: string } {
  const tz = companyTimezone();
  const thisWeek = toUserDay(getWeekRange(now, tz).start, tz);
  return { thisWeek, nextWeek: addDays(thisWeek, 7), lastWeek: addDays(thisWeek, -7) };
}

export async function weeklyStandings(now: Date = new Date()): Promise<Standing[]> {
  return standingsForWeek(weekDays(now).thisWeek);
}

/** Standings for the company week starting on `thisWeek` (a Monday, YYYY-MM-DD). */
export async function standingsForWeek(thisWeek: string): Promise<Standing[]> {
  const nextWeek = addDays(thisWeek, 7);
  const allUsers = await db.query.users.findMany({ with: { guild: true } });

  const xpBetween = async (from: string | null, to: string | null) => {
    const conditions = [from ? gte(xpLedger.day, from) : undefined, to ? lt(xpLedger.day, to) : undefined].filter(Boolean);
    const rows = await db.select({ userId: xpLedger.userId, xp: sql<number>`SUM(${xpLedger.xp})` })
      .from(xpLedger).where(conditions.length ? and(...conditions) : undefined).groupBy(xpLedger.userId);
    return new Map(rows.map((r) => [r.userId, Number(r.xp)]));
  };
  const timeBetween = async (from: string, to: string) => {
    const rows = await db.select({
      userId: dailyRollup.userId,
      human: sql<number>`SUM(${dailyRollup.humanSec})`,
      focus: sql<number>`SUM(${dailyRollup.humanSec} + ${dailyRollup.meetingSec})`,
      agent: sql<number>`SUM(${dailyRollup.agentSec})`,
      work: sql<number>`SUM(GREATEST(${dailyRollup.agentWorkSec}, ${dailyRollup.agentSec}))`,
    }).from(dailyRollup).where(and(gte(dailyRollup.day, from), lt(dailyRollup.day, to))).groupBy(dailyRollup.userId);
    return new Map(rows.map((r) => [r.userId, { human: Number(r.human), focus: Number(r.focus), agent: Number(r.agent), work: Number(r.work) }]));
  };

  const weekXp = await xpBetween(thisWeek, nextWeek);
  const totalXp = await xpBetween(null, null);
  const weekTime = await timeBetween(thisWeek, nextWeek);
  // The ladder: this week's league follows from last week's (league-db.ts).
  const leagues = await leaguesForWeek(thisWeek);

  const standings: Standing[] = allUsers.map((u) => {
    const total = totalXp.get(u.id) ?? 0;
    return {
      userId: u.id,
      name: u.name,
      handle: u.handle,
      image: u.image,
      guild: u.guild ? { id: u.guild.id, name: u.guild.name, color: u.guild.color } : null,
      weeklyXp: weekXp.get(u.id) ?? 0,
      weeklyHumanSec: weekTime.get(u.id)?.human ?? 0,
      weeklyAgentSec: weekTime.get(u.id)?.agent ?? 0,
      weeklyAgentWorkSec: weekTime.get(u.id)?.work ?? 0,
      totalXp: total,
      level: computeLevel(total).level,
      league: leagueOf(leagues, u.id),
      rank: 0,
    };
  });
  return rankBy(standings, (s) => s.weeklyXp).map(({ item, rank }) => ({ ...item, rank }));
}

/** Sorts descending by `value`; equal values share a rank (1, 2, 2, 4). */
export function rankBy<T>(items: T[], value: (item: T) => number): Array<{ item: T; rank: number }> {
  const sorted = [...items].sort((a, b) => value(b) - value(a));
  let rank = 0;
  return sorted.map((item, i) => {
    if (i === 0 || value(sorted[i - 1]!) !== value(item)) rank = i + 1;
    return { item, rank };
  });
}
