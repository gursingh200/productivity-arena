import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireAdmin } from "@/lib/guilds";

const Body = z.object({ guildAdmin: z.boolean() }).strict();

/** PUT /api/admin/members/:id/guild-admin — make someone their guild's admin, or not (admins only). */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;
  const id = z.string().uuid().safeParse((await params).id);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!id.success || !parsed.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });
  const target = await db.query.users.findFirst({ where: eq(users.id, id.data), columns: { guildId: true } });
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (parsed.data.guildAdmin && !target.guildId) return NextResponse.json({ error: "Put them in a guild first" }, { status: 409 });
  await db.update(users).set({ guildAdmin: parsed.data.guildAdmin }).where(eq(users.id, id.data));
  return NextResponse.json({ ok: true });
}
