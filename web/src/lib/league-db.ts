/**
 * Leagues week by week (spec §4). The league for week W comes from week W−1's
 * league and results (nextLeagues). Each week's leagues are saved the first
 * time anyone needs them, once W−1 is over, so they never change afterwards.
 * Everyone is in Bronze in the first week (the start-date week, or the first
 * week with any XP), and anyone without a saved league is in Bronze.
 *
 * Away days live here too: weekdays someone marked away, at most two fully
 * away weeks in a row, set for this week only on its Monday.
 */
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { awayDays, dailyRollup, leagueWeeks, users, xpLedger } from "@/db/schema";
import { nextLeagues, WORK_DAYS, type League, type Move } from "@/lib/leagues";
import { startDay } from "@/lib/start-date";
import { companyTimezone, weekDays } from "@/lib/standings";
import { addDays, dayBounds, toUserDay } from "@/lib/timezone";

/** The first league week: the week of the start date, else of the first XP. */
async function firstWeek(): Promise<string | null> {
  const start = startDay();
  if (start) return weekDays(dayBounds(start, companyTimezone()).start).thisWeek;
  const [row] = await db.select({ day: sql<string | null>`MIN(${xpLedger.day})` }).from(xpLedger);
  return row?.day ? weekDays(dayBounds(row.day, companyTimezone()).start).thisWeek : null;
}

/** Monday to Friday of a week. */
export function workDays(week: string): string[] {
  return Array.from({ length: WORK_DAYS }, (_, i) => addDays(week, i));
}

export interface LeagueEntry { league: League; move: Move | "start" }

/** Everyone's league for the week starting `week` (a Monday). */
export async function leaguesForWeek(week: string, now: Date = new Date()): Promise<Map<string, LeagueEntry>> {
  const first = await firstWeek();
  if (!first || week <= first) return new Map();
  // Only weeks whose previous week is over can be decided.
  if (week > weekDays(now).thisWeek) return leaguesForWeek(weekDays(now).thisWeek, now);

  const saved = await db.select().from(leagueWeeks).where(eq(leagueWeeks.weekStart, week));
  if (saved.length > 0) return new Map(saved.map((r) => [r.userId, { league: r.league as League, move: r.move as Move }]));

  const prev = addDays(week, -7);
  const before = await leaguesForWeek(prev, now);
  const people = await db.select({ id: users.id }).from(users);
  const xp = await db.select({ userId: xpLedger.userId, xp: sql<number>`SUM(${xpLedger.xp})` })
    .from(xpLedger).where(and(gte(xpLedger.day, prev), lt(xpLedger.day, week))).groupBy(xpLedger.userId);
  const focus = await db.select({ userId: dailyRollup.userId, sec: sql<number>`SUM(${dailyRollup.humanSec} + ${dailyRollup.meetingSec})` })
    .from(dailyRollup).where(and(gte(dailyRollup.day, prev), lt(dailyRollup.day, week))).groupBy(dailyRollup.userId);
  const away = await db.select({ userId: awayDays.userId, n: sql<number>`COUNT(*)` })
    .from(awayDays).where(inArray(awayDays.day, workDays(prev))).groupBy(awayDays.userId);
  const xpBy = new Map(xp.map((r) => [r.userId, Number(r.xp)]));
  const focusBy = new Map(focus.map((r) => [r.userId, Number(r.sec)]));
  const awayBy = new Map(away.map((r) => [r.userId, Number(r.n)]));

  const next = nextLeagues(people.map((p) => ({
    userId: p.id,
    league: before.get(p.id)?.league ?? "bronze",
    weeklyXp: xpBy.get(p.id) ?? 0,
    focusSec: focusBy.get(p.id) ?? 0,
    availableDays: WORK_DAYS - (awayBy.get(p.id) ?? 0),
  })));
  const rows = [...next].map(([userId, n]) => ({ userId, weekStart: week, league: n.league, move: n.move }));
  if (rows.length) await db.insert(leagueWeeks).values(rows).onConflictDoNothing();
  // Re-read so concurrent requests agree on what was saved first.
  const stored = await db.select().from(leagueWeeks).where(eq(leagueWeeks.weekStart, week));
  return new Map(stored.map((r) => [r.userId, { league: r.league as League, move: r.move as Move }]));
}

export function leagueOf(map: Map<string, LeagueEntry>, userId: string): League {
  return map.get(userId)?.league ?? "bronze";
}

// ---------------------------------------------------------------------------
// Away days
// ---------------------------------------------------------------------------

export const MAX_AWAY_WEEKS_IN_A_ROW = 2;

/** Away weekdays of one person in a week. */
export async function awayInWeek(userId: string, week: string): Promise<string[]> {
  const rows = await db.select({ day: awayDays.day }).from(awayDays)
    .where(and(eq(awayDays.userId, userId), inArray(awayDays.day, workDays(week))));
  return rows.map((r) => r.day).sort();
}

/** People away today (company timezone), for the "Away" label. */
export async function awayToday(userIds: string[], now: Date = new Date()): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const today = toUserDay(now, companyTimezone());
  const rows = await db.select({ userId: awayDays.userId }).from(awayDays)
    .where(and(eq(awayDays.day, today), inArray(awayDays.userId, userIds)));
  return new Set(rows.map((r) => r.userId));
}

export type AwayError = "past_week" | "monday_only" | "not_a_weekday" | "too_many_weeks";

/**
 * Sets someone's away weekdays for this week or next. This week can only be
 * changed on its Monday; a third fully away week in a row is refused.
 */
export async function setAway(userId: string, week: "this" | "next", days: string[], now: Date = new Date()):
  Promise<{ ok: true } | { ok: false; error: AwayError }> {
  const { thisWeek, nextWeek } = weekDays(now);
  const target = week === "this" ? thisWeek : nextWeek;
  if (week === "this" && toUserDay(now, companyTimezone()) !== thisWeek) return { ok: false, error: "monday_only" };
  const allowed = new Set(workDays(target));
  if (days.some((d) => !allowed.has(d))) return { ok: false, error: "not_a_weekday" };
  const unique = [...new Set(days)];

  if (unique.length === WORK_DAYS) {
    const fullyAway = async (w: string) => (await awayInWeek(userId, w)).length === WORK_DAYS;
    let run = 1;
    for (let w = addDays(target, -7); run <= MAX_AWAY_WEEKS_IN_A_ROW && (await fullyAway(w)); w = addDays(w, -7)) run++;
    for (let w = addDays(target, 7); run <= MAX_AWAY_WEEKS_IN_A_ROW && (await fullyAway(w)); w = addDays(w, 7)) run++;
    if (run > MAX_AWAY_WEEKS_IN_A_ROW) return { ok: false, error: "too_many_weeks" };
  }

  await db.transaction(async (tx) => {
    await tx.delete(awayDays).where(and(eq(awayDays.userId, userId), inArray(awayDays.day, workDays(target))));
    if (unique.length) await tx.insert(awayDays).values(unique.map((day) => ({ userId, day })));
  });
  return { ok: true };
}
