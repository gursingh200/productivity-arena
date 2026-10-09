/**
 * Achievements (spec: docs/specs/2026-10-09-social-features.md §3).
 *
 * Each achievement belongs to a sharing category: a viewer sees someone's
 * unlock only if both share it. Secret ones show as hidden until unlocked.
 * Most are checked from data (`evaluateAchievements`, after each upload);
 * a few count things done on the site (`recordEvent`).
 */
import { and, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  achievementEvents, awayDays, bugReports, dailyRollup, leagueWeeks, linearIssues, minuteAgent, minuteApp, quests,
  userAchievements, users, xpLedger,
} from "@/db/schema";
import { computeLevel } from "@/lib/levels";
import type { Category } from "@/lib/sharing";
import { addDays, dayBounds, localHour, toUserDay } from "@/lib/timezone";

export interface Achievement {
  id: string;
  name: string;
  description: string;
  category: Category;
  secret?: boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  // Human time
  { id: "first_steps", name: "First steps", description: "Your first active minute.", category: "human" },
  { id: "deep_diver", name: "Deep diver", description: "A 90-minute focus block.", category: "human" },
  { id: "zen", name: "Zen", description: "A 3-hour focus block.", category: "human" },
  { id: "full_day", name: "Full day", description: "8 hours of your own time in one day.", category: "human" },
  { id: "early_bird", name: "Early bird", description: "Active between 4:00 and 7:00 on 5 days.", category: "human" },
  { id: "night_owl", name: "Night owl", description: "Active after midnight on 5 days.", category: "human" },
  { id: "on_a_roll", name: "On a roll", description: "2+ hours on 5 weekdays in a row.", category: "human" },
  { id: "unstoppable", name: "Unstoppable", description: "2+ hours on 20 weekdays in a row.", category: "human" },
  { id: "weekend_warrior", name: "Weekend warrior", description: "Active on a Saturday and the Sunday after.", category: "human" },
  { id: "centurion", name: "Centurion", description: "100 hours of your own time.", category: "human" },
  // Agents
  { id: "first_agent", name: "First agent", description: "Your first agent minute.", category: "agents" },
  { id: "polyglot", name: "Polyglot", description: "3 different coding agents in one day.", category: "agents" },
  { id: "squad", name: "Squad", description: "5 agents at once, sub-agents included.", category: "agents" },
  { id: "swarm", name: "Swarm", description: "10 agents at once, sub-agents included.", category: "agents" },
  { id: "night_shift", name: "Night shift", description: "Agents worked 2 hours overnight (0:00–6:00) while you were away.", category: "agents" },
  { id: "conductor", name: "Conductor", description: "A week at 2× parallelism, with 5+ agent hours.", category: "agents" },
  { id: "fifty_fifty", name: "Fifty-fifty", description: "A day where your time and your agents’ were within 5% (2+ hours each).", category: "agents" },
  { id: "hundred_hours", name: "Hundred-hour agents", description: "100 agent hours.", category: "agents" },
  { id: "thousand_threads", name: "Thousand threads", description: "1,000 total agent hours.", category: "agents" },
  // XP and the game
  { id: "level_5", name: "Level 5", description: "Reach level 5.", category: "xp" },
  { id: "level_10", name: "Level 10", description: "Reach level 10.", category: "xp" },
  { id: "level_25", name: "Level 25", description: "Reach level 25.", category: "xp" },
  { id: "promoted", name: "Promoted", description: "Move up a league.", category: "xp" },
  { id: "legend", name: "Legend", description: "Reach the Legend league.", category: "xp" },
  { id: "quester", name: "Quester", description: "Complete 10 quests.", category: "xp" },
  { id: "live_wire", name: "Live wire", description: "Complete 5 live quests.", category: "xp" },
  { id: "overachiever", name: "Overachiever", description: "Complete 3 quests in one day.", category: "xp" },
  { id: "guild_hero", name: "Guild hero", description: "Share in a completed guild quest.", category: "xp" },
  { id: "shipper", name: "Shipper", description: "Close 10 Linear issues.", category: "xp" },
  { id: "rivalry", name: "Rivalry", description: "Compare yourself with 5 different teammates.", category: "xp" },
  // Meetings
  { id: "makers_day", name: "Maker’s day", description: "A weekday with 4 hours of focus and no meetings.", category: "meetings" },
  // Secret
  { id: "ghost", name: "Ghost", description: "Your agents worked 4 hours on a day you weren’t there at all.", category: "agents", secret: true },
  { id: "right_on_time", name: "Right on time", description: "Exactly 8h 00m of your own time in a day.", category: "human", secret: true },
  { id: "konami", name: "Up up down down", description: "Found the code.", category: "xp", secret: true },
  { id: "mirror", name: "Mirror, mirror", description: "Tried to compare yourself with yourself.", category: "xp", secret: true },
  { id: "fresh_coat", name: "Fresh coat", description: "Made Arena your colours.", category: "xp", secret: true },
  { id: "rewind", name: "Rewind", description: "Looked back at a day two weeks ago.", category: "xp", secret: true },
  { id: "gone_fishing", name: "Gone fishing", description: "Marked a whole week away.", category: "xp", secret: true },
  { id: "squasher", name: "Squasher", description: "Reported a bug.", category: "xp", secret: true },
  { id: "insomniac", name: "Insomniac", description: "Opened Arena between 3 and 4 am.", category: "xp", secret: true },
  { id: "tap_tap", name: "Tap tap tap", description: "Clicked your league badge ten times.", category: "xp", secret: true },
];

