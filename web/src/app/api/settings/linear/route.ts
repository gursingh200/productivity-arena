import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { linearAccounts } from "@/db/schema";
import { encryptApiKey } from "@/lib/linear-crypto";
import { syncLinear } from "@/lib/linear-sync";
import { z } from "zod";
import { eq } from "drizzle-orm";

const Body = z.object({
  apiKey: z.string().min(1),
});

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const apiKeyEnc = encryptApiKey(parsed.data.apiKey);

  await db
    .insert(linearAccounts)
    .values({
      userId: session.user.id,
      apiKeyEnc,
      lastSyncedAt: null,
    })
    .onConflictDoUpdate({
      target: [linearAccounts.userId],
      set: {
        apiKeyEnc,
        lastSyncedAt: null,
      },
    });

  // Trigger immediate sync
  try {
    await syncLinear(session.user.id);
  } catch {
    // Non-fatal
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await db
    .delete(linearAccounts)
    .where(eq(linearAccounts.userId, session.user.id));

  return NextResponse.json({ success: true });
}
