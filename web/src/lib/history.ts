/**
 * Leaderboard history (spec §4): the top 10 of every finished weekly and
 * monthly board, plus team totals, saved for good. Built from daily rollups
 * and the XP ledger, which are kept forever, so it can be (re)built any time.
 *
 * Saving is lazy: the history page saves any finished period that's missing,
 * so no scheduled job is needed. Sharing applies twice: a saved board only
 * includes people who shared its category when it was saved, and a reader
 * only sees boards for categories they share, showing people who still share.
 */
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { dailyRollup, leaderboardHistory, periodTotals, users, xpLedger } from "@/db/schema";
import { computeLeaguesForAll, type League } from "@/lib/leagues";
import { shares, visibility, type Category, type Sharer } from "@/lib/sharing";
import { companyTimezone, rankBy, weekDays } from "@/lib/standings";
import { addDays, dayBounds, toUserDay } from "@/lib/timezone";

export type Period = "week" | "month";
export type Board = "xp" | "human" | "agents";
export const BOARD_CATEGORY: Record<Board, Category> = { xp: "xp", human: "human", agents: "agents" };
const TOP = 10;
const LEAGUES: League[] = ["legend", "diamond", "gold", "silver", "bronze"];

interface Values { xp: number; human: number; agent: number; meeting: number; focus: number }

/** Per-person totals for local days in [from, to). */
async function valuesBetween(from: string, to: string): Promise<Map<string, Values>> {
  const out = new Map<string, Values>();
  const get = (id: string) => {
    let v = out.get(id);
    if (!v) out.set(id, (v = { xp: 0, human: 0, agent: 0, meeting: 0, focus: 0 }));
    return v;
  };
  const time = await db.select({
    userId: dailyRollup.userId,
    human: sql<number>`SUM(${dailyRollup.humanSec})`,
    agent: sql<number>`SUM(${dailyRollup.agentSec})`,
    meeting: sql<number>`SUM(${dailyRollup.meetingSec})`,
  }).from(dailyRollup).where(and(gte(dailyRollup.day, from), lt(dailyRollup.day, to))).groupBy(dailyRollup.userId);
  for (const r of time) {
    const v = get(r.userId);
    v.human = Number(r.human);
    v.agent = Number(r.agent);
    v.meeting = Number(r.meeting);
    v.focus = v.human + v.meeting;
  }
  const xp = await db.select({ userId: xpLedger.userId, xp: sql<number>`SUM(${xpLedger.xp})` })
    .from(xpLedger).where(and(gte(xpLedger.day, from), lt(xpLedger.day, to))).groupBy(xpLedger.userId);
  for (const r of xp) get(r.userId).xp = Number(r.xp);
  return out;
}

const VALUE: Record<Board, (v: Values) => number> = { xp: (v) => v.xp, human: (v) => v.human, agents: (v) => v.agent };

function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

/** Saves every finished week and month that isn't saved yet. Safe to call concurrently. */
export async function saveFinishedPeriods(now: Date = new Date()): Promise<void> {
  const [first] = await db.select({ day: sql<string | null>`MIN(${dailyRollup.day})` }).from(dailyRollup);
  if (!first?.day) return;
  const tz = companyTimezone();
  const saved = new Set((await db.select({ period: periodTotals.period, start: periodTotals.periodStart }).from(periodTotals))
    .map((p) => `${p.period}:${p.start}`));

  const { thisWeek } = weekDays(now);
  for (let w = weekDays(dayBounds(first.day, tz).start).thisWeek; w < thisWeek; w = addDays(w, 7)) {
    if (!saved.has(`week:${w}`)) await savePeriod("week", w, addDays(w, 7));
  }
  const thisMonth = `${toUserDay(now, tz).slice(0, 7)}-01`;
  for (let m = `${first.day.slice(0, 7)}-01`; m < thisMonth; m = nextMonth(m)) {
    if (!saved.has(`month:${m}`)) await savePeriod("month", m, nextMonth(m));
  }
}

