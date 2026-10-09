import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { recordEvent } from "@/lib/achievements";
import { ACCENTS, BACKGROUNDS, BAR_STYLES, DEFAULT_APPEARANCE, PALETTES, SUBAGENT_STYLES } from "@/lib/colours";

const ids = <T extends { id: string }>(list: readonly T[]) => z.enum(list.map((x) => x.id) as [string, ...string[]]);
const Body = z.object({
  background: ids(BACKGROUNDS),
  palette: ids(PALETTES),
  accent: ids(ACCENTS),
  barStyle: ids(BAR_STYLES),
  subagent: ids(SUBAGENT_STYLES),
}).strict();

/** PUT /api/settings/appearance — the signed-in person's background, palette, accent and bar style (only they see them). */
export async function PUT(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });
  const a = parsed.data;
  // Defaults are stored as null, so a future change of default reaches everyone who never chose.
  const orNull = (value: string, fallback: string) => (value === fallback ? null : value);
  await db.update(users).set({
    background: orNull(a.background, DEFAULT_APPEARANCE.background),
    palette: orNull(a.palette, DEFAULT_APPEARANCE.palette),
    accent: orNull(a.accent, DEFAULT_APPEARANCE.accent),
    barStyle: orNull(a.barStyle, DEFAULT_APPEARANCE.barStyle),
    subagentStyle: orNull(a.subagent, DEFAULT_APPEARANCE.subagent),
  }).where(eq(users.id, session.user.id));
  const changed = (Object.keys(DEFAULT_APPEARANCE) as Array<keyof typeof a>).some((k) => a[k] !== DEFAULT_APPEARANCE[k]);
  if (changed) await recordEvent(session.user.id, "fresh_coat");
  return NextResponse.json({ ok: true });
}
