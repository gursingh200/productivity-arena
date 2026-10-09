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
import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import { db } from "@/db";
import { devices, minuteAgent, minuteApp, minuteMeeting } from "@/db/schema";

export const INGEST_MAX_AGE_DAYS = 14;
/** Minutes older than this can be written once but never replaced. */
export const LOCK_AFTER_HOURS = 24;
export const MINUTE_RETENTION_DAYS = 16;
/** A resend may replace this device's own minutes up to this old. */
export const RESEND_DAYS = 7;
/** How long a device's one resend window stays open once its first resend upload arrives. */
export const RESEND_WINDOW_MINUTES = 60;

const DAY_MS = 86_400_000;

export function ingestCutoff(now: Date): Date {
  return new Date(now.getTime() - INGEST_MAX_AGE_DAYS * DAY_MS);
}

/** Minutes before this are locked; during a resend window, a week back instead of a day. */
export function lockCutoff(now: Date, resending = false): Date {
  return new Date(now.getTime() - (resending ? RESEND_DAYS * DAY_MS : LOCK_AFTER_HOURS * 3_600_000));
}

/**
 * Of the given minutes older than the lock cutoff, those this device already
 * sent data for. Such minutes are locked: an upload can't replace them.
 */
export async function lockedMinutes(deviceId: string, times: Date[], now: Date, resending = false): Promise<Set<number>> {
  const cutoff = lockCutoff(now, resending).getTime();
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

/**
 * Whether this upload may replace a week of the device's own minutes. A device
 * gets one window: its first upload marked `resend` opens it for
 * RESEND_WINDOW_MINUTES; later resends only count while it's still open. A new
 * pairing is a new device, so it gets a window of its own.
 */
export async function resendWindowOpen(deviceId: string, requested: boolean, now: Date): Promise<boolean> {
  if (!requested) return false;
  await db.update(devices).set({ resendUntil: new Date(now.getTime() + RESEND_WINDOW_MINUTES * 60_000) })
    .where(and(eq(devices.id, deviceId), isNull(devices.resendUntil)));
  const device = await db.query.devices.findFirst({ where: eq(devices.id, deviceId), columns: { resendUntil: true } });
  return !!device?.resendUntil && now < device.resendUntil;
}

/** Deletes one person's minute rows older than the retention window. */
export async function pruneMinutes(userId: string, now: Date = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - MINUTE_RETENTION_DAYS * DAY_MS);
  await db.delete(minuteApp).where(and(eq(minuteApp.userId, userId), lt(minuteApp.t, cutoff)));
  await db.delete(minuteAgent).where(and(eq(minuteAgent.userId, userId), lt(minuteAgent.t, cutoff)));
  await db.delete(minuteMeeting).where(and(eq(minuteMeeting.userId, userId), lt(minuteMeeting.t, cutoff)));
}
