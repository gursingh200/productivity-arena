/**
 * Everything a profile page shows, loaded in one place (spec §7).
 *
 * Sharing is applied here, on the server: each category is null (or, for daily
 * series, null per day) unless the viewer may see it, and hidden data is not
 * even queried. Nothing hidden reaches the page or any client component.
 */
import { and, desc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { chats, dailyRollup, linearIssues, quests, users, xpLedger, type Quest, type User } from "@/db/schema";
import { type League } from "@/lib/leagues";
import { computeLevel, type LevelInfo } from "@/lib/levels";
import { questsForUser } from "@/lib/quest-db";
import { CATEGORIES, hiddenReason, SKILL_SOURCES, visibility, xpRowCategory, type Category, type Visibility } from "@/lib/sharing";
import { computeSkillsRadar, type SkillsRadar } from "@/lib/skills";
import { rankBy, weekDays, weeklyStandings, type Standing } from "@/lib/standings";
import { addDays, dayBounds, toUserDay } from "@/lib/timezone";

/** One day's totals; a field is null when the viewer can't see that category. */
export interface DayTotals {
  day: string;
  humanSec: number | null;
  agentSec: number | null;
  meetingSec: number | null;
}

export interface WeekTotals {
  /** Monday of the company week. */
  start: string;
  days: DayTotals[];
  humanSec: number | null;
  agentSec: number | null;
  meetingSec: number | null;
}

export interface AgentTotals {
  agent: string;
  agentSec: number;
  tokensIn: number;
  tokensCached: number;
  tokensOut: number;
  chats: number;
}

export interface AppTotal {
  id: string;
  name: string | null;
  sec: number;
  pct: number;
}

export interface ProfileData {
  user: {
    id: string;
    name: string;
    handle: string;
    image: string | null;
    bio: string | null;
    guild: Standing["guild"];
    joined: Date;
  };
  isOwner: boolean;
  visible: Visibility;
  /** For hidden categories: whether the owner doesn't share it ("theirs") or the viewer doesn't ("yours"). */
  hidden: Record<Category, "theirs" | "yours" | null>;
  today: string;
  /** This company week (Monday to Sunday) and the one before. */
  week: WeekTotals;
  lastWeek: WeekTotals;
  /** Last 30 local days, oldest first. */
  last30Days: DayTotals[];
  xp: {
    level: LevelInfo;
    league: League;
    /** Rank by weekly XP among people who share XP; null if the owner doesn't share XP. */
    rank: { rank: number; of: number } | null;
    recentXp: Array<{ id: string; day: string; source: string; xp: number; reason: string }>;
    /** Open quests; only for the owner. */
    quests: Quest[];
  } | null;
  human: {
    /** Last 90 local days of human seconds, oldest first, including empty days. */
    days90: Array<{ day: string; sec: number }>;
    weeklyAvgSec: number;
    previousWeeklyAvgSec: number;
  } | null;
  agents: {
    agents: AgentTotals[];
    peakParallel: number;
    chats: { count: number; avgTokensOut: number; longest: { agent: string; agentSec: number; turns: number } | null };
  } | null;
  /** Apps (last 30 days). Call apps also need meetings to be visible. */
  apps: { top: AppTotal[]; calls: AppTotal[] | null } | null;
  /** Each axis is null when the viewer can't see a category it's computed from. */
  skills: Record<keyof SkillsRadar, number | null> | null;
}

export async function loadProfile(handle: string, viewer: User, now = new Date()): Promise<ProfileData | null> {
  const user = await db.query.users.findFirst({ where: eq(users.handle, handle), with: { guild: true } });
  if (!user) return null;
  const visible = visibility(viewer, user);
  const hidden = Object.fromEntries(CATEGORIES.map((c) => [c, hiddenReason(viewer, user, c)])) as ProfileData["hidden"];
  const tz = user.timezone;
  const today = toUserDay(now, tz);
  const start90 = addDays(today, -89);
  const start30 = addDays(today, -29);
  const start180 = addDays(today, -179);
  const range30 = { start: dayBounds(start30, tz).start, end: dayBounds(today, tz).end };

  const rollups = await db.query.dailyRollup.findMany({
    where: and(eq(dailyRollup.userId, user.id), gte(dailyRollup.day, start180)),
  });
  const byDay = new Map(rollups.map((r) => [r.day, r]));
  const totalsFor = (from: string, count: number): DayTotals[] =>
    Array.from({ length: count }, (_, i) => {
      const day = addDays(from, i);
      const r = byDay.get(day);
      return {
        day,
        humanSec: visible.human ? r?.humanSec ?? 0 : null,
        agentSec: visible.agents ? r?.agentSec ?? 0 : null,
        meetingSec: visible.meetings ? r?.meetingSec ?? 0 : null,
      };
    });
  const sum = (days: DayTotals[], key: "humanSec" | "agentSec" | "meetingSec") =>
    days.some((d) => d[key] === null) ? null : days.reduce((s, d) => s + (d[key] ?? 0), 0);
  const { thisWeek, lastWeek } = weekDays(now);
  const weekOf = (start: string): WeekTotals => {
    const days = totalsFor(start, 7);
    return { start, days, humanSec: sum(days, "humanSec"), agentSec: sum(days, "agentSec"), meetingSec: sum(days, "meetingSec") };
  };
  const recent30 = rollups.filter((r) => r.day >= start30);

  // Agent totals feed both the agents panel and the skills radar.
  const agentTotals = new Map<string, AgentTotals>();
  let chatRows: Array<{ agent: string; agentSec: number; turns: number; tokensOut: number }> = [];
  if (visible.agents || visible.skills) {
    for (const r of recent30) {
      const secs = r.agentSecByAgent as Record<string, number>;
      const tokens = r.tokensByAgent as Record<string, { in: number; cached: number; out: number }>;
      for (const agent of new Set([...Object.keys(secs), ...Object.keys(tokens)])) {
        const a = agentTotals.get(agent) ?? { agent, agentSec: 0, tokensIn: 0, tokensCached: 0, tokensOut: 0, chats: 0 };
        a.agentSec += secs[agent] ?? 0;
        a.tokensIn += tokens[agent]?.in ?? 0;
        a.tokensCached += tokens[agent]?.cached ?? 0;
        a.tokensOut += tokens[agent]?.out ?? 0;
        agentTotals.set(agent, a);
      }
    }
  }
  if (visible.agents) {
    chatRows = await db.select({ agent: chats.agent, agentSec: chats.agentSec, turns: chats.turns, tokensOut: chats.tokensOut })
      .from(chats).where(and(eq(chats.userId, user.id), gte(chats.lastAt, range30.start)));
    for (const c of chatRows) {
      const a = agentTotals.get(c.agent) ?? { agent: c.agent, agentSec: 0, tokensIn: 0, tokensCached: 0, tokensOut: 0, chats: 0 };
      a.chats += 1;
      agentTotals.set(c.agent, a);
    }
  }
  const longest = chatRows.reduce<(typeof chatRows)[number] | null>((best, c) => (!best || c.agentSec > best.agentSec ? c : best), null);

  const isOwner = viewer.id === user.id;
  const weeks = 90 / 7;
  const rawDays = (from: string, n: number) => Array.from({ length: n }, (_, i) => {
    const day = addDays(from, i);
    return { day, sec: byDay.get(day)?.humanSec ?? 0 };
  });

  return {
    user: {
      id: user.id, name: user.name ?? handle, handle, image: user.image, bio: user.bio, joined: user.createdAt,
      guild: user.guild ? { id: user.guild.id, name: user.guild.name, color: user.guild.color } : null,
    },
    isOwner,
    visible,
    hidden,
    today,
    week: weekOf(thisWeek),
    lastWeek: weekOf(lastWeek),
    last30Days: totalsFor(start30, 30),
    xp: visible.xp ? await xpSection(user, isOwner, visible, now) : null,
    human: visible.human ? {
      days90: rawDays(start90, 90),
      weeklyAvgSec: rawDays(start90, 90).reduce((s, d) => s + d.sec, 0) / weeks,
      previousWeeklyAvgSec: rawDays(start180, 90).reduce((s, d) => s + d.sec, 0) / weeks,
    } : null,
    agents: visible.agents ? {
      agents: [...agentTotals.values()].sort((a, b) => b.agentSec - a.agentSec),
      peakParallel: recent30.reduce((m, r) => Math.max(m, r.peakParallel), 0),
      chats: {
        count: chatRows.length,
        avgTokensOut: chatRows.length ? chatRows.reduce((s, c) => s + c.tokensOut, 0) / chatRows.length : 0,
        longest: longest ? { agent: longest.agent, agentSec: longest.agentSec, turns: longest.turns } : null,
      },
    } : null,
    apps: visible.apps ? appsSection(recent30, visible.meetings) : null,
    skills: visible.skills ? visibleSkills(await skillsFor(user.id, user.guildId, recent30, totalsFor(start30, 30), range30, agentTotals), visible) : null,
  };
}

function visibleSkills(skills: SkillsRadar, visible: Visibility): NonNullable<ProfileData["skills"]> {
  const out = {} as NonNullable<ProfileData["skills"]>;
  for (const axis of Object.keys(skills) as Array<keyof SkillsRadar>) {
    out[axis] = SKILL_SOURCES[axis].every((c) => visible[c]) ? skills[axis] : null;
  }
  return out;
}

async function xpSection(user: User, isOwner: boolean, visible: Visibility, now: Date): Promise<NonNullable<ProfileData["xp"]>> {
  const standings = await weeklyStandings(now);
  const standing = standings.find((s) => s.userId === user.id)!;
  // Ranks only count people who share XP; someone who doesn't share isn't ranked.
  const sharers = await db.select({ id: users.id }).from(users).where(eq(users.shareXp, true));
  const sharerIds = new Set(sharers.map((s) => s.id));
  const ranked = rankBy(standings.filter((s) => sharerIds.has(s.userId)), (s) => s.weeklyXp);
  const mine = ranked.find((r) => r.item.userId === user.id);
  // Only XP rows whose category the viewer can see (an agent XP row gives away agent time).
  const ledger = await db.select({ id: xpLedger.id, day: xpLedger.day, source: xpLedger.source, xp: xpLedger.xp, reason: xpLedger.reason, sourceKey: xpLedger.sourceKey })
    .from(xpLedger).where(and(eq(xpLedger.userId, user.id), ne(xpLedger.xp, 0)))
    .orderBy(desc(xpLedger.day), desc(xpLedger.createdAt)).limit(60);
  const questIds = ledger.filter((r) => r.source === "quest").map((r) => r.sourceKey.replace(/^quest:/, ""));
  const templates = new Map(questIds.length
    ? (await db.select({ id: quests.id, template: quests.template }).from(quests).where(inArray(quests.id, questIds))).map((q) => [q.id, q.template])
    : []);
  const recentXp = ledger
    .filter((r) => visible[xpRowCategory(r.source, templates.get(r.sourceKey.replace(/^quest:/, "")) ?? null)])
    .slice(0, 12)
    .map(({ sourceKey: _key, ...row }) => row);
  return {
    level: computeLevel(standing.totalXp),
    league: standing.league,
    rank: mine ? { rank: mine.rank, of: ranked.length } : null,
    recentXp,
    quests: isOwner ? await questsForUser(user.id, user.guildId) : [],
  };
}

/**
 * Apps and call apps over the last 30 days, from the daily rollups (minutes
 * aren't kept that long). Each day stores its top 10 apps and top 5 call apps.
 */
function appsSection(recent30: Array<typeof dailyRollup.$inferSelect>, withCalls: boolean): NonNullable<ProfileData["apps"]> {
  const totals = (key: "topApps" | "meetingApps", limit: number): AppTotal[] => {
    const byId = new Map<string, { id: string; name: string | null; sec: number }>();
    for (const r of recent30) {
      for (const app of r[key] as Array<{ id: string; name: string | null; sec: number }>) {
        const a = byId.get(app.id) ?? { id: app.id, name: app.name, sec: 0 };
        a.sec += app.sec;
        byId.set(app.id, a);
      }
    }
    const all = [...byId.values()].sort((a, b) => b.sec - a.sec);
    const total = all.reduce((s, a) => s + a.sec, 0);
    return all.slice(0, limit).map((a) => ({ ...a, pct: total > 0 ? (a.sec / total) * 100 : 0 }));
  };
  return { top: totals("topApps", 8), calls: withCalls ? totals("meetingApps", 5) : null };
}

async function skillsFor(
  userId: string,
  guildId: string | null,
  recent30: Array<typeof dailyRollup.$inferSelect>,
  days30: DayTotals[],
  range: { start: Date; end: Date },
  agents: Map<string, AgentTotals>,
): Promise<SkillsRadar> {
  const weekdays = days30.filter((d) => {
    const dow = new Date(`${d.day}T12:00:00Z`).getUTCDay();
    return dow !== 0 && dow !== 6;
  }).length;

  const resolved = await db.select({ state: quests.state, n: sql<number>`COUNT(*)` }).from(quests)
    .where(and(eq(quests.userId, userId), gte(quests.createdAt, range.start))).groupBy(quests.state);
  const count = (states: string[]) => resolved.filter((r) => states.includes(r.state)).reduce((s, r) => s + Number(r.n), 0);

  const [linear] = await db.select({ n: sql<number>`COUNT(*)` }).from(linearIssues)
    .where(and(eq(linearIssues.userId, userId), gte(linearIssues.completedAt, range.start)));

  let guildShare = 0;
  let guildSize = 0;
  if (guildId) {
    const members = await db.select({ id: users.id }).from(users).where(eq(users.guildId, guildId));
    guildSize = members.length;
    const [guildTotal] = await db.select({ sec: sql<number>`COALESCE(SUM(${dailyRollup.agentSec} + ${dailyRollup.humanSec}), 0)` })
      .from(dailyRollup)
      .where(and(inArray(dailyRollup.userId, members.map((m) => m.id)), gte(dailyRollup.day, days30[0]!.day)));
    const mine = recent30.reduce((s, r) => s + r.agentSec + r.humanSec, 0);
    guildShare = Number(guildTotal?.sec) > 0 ? mine / Number(guildTotal!.sec) : 0;
  }

  return computeSkillsRadar({
    // Skills measure focus time: human plus call time.
    dailyRollups: recent30.map((r) => ({
      day: r.day, humanSec: r.humanSec + r.meetingSec, agentSec: r.agentSec, longestFocusSec: r.longestFocusSec,
      focusBlocks: r.focusBlocks, peakParallel: r.peakParallel, tokensOut: r.tokensOut,
    })),
    weekdays,
    questsOffered: count(["completed", "failed", "expired", "declined", "active", "offered"]),
    questsCompleted: count(["completed"]),
    linearIssuesPerWeek: Number(linear?.n ?? 0) / (30 / 7),
    guildContributionShare: guildShare,
    guildSize,
    totalOutputTokens: [...agents.values()].reduce((s, a) => s + a.tokensOut, 0),
    totalAgentSec: [...agents.values()].reduce((s, a) => s + a.agentSec, 0),
  });
}
