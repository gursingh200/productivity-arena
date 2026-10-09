import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { isOwner } from "@/lib/roles";
import { getViewer } from "@/lib/viewer";

const Body = z.object({ role: z.enum(["member", "admin"]) }).strict();

/** PUT /api/admin/members/:id/role — make someone an admin or a member again (owner only; the owner's own role is fixed). */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isOwner(viewer)) return NextResponse.json({ error: "Only the owner can change admins" }, { status: 403 });
  const id = z.string().uuid().safeParse((await params).id);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!id.success || !parsed.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });
  const target = await db.query.users.findFirst({ where: eq(users.id, id.data), columns: { role: true } });
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (target.role === "owner") return NextResponse.json({ error: "The owner's role can't be changed here" }, { status: 409 });
  await db.update(users).set({ role: parsed.data.role }).where(eq(users.id, id.data));
  return NextResponse.json({ ok: true });
}
