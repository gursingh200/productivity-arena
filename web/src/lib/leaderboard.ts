/**
 * Leaderboards with sharing applied (spec §7, give to get). A board ranks one
 * category; it lists only people who share that category, and only a viewer
 * who shares it too can see it. Other columns on a row (the human/agent split,
 * league) are checked per person. Rows carry only what the viewer may see.
 */
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { awayToday } from "@/lib/league-db";
import type { League } from "@/lib/leagues";
import { shares, visibility, type Category, type Sharer } from "@/lib/sharing";
import { rankBy, weeklyStandings, type Standing } from "@/lib/standings";

export type LeaderboardTab = "weekly_xp" | "human_hours" | "agent_hours" | "agent_total" | "parallelism" | "level";

/** Parallelism ranks only people with at least this much agent (clock) time in the week. */
export const PARALLELISM_MIN_AGENT_SEC = 5 * 3600;

/** Total agent hours ÷ clock agent hours: 1.0 = one thing at a time. */
export function parallelism(s: Pick<Standing, "weeklyAgentSec" | "weeklyAgentWorkSec">): number {
  return s.weeklyAgentSec > 0 ? Math.max(1, s.weeklyAgentWorkSec / s.weeklyAgentSec) : 0;
}

export const TAB_CATEGORY: Record<LeaderboardTab, Category> = {
  weekly_xp: "xp",
  level: "xp",
  human_hours: "human",
  agent_hours: "agents",
  agent_total: "agents",
  parallelism: "agents",
};

export interface LeaderboardRow {
  userId: string;
  name: string | null;
  handle: string | null;
  image: string | null;
  guild: Standing["guild"];
  /** The value this tab ranks by. */
  value: number;
  /** Rank within this board (ties share). */
  tabRank: number;
  /** This week's hours; null when the viewer can't see that category for this person. */
  weeklyHumanSec: number | null;
  weeklyAgentSec: number | null;
  /** Total agent hours, sub-agents counted separately; null like weeklyAgentSec. */
  weeklyAgentWorkSec: number | null;
  league: League | null;
  /** Marked away today. */
  away: boolean;
}

export type Leaderboard =
  | { locked: true; category: Category; viewerLeague: League }
  | { locked: false; category: Category; viewerLeague: League; rows: LeaderboardRow[] };

const VALUE: Record<LeaderboardTab, (s: Standing) => number> = {
  weekly_xp: (s) => s.weeklyXp,
  human_hours: (s) => s.weeklyHumanSec,
  agent_hours: (s) => s.weeklyAgentSec,
  agent_total: (s) => s.weeklyAgentWorkSec,
  parallelism: (s) => (s.weeklyAgentSec >= PARALLELISM_MIN_AGENT_SEC ? Math.round(parallelism(s) * 100) / 100 : 0),
  level: (s) => s.totalXp,
};

export async function leaderboard(tab: LeaderboardTab, viewer: Sharer, now: Date = new Date()): Promise<Leaderboard> {
  const category = TAB_CATEGORY[tab];
  const standings = await weeklyStandings(now);
  const viewerLeague = standings.find((s) => s.userId === viewer.id)?.league ?? "bronze";
  const sharers = await db.query.users.findMany({
    where: inArray(users.id, standings.map((s) => s.userId)),
    columns: { id: true, shareXp: true, shareHuman: true, shareAgents: true, shareMeetings: true, shareApps: true, shareSkills: true },
  });
  const byId = new Map(sharers.map((u) => [u.id, u]));
  const me = byId.get(viewer.id) ?? viewer;
  // You can't see a board for a category you don't share.
  if (!shares(me)[category]) return { locked: true, category, viewerLeague };

  // On a board: people who share this category with this viewer (the viewer included).
  const onBoard = standings.filter((s) => {
    const owner = byId.get(s.userId);
    return owner !== undefined && visibility(me, owner)[category]
      && (tab !== "parallelism" || s.weeklyAgentSec >= PARALLELISM_MIN_AGENT_SEC);
  });
  const away = await awayToday(onBoard.map((s) => s.userId), now);
  const rows = rankBy(onBoard, VALUE[tab]).map(({ item, rank }) => {
    const see = visibility(me, byId.get(item.userId)!);
    return {
      userId: item.userId,
      name: item.name,
      handle: item.handle,
      image: item.image,
      guild: item.guild,
      value: tab === "level" ? item.level : VALUE[tab](item),
      tabRank: rank,
      weeklyHumanSec: see.human ? item.weeklyHumanSec : null,
      weeklyAgentSec: see.agents ? item.weeklyAgentSec : null,
      weeklyAgentWorkSec: see.agents ? item.weeklyAgentWorkSec : null,
      league: see.xp ? item.league : null,
      away: away.has(item.userId),
    };
  });
  return { locked: false, category, viewerLeague, rows };
}