export const ACHIEVEMENT_BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

/** Things done on the site that unlock or count toward an achievement. */
export type EventKind = "compare" | "konami" | "mirror" | "fresh_coat" | "rewind" | "insomniac" | "tap_tap";
/** Events the browser may report itself (harmless if faked: they're easter eggs). */
export const CLIENT_EVENTS: EventKind[] = ["konami", "tap_tap"];

/** Records an event and unlocks what it completes. Safe to call repeatedly. */
export async function recordEvent(userId: string, kind: EventKind, detail = ""): Promise<string[]> {
  await db.insert(achievementEvents).values({ userId, kind, detail }).onConflictDoNothing();
  if (kind === "compare") {
    const [row] = await db.select({ n: sql<number>`COUNT(*)` }).from(achievementEvents)
      .where(and(eq(achievementEvents.userId, userId), eq(achievementEvents.kind, "compare")));
    return Number(row?.n ?? 0) >= 5 ? unlock(userId, ["rivalry"]) : [];
  }
  return unlock(userId, [kind]);
}

/** Saves unlocks that aren't saved yet; returns the new ones. */
export async function unlock(userId: string, ids: string[], at: Date = new Date()): Promise<string[]> {
  const fresh = ids.filter((id) => ACHIEVEMENT_BY_ID.has(id));
  if (fresh.length === 0) return [];
  const inserted = await db.insert(userAchievements).values(fresh.map((achievementId) => ({ userId, achievementId, unlockedAt: at })))
    .onConflictDoNothing().returning({ id: userAchievements.achievementId });
  return inserted.map((r) => r.id);
}

/** How far someone is towards an achievement: done when value ≥ target. */
export interface Progress {
  value: number;
  target: number;
  /** How to show the numbers: hours, minutes, a count, a ratio (×), or just done/not done. */
  unit: "h" | "min" | "count" | "x" | "done";
  /** The local day it was first reached, when the data shows it (for unlock dates when backfilling). */
  on?: string;
}

