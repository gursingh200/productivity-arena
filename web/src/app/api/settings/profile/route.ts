import { changeTimezone } from "@/lib/user-timezone";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

const Schema = z.object({
  name: z.string().min(1).max(100).optional(),
  bio: z.string().max(500).optional(),
  handle: z
    .string()
    .min(2)
    .max(30)
    .regex(/^[a-z0-9_]+$/)
    .optional(),
  timezone: z.string().optional(),
});

export async function PATCH(req: NextRequest): Promise<NextResponse> {
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

  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid" }, { status: 400 });
  }

  // If handle is being changed, check uniqueness
  if (parsed.data.handle) {
    const existing = await db.query.users.findFirst({
      where: eq(users.handle, parsed.data.handle),
    });
    if (existing && existing.id !== session.user.id) {
      return NextResponse.json({ error: "Handle already taken" }, { status: 409 });
    }
  }

  const { timezone, ...rest } = parsed.data;
  await db
    .update(users)
    .set(rest)
    .where(eq(users.id, session.user.id));
  // A timezone change rebuilds recent days so they follow the new boundaries.
  if (timezone) await changeTimezone(session.user.id, timezone);

  return NextResponse.json({ ok: true });
}
