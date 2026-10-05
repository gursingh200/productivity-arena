/**
 * StatusPayload for the Mac app (spec §3.2).
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { dailyRollup, users, xpLedger, type Quest } from "@/db/schema";
import { computeLevel } from "@/lib/levels";
import { LIVE_OFFER_TTL_MS } from "@/lib/quest-engine";
import { questsForUser } from "@/lib/quest-db";
import { rankBy, weeklyStandings } from "@/lib/standings";
import { toUserDay } from "@/lib/timezone";

export interface StatusQuest {
  id: string;
  kind: string;
  title: string;
  xp: number;
  progress: number;
  target: number;
  unit: string;
  state: string;
  expiresAt: string | null;
}

export interface StatusPayload {
  user: {
    name: string;
    handle: string;
    level: number;
    xp: number;
    xpForNext: number;
    league: string;
    /** Rank by weekly XP among people who share XP; null when this person doesn't share XP. */
    weeklyRank: number | null;
    weeklyOf: number | null;
  };
  today: { humanSec: number; agentSec: number; meetingSec: number; xp: number };
  quests: StatusQuest[];
  dashboardUrl: string;
}

export async function buildStatusPayload(userId: string, now: Date = new Date()): Promise<StatusPayload> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw new Error("User not found");

  const standings = await weeklyStandings(now);
  const me = standings.find((s) => s.userId === userId)!;
  const sharers = new Set((await db.select({ id: users.id }).from(users).where(eq(users.shareXp, true))).map((u) => u.id));
  const ranked = rankBy(standings.filter((s) => sharers.has(s.userId)), (s) => s.weeklyXp);
  const myRank = ranked.find((r) => r.item.userId === userId);
  const level = computeLevel(me.totalXp);

  const today = toUserDay(now, user.timezone);
  const rollup = await db.query.dailyRollup.findFirst({
    where: and(eq(dailyRollup.userId, userId), eq(dailyRollup.day, today)),
  });
  const [todayXp] = await db.select({ xp: sql<number>`COALESCE(SUM(${xpLedger.xp}), 0)` })
    .from(xpLedger).where(and(eq(xpLedger.userId, userId), eq(xpLedger.day, today)));

  const handle = user.handle ?? userId;
  const baseUrl = (process.env.PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

  return {
    user: {
      name: user.name ?? "",
      handle,
      level: level.level,
      xp: level.xpInLevel,
      xpForNext: level.xpForNext,
      league: me.league,
      weeklyRank: myRank?.rank ?? null,
      weeklyOf: myRank ? ranked.length : null,
    },
    today: { humanSec: rollup?.humanSec ?? 0, agentSec: rollup?.agentSec ?? 0, meetingSec: rollup?.meetingSec ?? 0, xp: Number(todayXp?.xp ?? 0) },
    quests: (await questsForUser(userId, user.guildId)).map(toStatusQuest),
    dashboardUrl: `${baseUrl}/u/${handle}`,
  };
}

export function toStatusQuest(q: Quest): StatusQuest {
  let expiresAt: Date | null = q.windowEnd;
  if (q.state === "offered") expiresAt = new Date(q.createdAt.getTime() + LIVE_OFFER_TTL_MS);
  return {
    id: q.id,
    kind: q.kind,
    title: q.title,
    xp: q.xp,
    progress: q.progress,
    target: q.target,
    unit: q.unit,
    state: q.state,
    expiresAt: expiresAt?.toISOString() ?? null,
  };
}
