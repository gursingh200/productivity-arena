import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { guilds } from "@/db/schema";
import { requireAdmin, setGuild } from "@/lib/guilds";

const Body = z.object({ guildId: z.string().uuid().nullable() }).strict();

/** PUT /api/admin/members/:id/guild — put a person in a guild, or none (admins only). */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;
  const userId = z.string().uuid().safeParse((await params).id);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!userId.success || !parsed.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });
  if (parsed.data.guildId && !(await db.query.guilds.findFirst({ where: eq(guilds.id, parsed.data.guildId), columns: { id: true } }))) {
    return NextResponse.json({ error: "No such guild" }, { status: 404 });
  }
  return (await setGuild(userId.data, parsed.data.guildId))
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "Not found" }, { status: 404 });
}