export async function savePeriod(period: Period, start: string, end: string): Promise<void> {
  const people = await db.query.users.findMany({
    columns: { id: true, shareXp: true, shareHuman: true, shareAgents: true, shareMeetings: true, shareApps: true, shareSkills: true },
  });
  const values = await valuesBetween(start, end);
  const of = (id: string) => values.get(id) ?? { xp: 0, human: 0, agent: 0, meeting: 0, focus: 0 };

  // Weekly boards are also split by the league each person was in that week.
  let leagues = new Map<string, League>();
  if (period === "week") {
    const before = await valuesBetween(addDays(start, -7), start);
    leagues = computeLeaguesForAll(people.map((p) => ({
      userId: p.id, weeklyXp: before.get(p.id)?.xp ?? 0, humanSec: before.get(p.id)?.focus ?? 0,
    })));
  }

  const rows: (typeof leaderboardHistory.$inferInsert)[] = [];
  for (const board of Object.keys(VALUE) as Board[]) {
    const category = BOARD_CATEGORY[board];
    const entrants = people.filter((p) => shares(p)[category] && VALUE[board](of(p.id)) > 0);
    const groups: Array<[string, typeof entrants]> = [["all", entrants]];
    if (period === "week") for (const l of LEAGUES) groups.push([l, entrants.filter((p) => leagues.get(p.id) === l)]);
    for (const [league, group] of groups) {
      for (const { item, rank } of rankBy(group, (p) => VALUE[board](of(p.id))).slice(0, TOP)) {
        rows.push({ period, periodStart: start, board, league, rank, userId: item.id, value: Math.round(VALUE[board](of(item.id))) });
      }
    }
  }

  // Totals over people sharing the category; `people` counts those with any of it that period.
  const sumOver = (category: Category, pick: (v: Values) => number) => {
    const group = people.filter((p) => shares(p)[category] && pick(of(p.id)) > 0);
    return { total: Math.round(group.reduce((s, p) => s + pick(of(p.id)), 0)), people: group.length };
  };
  const xp = sumOver("xp", (v) => v.xp);
  const human = sumOver("human", (v) => v.human);
  const agents = sumOver("agents", (v) => v.agent);
  const meetings = sumOver("meetings", (v) => v.meeting);

  await db.transaction(async (tx) => {
    if (rows.length) await tx.insert(leaderboardHistory).values(rows).onConflictDoNothing();
    await tx.insert(periodTotals).values({
      period, periodStart: start,
      xp: xp.total, xpPeople: xp.people, humanSec: human.total, humanPeople: human.people,
      agentSec: agents.total, agentPeople: agents.people, meetingSec: meetings.total, meetingPeople: meetings.people,
    }).onConflictDoNothing();
  });
}

export interface HistoryPeriod {
  start: string;
  rows: Array<{ rank: number; userId: string; name: string | null; handle: string | null; image: string | null; value: number }>;
  /** Team totals for categories the viewer shares; null otherwise. */
  totals: {
    xp: { value: number; people: number } | null;
    human: { value: number; people: number } | null;
    agents: { value: number; people: number } | null;
    meetings: { value: number; people: number } | null;
  };
}

export type History = { locked: true; category: Category } | { locked: false; category: Category; periods: HistoryPeriod[] };

/** The most recent finished periods of one board, as this viewer may see them. */
export async function readHistory(viewer: Sharer, period: Period, board: Board, league: string, limit = 12): Promise<History> {
  const category = BOARD_CATEGORY[board];
  if (!shares(viewer)[category]) return { locked: true, category };

  const totals = await db.select().from(periodTotals).where(eq(periodTotals.period, period))
    .orderBy(desc(periodTotals.periodStart)).limit(limit);
  if (totals.length === 0) return { locked: false, category, periods: [] };

  const rows = await db.select({
    start: leaderboardHistory.periodStart, rank: leaderboardHistory.rank, value: leaderboardHistory.value,
    userId: users.id, name: users.name, handle: users.handle, image: users.image,
    shareXp: users.shareXp, shareHuman: users.shareHuman, shareAgents: users.shareAgents,
    shareMeetings: users.shareMeetings, shareApps: users.shareApps, shareSkills: users.shareSkills,
  }).from(leaderboardHistory).innerJoin(users, eq(users.id, leaderboardHistory.userId))
    .where(and(
      eq(leaderboardHistory.period, period), eq(leaderboardHistory.board, board), eq(leaderboardHistory.league, league),
      inArray(leaderboardHistory.periodStart, totals.map((t) => t.periodStart)),
    ))
    .orderBy(leaderboardHistory.rank);

  const mine = shares(viewer);
  const total = (shared: boolean, value: number, people: number) => (shared ? { value, people } : null);
  return {
    locked: false,
    category,
    periods: totals.map((t) => ({
      start: t.periodStart,
      // People who've since stopped sharing this category drop out of their past boards.
      rows: rows.filter((r) => r.start === t.periodStart && visibility(viewer, { ...r, id: r.userId })[category])
        .map(({ rank, userId, name, handle, image, value }) => ({ rank, userId, name, handle, image, value })),
      totals: {
        xp: total(mine.xp, t.xp, t.xpPeople),
        human: total(mine.human, t.humanSec, t.humanPeople),
        agents: total(mine.agents, t.agentSec, t.agentPeople),
        meetings: total(mine.meetings, t.meetingSec, t.meetingPeople),
      },
    })),
  };
}
