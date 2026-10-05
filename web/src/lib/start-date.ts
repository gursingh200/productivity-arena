/**
 * The day Arena starts counting (ARENA_START_DATE, YYYY-MM-DD in the company
 * timezone). Nothing before it counts: Macs can backfill weeks of agent logs,
 * and how much each person's agents kept would decide who leads. Set in the
 * deployment's environment, not the repo; unset means no start date.
 */
import { lt } from "drizzle-orm";
import { db } from "@/db";
import { awayDays, chats, dailyRollup, leaderboardHistory, leagueWeeks, minuteAgent, minuteApp, minuteMeeting, periodTotals, quests, xpLedger } from "@/db/schema";
import { companyTimezone } from "@/lib/standings";
import { dayBounds } from "@/lib/timezone";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The first counted local day, or null if no start date is set. */
export function startDay(env: Record<string, string | undefined> = process.env): string | null {
  const value = env.ARENA_START_DATE?.trim();
  if (!value) return null;
  if (!DAY.test(value) || Number.isNaN(Date.parse(value))) throw new Error(`ARENA_START_DATE must be YYYY-MM-DD, got "${value}"`);
  return value;
}

/** The first counted instant: midnight of the start day in the company timezone. */
export function startInstant(env: Record<string, string | undefined> = process.env): Date | null {
  const day = startDay(env);
  return day ? dayBounds(day, companyTimezone()).start : null;
}

/** True if a local day is before the start date. */
export function beforeStart(day: string): boolean {
  const start = startDay();
  return start !== null && day < start;
}

/**
 * Deletes everything recorded before the start date: minutes, chats that ended
 * before it, daily rollups, XP, quests and saved leaderboards (those are rebuilt
 * from what's left). Runs on every deploy; does nothing without a start date.
 */
export async function purgeBeforeStart(): Promise<{ startDay: string | null }> {
  const day = startDay();
  const instant = startInstant();
  if (!day || !instant) return { startDay: null };
  await db.transaction(async (tx) => {
    await tx.delete(minuteApp).where(lt(minuteApp.t, instant));
    await tx.delete(minuteAgent).where(lt(minuteAgent.t, instant));
    await tx.delete(minuteMeeting).where(lt(minuteMeeting.t, instant));
    await tx.delete(chats).where(lt(chats.lastAt, instant));
    await tx.delete(dailyRollup).where(lt(dailyRollup.day, day));
    await tx.delete(xpLedger).where(lt(xpLedger.day, day));
    await tx.delete(quests).where(lt(quests.windowEnd, instant));
    // Saved boards for periods that began before the start; rebuilt lazily from what's left.
    await tx.delete(leaderboardHistory).where(lt(leaderboardHistory.periodStart, day));
    await tx.delete(periodTotals).where(lt(periodTotals.periodStart, day));
    await tx.delete(leagueWeeks).where(lt(leagueWeeks.weekStart, day));
    await tx.delete(awayDays).where(lt(awayDays.day, day));
  });
  return { startDay: day };
}
