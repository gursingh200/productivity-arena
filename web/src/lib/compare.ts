/**
 * Compare (spec: docs/specs/2026-10-09-social-features.md §2): the extras that
 * a profile doesn't already have. Callers apply sharing: each function says
 * which category it reveals.
 */
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { dailyRollup, minuteApp, xpLedger } from "@/db/schema";
import { startDay } from "@/lib/start-date";
import { weekDays } from "@/lib/standings";
import { addDays, localHour } from "@/lib/timezone";

/** Weeks each person won on XP, over finished weeks where both earned some. Reveals XP. */
export async function headToHead(a: string, b: string, now: Date = new Date()): Promise<{ a: number; b: number; draws: number }> {
  const from = startDay() ?? "0000-01-01";
  const rows = await db.select({ userId: xpLedger.userId, day: xpLedger.day, xp: xpLedger.xp }).from(xpLedger)
    .where(and(inArray(xpLedger.userId, [a, b]), gte(xpLedger.day, from)));
  const { thisWeek } = weekDays(now);
  const weeks = new Map<string, { a: number; b: number }>();
  for (const r of rows) {
    const dow = (new Date(`${r.day}T12:00:00Z`).getUTCDay() + 6) % 7;
    const monday = addDays(r.day, -dow);
    if (monday >= thisWeek) continue; // only finished weeks
    const w = weeks.get(monday) ?? { a: 0, b: 0 };
    if (r.userId === a) w.a += r.xp; else w.b += r.xp;
    weeks.set(monday, w);
  }
  const out = { a: 0, b: 0, draws: 0 };
  for (const w of weeks.values()) {
    if (w.a <= 0 || w.b <= 0) continue;
    if (w.a > w.b) out.a++; else if (w.b > w.a) out.b++; else out.draws++;
  }
  return out;
}

/** Average active minutes per hour of the day over the last 14 days, in the person's timezone. Reveals human time. */
export async function hourProfile(userId: string, timezone: string, now: Date = new Date()): Promise<number[]> {
  const since = new Date(now.getTime() - 14 * 86_400_000);
  const minutes = await db.selectDistinct({ t: minuteApp.t }).from(minuteApp)
    .where(and(eq(minuteApp.userId, userId), gte(minuteApp.t, since)));
  const hours = Array.from({ length: 24 }, () => 0);
  for (const m of minutes) hours[localHour(m.t, timezone)]! += 1;
  return hours.map((n) => n / 14);
}

export interface Records {
  /** Weekdays in a row with 2+ hours (human). */
  longestStreak: number;
  /** Longest focus block in seconds (human). */
  longestBlockSec: number;
  /** Most agents at once, sub-agents included (agents). */
  mostAgents: number;
  /** Best company week of XP (xp). */
  bestWeekXp: number;
}

export async function records(userId: string): Promise<Records> {
  const days = await db.select({
    day: dailyRollup.day, humanSec: dailyRollup.humanSec, longest: dailyRollup.longestFocusSec,
    peak: dailyRollup.peakParallel, threads: dailyRollup.peakThreads,
  }).from(dailyRollup).where(eq(dailyRollup.userId, userId));
  const byDay = new Map(days.map((d) => [d.day, d]));
  const sorted = [...byDay.keys()].sort();
  let streak = 0;
  let longestStreak = 0;
  if (sorted.length) {
    for (let day = sorted[0]!; day <= sorted[sorted.length - 1]!; day = addDays(day, 1)) {
      if ([0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay())) continue;
      streak = (byDay.get(day)?.humanSec ?? 0) >= 7200 ? streak + 1 : 0;
      longestStreak = Math.max(longestStreak, streak);
    }
  }
  const [best] = await db.select({ xp: sql<number>`COALESCE(MAX(w.xp), 0)` }).from(sql`(
    SELECT date_trunc('week', ${xpLedger.day}::date) AS week, SUM(${xpLedger.xp}) AS xp
    FROM ${xpLedger} WHERE ${xpLedger.userId} = ${userId} GROUP BY 1) AS w`);
  return {
    longestStreak,
    longestBlockSec: days.reduce((m, d) => Math.max(m, d.longest), 0),
    mostAgents: days.reduce((m, d) => Math.max(m, d.peak, d.threads), 0),
    bestWeekXp: Number(best?.xp ?? 0),
  };
}