/** Progress towards every data-based achievement (the event-based ones are counted in `recordEvent`). */
export async function measureAchievements(userId: string, now: Date = new Date()): Promise<Map<string, Progress>> {
  const out = new Map<string, Progress>();
  const user = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { timezone: true } });
  if (!user) return out;
  const tz = user.timezone;
  const today = toUserDay(now, tz);
  const put = (id: string, value: number, target: number, unit: Progress["unit"]) => out.set(id, { value, target, unit });
  const flag = (id: string, ok: boolean) => put(id, ok ? 1 : 0, 1, "done");
  const H = 3600;

  const days = await db.select().from(dailyRollup).where(eq(dailyRollup.userId, userId));
  const sum = (f: (d: (typeof days)[number]) => number) => days.reduce((s, d) => s + f(d), 0);
  const max = (f: (d: (typeof days)[number]) => number) => days.reduce((m, d) => Math.max(m, f(d)), 0);
  const isWeekday = (day: string) => ![0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay());
  const byDay = new Map(days.map((d) => [d.day, d]));
  const sortedDays = [...days].sort((a, b) => (a.day < b.day ? -1 : 1));
  /** The first day a day-level condition held. */
  const firstDay = (ok: (d: (typeof days)[number]) => boolean) => sortedDays.find(ok)?.day;
  /** The day a running total first reached `target`. */
  const crossDay = (f: (d: (typeof days)[number]) => number, target: number) => {
    let run = 0;
    return sortedDays.find((d) => (run += f(d)) >= target)?.day;
  };
  const dayOf = (id: string, day: string | undefined) => { const p = out.get(id); if (p && day) p.on = day; };

  flag("first_steps", sum((d) => d.humanSec) > 0);
  flag("first_agent", sum((d) => d.agentSec) > 0);
  put("deep_diver", max((d) => d.longestFocusSec) / 60, 90, "min");
  put("zen", max((d) => d.longestFocusSec) / 60, 180, "min");
  put("full_day", max((d) => d.humanSec) / H, 8, "h");
  put("centurion", sum((d) => d.humanSec) / H, 100, "h");
  put("hundred_hours", sum((d) => d.agentSec) / H, 100, "h");
  put("thousand_threads", sum((d) => Math.max(d.agentWorkSec, d.agentSec)) / H, 1000, "h");
  put("squad", max((d) => Math.max(d.peakThreads, d.peakParallel)), 5, "count");
  put("swarm", max((d) => Math.max(d.peakThreads, d.peakParallel)), 10, "count");
  put("polyglot", max((d) => Object.values(d.agentSecByAgent as Record<string, number>).filter((s) => s > 0).length), 3, "count");
  flag("fifty_fifty", days.some((d) => d.humanSec >= 7200 && d.agentSec >= 7200
    && Math.abs(d.humanSec - d.agentSec) <= 0.05 * Math.max(d.humanSec, d.agentSec)));
  // Finished days only: a meeting later today would make it untrue.
  flag("makers_day", days.some((d) => d.day < today && isWeekday(d.day) && d.humanSec >= 4 * H && d.meetingSec === 0));
  flag("ghost", days.some((d) => d.day < today && d.agentSec >= 4 * H && d.humanSec === 0 && d.meetingSec === 0));
  // Only finished days: today passes through 8h 00m on its way up.
  flag("right_on_time", days.some((d) => d.day < today && d.humanSec === 8 * H));
  flag("weekend_warrior", days.some((d) => new Date(`${d.day}T12:00:00Z`).getUTCDay() === 6 && d.humanSec > 0
    && (byDay.get(addDays(d.day, 1))?.humanSec ?? 0) > 0));

  // Streaks count weekdays only; weekends neither break nor extend them.
  // A weekday with no row at all breaks a streak too, so walk every day.
  let streak = 0;
  let best = 0;
  const sorted = [...byDay.keys()].sort();
  if (sorted.length) {
    for (let day = sorted[0]!; day <= sorted[sorted.length - 1]!; day = addDays(day, 1)) {
      if (!isWeekday(day)) continue;
      streak = (byDay.get(day)?.humanSec ?? 0) >= 7200 ? streak + 1 : 0;
      best = Math.max(best, streak);
    }
  }
  put("on_a_roll", best, 5, "count");
  put("unstoppable", best, 20, "count");

  // Weeks (company weeks): best parallelism in a week with 5+ agent hours.
  const weeks = new Map<string, { agent: number; work: number }>();
  for (const d of days) {
    const monday = addDays(d.day, -((new Date(`${d.day}T12:00:00Z`).getUTCDay() + 6) % 7));
    const w = weeks.get(monday) ?? { agent: 0, work: 0 };
    w.agent += d.agentSec;
    w.work += Math.max(d.agentWorkSec, d.agentSec);
    weeks.set(monday, w);
  }
  put("conductor", [...weeks.values()].filter((w) => w.agent >= 5 * H).reduce((m, w) => Math.max(m, w.work / w.agent), 0), 2, "x");

  // Hours of the day need minutes, which the server keeps for about two weeks.
  const since = new Date(now.getTime() - 16 * 86_400_000);
  const human = await db.selectDistinct({ t: minuteApp.t }).from(minuteApp).where(and(eq(minuteApp.userId, userId), gte(minuteApp.t, since)));
  const agent = await db.select({ t: minuteAgent.t, sec: sql<number>`SUM(${minuteAgent.agentSec})` }).from(minuteAgent)
    .where(and(eq(minuteAgent.userId, userId), gte(minuteAgent.t, since))).groupBy(minuteAgent.t);
  const humanMinutes = new Set(human.map((h) => h.t.getTime()));
  put("early_bird", new Set(human.filter((h) => localHour(h.t, tz) < 7 && localHour(h.t, tz) >= 4).map((h) => toUserDay(h.t, tz))).size, 5, "count");
  put("night_owl", new Set(human.filter((h) => localHour(h.t, tz) < 4).map((h) => toUserDay(h.t, tz))).size, 5, "count");
  // Overnight agent time while you weren't active, per night.
  const nights = new Map<string, number>();
  for (const a of agent) {
    if (localHour(a.t, tz) >= 6 || humanMinutes.has(a.t.getTime())) continue;
    const night = toUserDay(a.t, tz);
    nights.set(night, (nights.get(night) ?? 0) + Number(a.sec));
  }
  put("night_shift", Math.max(0, ...nights.values()) / H, 2, "h");

  const level = computeLevel(Number((await db.select({ xp: sql<number>`COALESCE(SUM(${xpLedger.xp}), 0)` }).from(xpLedger)
    .where(eq(xpLedger.userId, userId)))[0]?.xp ?? 0)).level;
  put("level_5", level, 5, "count");
  put("level_10", level, 10, "count");
  put("level_25", level, 25, "count");

  const leagues = await db.select({ league: leagueWeeks.league, move: leagueWeeks.move }).from(leagueWeeks).where(eq(leagueWeeks.userId, userId));
  flag("promoted", leagues.some((l) => l.move === "up"));
  flag("legend", leagues.some((l) => l.league === "legend"));

  const done = await db.select({ kind: quests.kind, resolvedAt: quests.resolvedAt }).from(quests)
    .where(and(eq(quests.userId, userId), eq(quests.state, "completed")));
  put("quester", done.length, 10, "count");
  put("live_wire", done.filter((q) => q.kind === "live").length, 5, "count");
  const perDay = new Map<string, number>();
  for (const q of done) if (q.resolvedAt) perDay.set(toUserDay(q.resolvedAt, tz), (perDay.get(toUserDay(q.resolvedAt, tz)) ?? 0) + 1);
  put("overachiever", Math.max(0, ...perDay.values()), 3, "count");

  const questXp = await db.select({ key: xpLedger.sourceKey }).from(xpLedger).where(and(eq(xpLedger.userId, userId), eq(xpLedger.source, "quest")));
  const questIds = questXp.map((r) => r.key.replace(/^quest:/, ""));
  flag("guild_hero", questIds.length > 0 && (await db.select({ id: quests.id }).from(quests)
    .where(and(inArray(quests.id, questIds), eq(quests.kind, "guild")))).length > 0);

  const [linear] = await db.select({ n: sql<number>`COUNT(*)` }).from(linearIssues)
    .where(and(eq(linearIssues.userId, userId), sql`${linearIssues.completedAt} IS NOT NULL`));
  put("shipper", Number(linear?.n ?? 0), 10, "count");

  const [bugs] = await db.select({ n: sql<number>`COUNT(*)` }).from(bugReports).where(eq(bugReports.userId, userId));
  flag("squasher", Number(bugs?.n ?? 0) > 0);

  const away = await db.select({ day: awayDays.day }).from(awayDays).where(eq(awayDays.userId, userId));
  const awayWeeks = new Map<string, number>();
  for (const a of away) {
    const dow = (new Date(`${a.day}T12:00:00Z`).getUTCDay() + 6) % 7;
    if (dow < 5) awayWeeks.set(addDays(a.day, -dow), (awayWeeks.get(addDays(a.day, -dow)) ?? 0) + 1);
  }
  flag("gone_fishing", [...awayWeeks.values()].some((n) => n >= 5));

  const [compares] = await db.select({ n: sql<number>`COUNT(*)` }).from(achievementEvents)
    .where(and(eq(achievementEvents.userId, userId), eq(achievementEvents.kind, "compare")));
  put("rivalry", Number(compares?.n ?? 0), 5, "count");

  // When each was first reached, where the data says (backfilled unlocks get these dates).
  dayOf("first_steps", firstDay((d) => d.humanSec > 0));
  dayOf("first_agent", firstDay((d) => d.agentSec > 0));
  dayOf("deep_diver", firstDay((d) => d.longestFocusSec >= 90 * 60));
  dayOf("zen", firstDay((d) => d.longestFocusSec >= 180 * 60));
  dayOf("full_day", firstDay((d) => d.humanSec >= 8 * H));
  dayOf("centurion", crossDay((d) => d.humanSec, 100 * H));
  dayOf("hundred_hours", crossDay((d) => d.agentSec, 100 * H));
  dayOf("thousand_threads", crossDay((d) => Math.max(d.agentWorkSec, d.agentSec), 1000 * H));
  dayOf("squad", firstDay((d) => Math.max(d.peakThreads, d.peakParallel) >= 5));
  dayOf("swarm", firstDay((d) => Math.max(d.peakThreads, d.peakParallel) >= 10));
  dayOf("polyglot", firstDay((d) => Object.values(d.agentSecByAgent as Record<string, number>).filter((x) => x > 0).length >= 3));
  dayOf("fifty_fifty", firstDay((d) => d.humanSec >= 7200 && d.agentSec >= 7200 && Math.abs(d.humanSec - d.agentSec) <= 0.05 * Math.max(d.humanSec, d.agentSec)));
  dayOf("makers_day", firstDay((d) => d.day < today && isWeekday(d.day) && d.humanSec >= 4 * H && d.meetingSec === 0));
  dayOf("ghost", firstDay((d) => d.day < today && d.agentSec >= 4 * H && d.humanSec === 0 && d.meetingSec === 0));
  dayOf("right_on_time", firstDay((d) => d.day < today && d.humanSec === 8 * H));
  const saturday = firstDay((d) => new Date(`${d.day}T12:00:00Z`).getUTCDay() === 6 && d.humanSec > 0 && (byDay.get(addDays(d.day, 1))?.humanSec ?? 0) > 0);
  dayOf("weekend_warrior", saturday ? addDays(saturday, 1) : undefined);
  if (sorted.length) {
    let run = 0;
    for (let d = sorted[0]!; d <= sorted[sorted.length - 1]!; d = addDays(d, 1)) {
      if (!isWeekday(d)) continue;
      run = (byDay.get(d)?.humanSec ?? 0) >= 7200 ? run + 1 : 0;
      if (run === 5) dayOf("on_a_roll", out.get("on_a_roll")?.on ?? d);
      if (run === 20) dayOf("unstoppable", out.get("unstoppable")?.on ?? d);
    }
  }
  const xpDays = await db.select({ day: xpLedger.day, xp: sql<number>`SUM(${xpLedger.xp})` }).from(xpLedger)
    .where(eq(xpLedger.userId, userId)).groupBy(xpLedger.day).orderBy(xpLedger.day);
  for (const [id, n] of [["level_5", 5], ["level_10", 10], ["level_25", 25]] as const) {
    let run = 0;
    dayOf(id, xpDays.find((r) => computeLevel((run += Number(r.xp))).level >= n)?.day);
  }
  const resolved = done.filter((q) => q.resolvedAt).sort((a, b) => a.resolvedAt!.getTime() - b.resolvedAt!.getTime());
  const nth = (list: typeof resolved, n: number) => (list[n - 1] ? toUserDay(list[n - 1]!.resolvedAt!, tz) : undefined);
  dayOf("quester", nth(resolved, 10));
  dayOf("live_wire", nth(resolved.filter((q) => q.kind === "live"), 5));
  return out;
}

