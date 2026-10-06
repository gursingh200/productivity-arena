/**
 * A person's days follow their Mac's timezone (sent with every upload), so the
 * website and the Mac's own dashboard count the same day. When it changes,
 * the recent days are rebuilt with the new day boundaries: rollups and the XP
 * derived from them, for the days whose minutes the server still has.
 *
 * Accounts that no Mac has set yet use the company timezone (ARENA_TIMEZONE).
 */
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { dailyRollup, users, xpLedger } from "@/db/schema";
import { recomputeDay } from "@/lib/rollup";
import { INGEST_MAX_AGE_DAYS } from "@/lib/retention";
import { companyTimezone } from "@/lib/standings";
import { addDays, toUserDay } from "@/lib/timezone";

export function isTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Sets someone's timezone and rebuilds their recent days. Returns whether it changed. */
export async function changeTimezone(userId: string, timezone: string, now: Date = new Date()): Promise<boolean> {
  if (!isTimezone(timezone)) return false;
  const user = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { timezone: true, timezoneSetAt: true } });
  if (!user) return false;
  if (user.timezone === timezone) {
    if (!user.timezoneSetAt) await db.update(users).set({ timezoneSetAt: now }).where(eq(users.id, userId));
    return false;
  }
  await db.update(users).set({ timezone, timezoneSetAt: now }).where(eq(users.id, userId));
  await rebuildRecentDays(userId, user.timezone, timezone, now);
  return true;
}

/** Recent days under the old boundaries are removed, then rebuilt under the new ones. */
async function rebuildRecentDays(userId: string, oldTz: string, newTz: string, now: Date): Promise<void> {
  const from = [addDays(toUserDay(now, oldTz), -INGEST_MAX_AGE_DAYS), addDays(toUserDay(now, newTz), -INGEST_MAX_AGE_DAYS)].sort()[0]!;
  const today = toUserDay(now, newTz);
  await db.delete(dailyRollup).where(and(eq(dailyRollup.userId, userId), gte(dailyRollup.day, from)));
  await db.delete(xpLedger).where(and(eq(xpLedger.userId, userId), gte(xpLedger.day, from),
    inArray(xpLedger.source, ["focus", "agent", "orchestration", "linear"])));
  for (let day = from; day <= today; day = addDays(day, 1)) await recomputeDay(userId, day, newTz);
}

/** Accounts no Mac has set a timezone for move to the company timezone (if it isn't UTC). */
export async function adoptCompanyTimezone(now: Date = new Date()): Promise<number> {
  const tz = companyTimezone();
  if (tz === "UTC") return 0;
  const pending = await db.select({ id: users.id }).from(users)
    .where(and(isNull(users.timezoneSetAt), sql`${users.timezone} <> ${tz}`));
  for (const u of pending) {
    await db.update(users).set({ timezone: tz }).where(eq(users.id, u.id));
    await rebuildRecentDays(u.id, "UTC", tz, now);
  }
  return pending.length;
}
