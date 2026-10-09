import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { ACHIEVEMENT_BY_ID, CLIENT_EVENTS, recordEvent, type EventKind } from "@/lib/achievements";

const Body = z.object({ event: z.enum(CLIENT_EVENTS as [EventKind, ...EventKind[]]) }).strict();

/** POST /api/achievements/event — easter eggs the browser notices (the Konami code, badge taps). */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });
  const unlocked = await recordEvent(session.user.id, parsed.data.event);
  return NextResponse.json({ unlocked: unlocked.map((id) => ACHIEVEMENT_BY_ID.get(id)!.name) });
}