/** Checks every data-based achievement for one person and saves the new unlocks. */
export async function evaluateAchievements(userId: string, now: Date = new Date()): Promise<string[]> {
  const progress = await measureAchievements(userId, now);
  const user = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { timezone: true } });
  const tz = user?.timezone ?? "UTC";
  const earned = [...progress].filter(([, p]) => p.value >= p.target);
  // Backfilled unlocks carry the day they were reached (its evening), never later than now.
  const when = (p: Progress) => {
    if (!p.on) return now;
    const evening = new Date(dayBounds(p.on, tz).end.getTime() - 60_000);
    return evening < now ? evening : now;
  };
  const fresh: string[] = [];
  for (const [id, p] of earned) fresh.push(...(await unlock(userId, [id], when(p))));
  return fresh;
}

/** How often uploads re-check someone's achievements. */
export const CHECK_INTERVAL_MS = 15 * 60_000;

/**
 * `evaluateAchievements`, at most once per CHECK_INTERVAL_MS per person (it runs
 * a dozen queries, and Macs upload every five minutes).
 */
export async function evaluateAchievementsIfDue(userId: string, now: Date = new Date()): Promise<string[]> {
  const claimed = await db.update(users).set({ achievementsCheckedAt: now })
    .where(and(eq(users.id, userId), or(isNull(users.achievementsCheckedAt), lt(users.achievementsCheckedAt, new Date(now.getTime() - CHECK_INTERVAL_MS)))))
    .returning({ id: users.id });
  return claimed.length ? evaluateAchievements(userId, now) : [];
}

