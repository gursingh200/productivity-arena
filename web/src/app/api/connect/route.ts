/**
 * POST /api/connect — create a device token for the authenticated user.
 * Returns: { deviceId, token (shown once), pairUrl }
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { devices } from "@/db/schema";
import { generateDeviceToken, hashDeviceToken } from "@/lib/device-auth";
import { z } from "zod";

const Body = z.object({
  name: z.string().min(1).max(100).default("My Device"),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const parsed = Body.safeParse(body);
  const name = parsed.success ? parsed.data.name : "My Device";

  const token = generateDeviceToken();
  const tokenHash = hashDeviceToken(token);

  const [device] = await db
    .insert(devices)
    .values({
      userId: session.user.id,
      name,
      tokenHash,
    })
    .returning({ id: devices.id });

  if (!device) {
    return NextResponse.json({ error: "Failed to create device" }, { status: 500 });
  }

  const baseUrl = process.env.PUBLIC_BASE_URL ?? "http://localhost:3000";
  const pairUrl = `arena://pair?server=${encodeURIComponent(baseUrl)}&token=${token}`;

  return NextResponse.json({
    deviceId: device.id,
    token,
    pairUrl,
  });
}
