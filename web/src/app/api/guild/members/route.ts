import { and, eq, isNull } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { isGuildAdmin } from "@/lib/roles";
import { getViewer } from "@/lib/viewer";

const Body = z.object({ userId: z.string().uuid() }).strict();

/** POST /api/guild/members — a guild admin adds someone who has no guild to their own guild. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isGuildAdmin(viewer)) return NextResponse.json({ error: "Guild admins only" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });
  // Only people without a guild: a guild admin can't take members from another guild.
  const moved = await db.update(users).set({ guildId: viewer.guildId })
    .where(and(eq(users.id, parsed.data.userId), isNull(users.guildId))).returning({ id: users.id });
  return moved.length ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "They’re already in a guild" }, { status: 409 });
}
