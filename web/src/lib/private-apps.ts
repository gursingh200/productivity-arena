/**
 * Private apps never count: time in them isn't human time and isn't listed.
 * Macs from 0.1.20 don't send it; ingest drops it from older Macs.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { minuteApp, users } from "@/db/schema";
import { recomputeDay } from "@/lib/rollup";
import { toUserDay } from "@/lib/timezone";

export const PRIVATE_APP = "private";

/**
 * Deletes private app time stored before this rule and recomputes the days it
 * touched (totals, XP). Run on deploy; does nothing once it's gone.
 * Returns how many days were recomputed.
 */
export async function removePrivateAppTime(): Promise<number> {
  const rows = await db.selectDistinct({ userId: minuteApp.userId, t: minuteApp.t, timezone: users.timezone })
    .from(minuteApp).innerJoin(users, eq(users.id, minuteApp.userId))
    .where(eq(minuteApp.bundleId, PRIVATE_APP));
  if (rows.length === 0) return 0;
  await db.delete(minuteApp).where(eq(minuteApp.bundleId, PRIVATE_APP));
  const days = new Map<string, { userId: string; day: string; timezone: string }>();
  for (const r of rows) {
    const day = toUserDay(r.t, r.timezone);
    days.set(`${r.userId}:${day}`, { userId: r.userId, day, timezone: r.timezone });
  }
  for (const d of days.values()) await recomputeDay(d.userId, d.day, d.timezone);
  return days.size;
}
