import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { sharingColumns } from "@/lib/sharing";

/** All six choices are required, so a request can't leave one ambiguous. */
const Schema = z.object({
  xp: z.boolean(),
  human: z.boolean(),
  agents: z.boolean(),
  meetings: z.boolean(),
  apps: z.boolean(),
  skills: z.boolean(),
}).strict();

/**
 * PUT /api/settings/sharing — the signed-in user's own sharing choices.
 * Also completes first-login onboarding.
 */
export async function PUT(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });

  const user = await db.query.users.findFirst({ where: eq(users.id, session.user.id), columns: { onboardedAt: true } });
  await db.update(users)
    .set({ ...sharingColumns(parsed.data), onboardedAt: user?.onboardedAt ?? new Date() })
    .where(eq(users.id, session.user.id));
  return NextResponse.json({ ok: true });
}
