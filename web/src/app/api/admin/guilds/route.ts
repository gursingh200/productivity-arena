import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { guilds } from "@/db/schema";
import { requireAdmin, uniqueSlug } from "@/lib/guilds";

const Body = z.object({ name: z.string().trim().min(1).max(60) }).strict();

/** POST /api/admin/guilds — create a guild (admins only). */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });
  const [guild] = await db.insert(guilds).values({ name: parsed.data.name, slug: await uniqueSlug(parsed.data.name) }).returning();
  return NextResponse.json(guild);
}
