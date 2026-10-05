import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { guilds } from "@/db/schema";
import { requireAdmin } from "@/lib/guilds";

const Body = z.object({ name: z.string().trim().min(1).max(60) }).strict();
const Id = z.string().uuid();

/** PATCH /api/admin/guilds/:id — rename (admins only). */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;
  const id = Id.safeParse((await params).id);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!id.success || !parsed.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });
  const updated = await db.update(guilds).set({ name: parsed.data.name }).where(eq(guilds.id, id.data)).returning({ id: guilds.id });
  return updated.length ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

/** DELETE /api/admin/guilds/:id — members become guildless; past XP stays (admins only). */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;
  const id = Id.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });
  await db.delete(guilds).where(eq(guilds.id, id.data));
  return NextResponse.json({ ok: true });
}
