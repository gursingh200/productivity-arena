import { NextRequest, NextResponse } from "next/server";
import { leaderboard, type LeaderboardTab } from "@/lib/leaderboard";
import { getViewer } from "@/lib/viewer";

const TABS: LeaderboardTab[] = ["weekly_xp", "human_hours", "agent_hours", "level"];

/** GET /api/leaderboard?tab= — the same sharing-filtered board the page shows. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const requested = req.nextUrl.searchParams.get("tab") as LeaderboardTab | null;
  const tab = requested && TABS.includes(requested) ? requested : "weekly_xp";
  return NextResponse.json({ board: await leaderboard(tab, viewer), currentUserId: viewer.id });
}
