import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { authenticateDevice } from "@/lib/device-auth";
import { acceptQuest } from "@/lib/quest-db";

/** POST /api/agent/quests/:id/accept — from the Mac app (Bearer) or the web (session). Spec §3.3. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  const device = await authenticateDevice(req.headers.get("authorization"));
  const userId = device?.userId ?? (await auth())?.user?.id ?? null;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await acceptQuest(userId, id);
  switch (result) {
    case "ok": return NextResponse.json({ ok: true });
    case "not_found": return NextResponse.json({ error: "Quest not found" }, { status: 404 });
    case "not_offered": return NextResponse.json({ error: "Quest is not offered" }, { status: 409 });
    case "expired": return NextResponse.json({ error: "Offer expired" }, { status: 410 });
  }
}