/** Opening Arena between 3 and 4 am (the person's timezone). */
export async function checkInsomniac(userId: string, timezone: string, now: Date = new Date()): Promise<void> {
  if (localHour(now, timezone) === 3) await recordEvent(userId, "insomniac");
}

/** Everyone's unlocks, for global rates. "Active" = anyone with tracked time. */
export async function globalRates(): Promise<{ active: number; counts: Map<string, number> }> {
  const [active] = await db.select({ n: sql<number>`COUNT(DISTINCT ${dailyRollup.userId})` }).from(dailyRollup)
    .where(sql`${dailyRollup.humanSec} + ${dailyRollup.agentSec} + ${dailyRollup.meetingSec} > 0`);
  const rows = await db.select({ id: userAchievements.achievementId, n: sql<number>`COUNT(*)` }).from(userAchievements)
    .groupBy(userAchievements.achievementId);
  return { active: Math.max(1, Number(active?.n ?? 0)), counts: new Map(rows.map((r) => [r.id, Number(r.n)])) };
}

export async function unlocksOf(userIds: string[]): Promise<Map<string, Map<string, Date>>> {
  const out = new Map<string, Map<string, Date>>(userIds.map((id) => [id, new Map()]));
  if (userIds.length === 0) return out;
  const rows = await db.select().from(userAchievements).where(inArray(userAchievements.userId, userIds));
  for (const r of rows) out.get(r.userId)?.set(r.achievementId, r.unlockedAt);
  return out;
}
