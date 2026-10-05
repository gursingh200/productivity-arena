/**
 * One Mac, one set of data. When a Mac pairs again (a new device row), it
 * resends its last 24 hours. Without this, its earlier pairing's rows would be
 * counted on top: agent time adds up across devices.
 *
 * So on ingest, any earlier pairing of the same Mac (same client id; or, for
 * pairings from before client ids were stored, the same Mac name) hands its
 * minutes and chats to the current pairing and is revoked. Rows the new pairing
 * already has win. Moved minutes older than 24 hours are then locked for the new
 * pairing too, so re-pairing can't be used to rewrite history.
 */
import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { devices } from "@/db/schema";

export async function adoptEarlierPairings(userId: string, deviceId: string, clientId: string, name: string): Promise<void> {
  const earlier = await db.select({ id: devices.id }).from(devices).where(and(
    eq(devices.userId, userId),
    ne(devices.id, deviceId),
    or(eq(devices.clientId, clientId), and(isNull(devices.clientId), eq(devices.name, name))),
  ));

  if (earlier.length === 0) {
    await db.update(devices).set({ clientId }).where(and(eq(devices.id, deviceId), isNull(devices.clientId)));
    return;
  }
  await db.transaction(async (tx) => {
    await tx.update(devices).set({ clientId }).where(eq(devices.id, deviceId));
    for (const { id: old } of earlier) {
      await tx.execute(sql`DELETE FROM minute_app o USING minute_app n
        WHERE o.device_id = ${old} AND n.device_id = ${deviceId} AND n.t = o.t AND n.bundle_id = o.bundle_id`);
      await tx.execute(sql`UPDATE minute_app SET device_id = ${deviceId} WHERE device_id = ${old}`);
      await tx.execute(sql`DELETE FROM minute_agent o USING minute_agent n
        WHERE o.device_id = ${old} AND n.device_id = ${deviceId} AND n.t = o.t AND n.agent = o.agent`);
      await tx.execute(sql`UPDATE minute_agent SET device_id = ${deviceId} WHERE device_id = ${old}`);
      await tx.execute(sql`DELETE FROM minute_meeting o USING minute_meeting n
        WHERE o.device_id = ${old} AND n.device_id = ${deviceId} AND n.t = o.t AND n.bundle_id = o.bundle_id`);
      await tx.execute(sql`UPDATE minute_meeting SET device_id = ${deviceId} WHERE device_id = ${old}`);
      await tx.execute(sql`DELETE FROM chats o USING chats n
        WHERE o.device_id = ${old} AND n.device_id = ${deviceId} AND n.agent = o.agent AND n.chat_id = o.chat_id`);
      await tx.execute(sql`UPDATE chats SET device_id = ${deviceId} WHERE device_id = ${old}`);
      await tx.update(devices).set({ clientId, revokedAt: sql`COALESCE(${devices.revokedAt}, now())` }).where(eq(devices.id, old));
    }
  });
}
