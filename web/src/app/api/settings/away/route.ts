import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { setAway } from "@/lib/league-db";

const Body = z.object({
  week: z.enum(["this", "next"]),
  days: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(5),
}).strict();

const MESSAGES = {
  past_week: "That week is over.",
  monday_only: "This week's away days can only be changed on Monday.",
  not_a_weekday: "Pick weekdays in that week.",
  too_many_weeks: "You can be away for at most two whole weeks in a row.",
};

/** PUT /api/settings/away — the signed-in user's away weekdays for this or next week. */
export async function PUT(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });
  const result = await setAway(session.user.id, parsed.data.week, parsed.data.days);
  return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: MESSAGES[result.error] }, { status: 409 });
}
