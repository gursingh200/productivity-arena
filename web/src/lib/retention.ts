/**
 * Minute-level data is kept for a short window; daily rollups, XP, chats and
 * quests are kept for good (spec §2). This keeps the database small: about
 * 175 KB per person per day in minutes, versus about 1 KB in the day's rollup.
 *
 * A day is only ever recomputed from minutes that are all still stored:
 * ingest ignores minutes older than INGEST_MAX_AGE_DAYS, and minutes are
 * deleted only after MINUTE_RETENTION_DAYS, two days later, so no day that
 * ingest can touch has lost any of its minutes (timezones span < 1 day).
 */
import { and, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { minuteAgent, minuteApp, minuteMeeting } from "@/db/schema";

export const INGEST_MAX_AGE_DAYS = 14;
/** Minutes older than this can be written once but never replaced. */
export const LOCK_AFTER_HOURS = 24;
export const MINUTE_RETENTION_DAYS = 16;

const DAY_MS = 86_400_000;

export function ingestCutoff(now: Date): Date {
  return new Date(now.getTime() - INGEST_MAX_AGE_DAYS * DAY_MS);
}

export function lockCutoff(now: Date): Date {
  return new Date(now.getTime() - LOCK_AFTER_HOURS * 3_600_000);
}

/**
 * Of the given minutes older than the lock cutoff, those this device already
 * sent data for. Such minutes are locked: a resend can't replace them.
 */
export async function lockedMinutes(deviceId: string, times: Date[], now: Date): Promise<Set<number>> {
  const cutoff = lockCutoff(now).getTime();
  const old = times.filter((t) => t.getTime() < cutoff);
  const locked = new Set<number>();
  for (let i = 0; i < old.length; i += 200) {
    const batch = old.slice(i, i + 200);
    for (const table of [minuteApp, minuteAgent, minuteMeeting]) {
      const rows = await db.selectDistinct({ t: table.t }).from(table).where(and(eq(table.deviceId, deviceId), inArray(table.t, batch)));
      for (const r of rows) locked.add(r.t.getTime());
    }
  }
  return locked;
}

/** Deletes one person's minute rows older than the retention window. */
export async function pruneMinutes(userId: string, now: Date = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - MINUTE_RETENTION_DAYS * DAY_MS);
  await db.delete(minuteApp).where(and(eq(minuteApp.userId, userId), lt(minuteApp.t, cutoff)));
  await db.delete(minuteAgent).where(and(eq(minuteAgent.userId, userId), lt(minuteAgent.t, cutoff)));
  await db.delete(minuteMeeting).where(and(eq(minuteMeeting.userId, userId), lt(minuteMeeting.t, cutoff)));
}
