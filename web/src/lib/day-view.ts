/**
 * One day of your own activity for the Today page. Totals, apps and XP come
 * from the daily rollup and the XP ledger (kept for good); the hour-by-hour
 * breakdown and chats need minute data, which the server keeps for
 * MINUTE_RETENTION_DAYS, so older days have totals only.
 */
import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { chats, dailyRollup, xpLedger, type User } from "@/db/schema";
import { loadMinuteRows } from "@/lib/game/minutes-db";
import { INGEST_MAX_AGE_DAYS } from "@/lib/retention";
import { startDay } from "@/lib/start-date";
import { addDays, dayBounds, localHour, toUserDay } from "@/lib/timezone";

export interface HourTotals { hour: number; humanSec: number; agentSec: number; meetingSec: number }

export interface DayView {
  day: string;
  today: string;
  /** Earliest day there can be data for (start date or first rollup). */
  firstDay: string;
  totals: { humanSec: number; agentSec: number; meetingSec: number; xp: number; focusBlocks: number; longestFocusSec: number };
  /** Null when the day's minutes are no longer kept. */
  hours: HourTotals[] | null;
  xp: Array<{ id: string; source: string; xp: number; reason: string }>;
  apps: Array<{ id: string; name: string | null; sec: number }>;
  calls: Array<{ id: string; name: string | null; sec: number }>;
  chats: Array<{ agent: string; agentSec: number; turns: number; firstAt: Date; lastAt: Date }>;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The day to show: `requested` if valid and not in the future, else today (user's timezone). */
export function pickDay(requested: string | undefined, user: Pick<User, "timezone">, now: Date = new Date()): string {
  const today = toUserDay(now, user.timezone);
  return requested && DAY.test(requested) && !Number.isNaN(Date.parse(requested)) && requested <= today ? requested : today;
}

export async function loadDay(user: Pick<User, "id" | "timezone">, day: string, now: Date = new Date()): Promise<DayView> {
  const tz = user.timezone;
  const today = toUserDay(now, tz);
  const { start, end } = dayBounds(day, tz);

  const rollup = await db.query.dailyRollup.findFirst({ where: and(eq(dailyRollup.userId, user.id), eq(dailyRollup.day, day)) });
  const xp = await db.select({ id: xpLedger.id, source: xpLedger.source, xp: xpLedger.xp, reason: xpLedger.reason })
    .from(xpLedger).where(and(eq(xpLedger.userId, user.id), eq(xpLedger.day, day))).orderBy(desc(xpLedger.xp));
  const [first] = await db.select({ day: sql<string | null>`MIN(${dailyRollup.day})` }).from(dailyRollup).where(eq(dailyRollup.userId, user.id));

  // Minutes are reliable for days ingest still accepts.
  let hours: HourTotals[] | null = null;
  if (day >= addDays(today, -INGEST_MAX_AGE_DAYS)) {
    hours = Array.from({ length: 24 }, (_, hour) => ({ hour, humanSec: 0, agentSec: 0, meetingSec: 0 }));
    for (const m of await loadMinuteRows(user.id, start, end)) {
      const h = hours[localHour(m.t, tz)]!;
      h.humanSec += m.humanSec; // same as the day's rollup
      h.meetingSec += m.meetingSec;
      h.agentSec += m.agentSec;
    }
  }

  const dayChats = await db.select({ agent: chats.agent, agentSec: chats.agentSec, turns: chats.turns, firstAt: chats.firstAt, lastAt: chats.lastAt })
    .from(chats).where(and(eq(chats.userId, user.id), lt(chats.firstAt, end), gte(chats.lastAt, start)))
    .orderBy(asc(chats.firstAt)).limit(50);

  return {
    day,
    today,
    firstDay: [startDay(), first?.day].filter((d): d is string => Boolean(d)).sort().at(-1) ?? today,
    totals: {
      humanSec: rollup?.humanSec ?? 0,
      agentSec: rollup?.agentSec ?? 0,
      meetingSec: rollup?.meetingSec ?? 0,
      xp: xp.reduce((s, r) => s + r.xp, 0),
      focusBlocks: rollup?.focusBlocks ?? 0,
      longestFocusSec: rollup?.longestFocusSec ?? 0,
    },
    hours,
    xp: xp.filter((r) => r.xp !== 0),
    apps: ((rollup?.topApps ?? []) as Array<{ id: string; name: string | null; sec: number }>).slice(0, 8),
    calls: ((rollup?.meetingApps ?? []) as Array<{ id: string; name: string | null; sec: number }>).slice(0, 5),
    chats: dayChats,
  };
}
