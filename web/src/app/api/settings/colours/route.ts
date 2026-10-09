import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { recordEvent } from "@/lib/achievements";
import { ACCENTS, DEFAULT_ACCENT, DEFAULT_PALETTE, PALETTES } from "@/lib/colours";

const Body = z.object({
  palette: z.enum(PALETTES.map((p) => p.id) as [string, ...string[]]),
  accent: z.enum(ACCENTS.map((a) => a.id) as [string, ...string[]]),
}).strict();

/** PUT /api/settings/colours — the signed-in person's palette and accent (only they see them). */
export async function PUT(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });
  const { palette, accent } = parsed.data;
  await db.update(users).set({
    palette: palette === DEFAULT_PALETTE ? null : palette,
    accent: accent === DEFAULT_ACCENT ? null : accent,
  }).where(eq(users.id, session.user.id));
  if (palette !== DEFAULT_PALETTE || accent !== DEFAULT_ACCENT) await recordEvent(session.user.id, "fresh_coat");
  return NextResponse.json({ ok: true });
}
