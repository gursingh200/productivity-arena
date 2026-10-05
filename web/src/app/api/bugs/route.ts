import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/db";
import { bugReports } from "@/db/schema";

const Schema = z.object({
  description: z.string().trim().min(1).max(5000),
  context: z.string().trim().max(200).optional(),
}).strict();

/** POST /api/bugs — the signed-in user files a bug report. Admins read them on /bugs. */
export async function POST(req: NextRequest): Promise<NextResponse> {
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

  await db.insert(bugReports).values({
    userId: session.user.id,
    description: parsed.data.description,
    context: parsed.data.context || null,
    userAgent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
  });
  return NextResponse.json({ ok: true });
}
