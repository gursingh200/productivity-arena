import { createHash, randomBytes } from "crypto";
import { db } from "@/db";
import { devices } from "@/db/schema";
import { eq, and, isNull } from "drizzle-orm";

/**
 * Generate a new device token (shown once to the user).
 * Only the hash is stored.
 */
export function generateDeviceToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface AuthenticatedDevice {
  deviceId: string;
  userId: string;
}

/**
 * Validate a Bearer token from the Authorization header.
 * Returns null if invalid/revoked.
 */
export async function authenticateDevice(
  authHeader: string | null
): Promise<AuthenticatedDevice | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);
  if (!token) return null;

  const hash = hashDeviceToken(token);

  const device = await db.query.devices.findFirst({
    where: and(eq(devices.tokenHash, hash), isNull(devices.revokedAt)),
  });

  if (!device) return null;

  // Update last seen
  await db
    .update(devices)
    .set({ lastSeenAt: new Date() })
    .where(eq(devices.id, device.id));

  return { deviceId: device.id, userId: device.userId };
}
