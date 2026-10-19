/**
 * App icons: the Mac uploads each app's own icon once (a small PNG); the
 * website shows it beside the app's name instead of its first letter.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { appIcons, minuteApp, minuteMeeting } from "@/db/schema";

export const MAX_ICON_BYTES = 48 * 1024;
export const MAX_ICON_SIDE = 128;
/** Not real apps: nothing to show an icon for. */
const NOT_APPS = new Set(["private", "unknown", "calendar"]);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** True for a PNG no bigger than MAX_ICON_SIDE on either side (read from its header). */
export function isIconPng(png: Buffer): boolean {
  if (png.length < 24 || png.length > MAX_ICON_BYTES) return false;
  if (!png.subarray(0, 8).equals(PNG_SIGNATURE) || png.toString("latin1", 12, 16) !== "IHDR") return false;
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  return width > 0 && height > 0 && width <= MAX_ICON_SIDE && height <= MAX_ICON_SIDE;
}

/**
 * Stores icons for apps this person has used (so a device can't label apps it
 * never ran). The first icon for an app is kept. Returns how many were new.
 */
export async function saveIcons(userId: string, icons: Array<{ bundleId: string; png: Buffer }>): Promise<number> {
  const wanted = icons.filter((i) => !NOT_APPS.has(i.bundleId) && isIconPng(i.png));
  if (wanted.length === 0) return 0;
  const ids = wanted.map((i) => i.bundleId);
  const [apps, calls] = await Promise.all([
    db.selectDistinct({ id: minuteApp.bundleId }).from(minuteApp).where(and(eq(minuteApp.userId, userId), inArray(minuteApp.bundleId, ids))),
    db.selectDistinct({ id: minuteMeeting.bundleId }).from(minuteMeeting).where(and(eq(minuteMeeting.userId, userId), inArray(minuteMeeting.bundleId, ids))),
  ]);
  const usedIds = new Set([...apps, ...calls].map((r) => r.id));
  const rows = wanted.filter((i) => usedIds.has(i.bundleId));
  if (rows.length === 0) return 0;
  const saved = await db.insert(appIcons).values(rows).onConflictDoNothing().returning({ bundleId: appIcons.bundleId });
  return saved.length;
}

/** Which of these apps have an icon. */
export async function appsWithIcons(ids: string[]): Promise<Set<string>> {
  const real = ids.filter((id) => !NOT_APPS.has(id));
  if (real.length === 0) return new Set();
  const rows = await db.select({ bundleId: appIcons.bundleId }).from(appIcons).where(inArray(appIcons.bundleId, real));
  return new Set(rows.map((r) => r.bundleId));
}

export async function iconPng(bundleId: string): Promise<Buffer | null> {
  const [row] = await db.select({ png: appIcons.png }).from(appIcons).where(eq(appIcons.bundleId, bundleId));
  return row?.png ?? null;
}
