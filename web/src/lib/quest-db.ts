/**
 * Quest lifecycle in the database (spec §5). Rules live in quest-engine.ts.
 * Called after every ingest; idempotent.
 */
import { and, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { dailyRollup, linearAccounts, linearIssues, quests, users, xpLedger, type Quest } from "@/db/schema";
import { loadMinuteRows } from "@/lib/game/minutes-db";
import {
  dailyProgress,
  liveProgress,
  liveQuestToOffer,
  LIVE_OFFER_TTL_MS,
  LIVE_REOFFER_COOLDOWN_MS,
  questDefinition,
  selectDailyQuests,
  selectGuildQuest,
  selectWeeklyQuests,
  weeklyProgress,
  type QuestTemplate,
} from "@/lib/quest-engine";
import { companyTimezone } from "@/lib/standings";
import { dayBounds, getWeekRange, toUserDay } from "@/lib/timezone";

/** Guild members need this much human time in the week to share a guild reward. */
export const GUILD_REWARD_MIN_HUMAN_SEC = 3600;

export async function evaluateQuests(userId: string, now: Date = new Date()): Promise<void> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return;
  const tz = user.timezone;
  const today = toUserDay(now, tz);
  const day = dayBounds(today, tz);
  const week = getWeekRange(now, tz);
  const weekStartDay = toUserDay(week.start, tz);
  const hasLinear = await userHasLinear(userId);

  const todayMinutes = await loadMinuteRows(userId, day.start, day.end);
  const linearToday = await linearClosedCount([userId], day.start, day.end);
  const weekDays = await weekRollups([userId], weekStartDay);
  const linearWeek = await linearClosedCount([userId], week.start, week.end);

  await resolveExpired(userId, now);

  // Daily and weekly quests are assigned automatically and start active.
  await ensureQuests(userId, selectDailyQuests(userId, today, hasLinear), day.start, day.end);
  await ensureQuests(userId, selectWeeklyQuests(userId, weekStartDay, hasLinear), week.start, week.end);

  const open = await db.query.quests.findMany({
    where: and(eq(quests.userId, userId), inArray(quests.state, ["offered", "active"])),
  });
  for (const quest of open) {
    if (quest.state !== "active") continue;
    let progress: number;
    if (quest.kind === "daily") {
      progress = dailyProgress(quest.template, { timezone: tz, minutes: todayMinutes, linearClosed: linearToday });
    } else if (quest.kind === "weekly") {
      progress = weeklyProgress(quest.template, { days: weekDays, linearClosed: linearWeek });
    } else if (quest.kind === "live" && quest.windowStart) {
      const since = todayMinutes.filter((m) => m.t >= minuteFloor(quest.windowStart!));
      progress = liveProgress(quest.template, since);
    } else {
      continue;
    }
    await setProgress(quest, progress, userId, today, now);
  }

  await offerLiveQuest(userId, todayMinutes, now);
  if (user.guildId) await evaluateGuildQuest(user.guildId, now);
}

// ---------------------------------------------------------------------------

async function ensureQuests(userId: string, templates: QuestTemplate[], start: Date, end: Date): Promise<void> {
  const existing = await db.query.quests.findMany({
    where: and(eq(quests.userId, userId), eq(quests.windowStart, start), inArray(quests.template, templates)),
  });
  const have = new Set(existing.map((q) => q.template));
  for (const template of templates) {
    if (have.has(template)) continue;
    const def = questDefinition(template)!;
    await db.insert(quests).values({
      userId, kind: def.kind, template, title: def.title, target: def.target, unit: def.unit, xp: def.xp,
      windowStart: start, windowEnd: end, state: "active", progress: 0,
    });
  }
}

/** Offers past their TTL expire; active quests past their window fail. */
async function resolveExpired(userId: string, now: Date): Promise<void> {
  await db.update(quests)
    .set({ state: "expired", resolvedAt: now })
    .where(and(eq(quests.userId, userId), eq(quests.state, "offered"),
      lt(quests.createdAt, new Date(now.getTime() - LIVE_OFFER_TTL_MS))));
  await db.update(quests)
    .set({ state: "failed", resolvedAt: now })
    .where(and(eq(quests.userId, userId), eq(quests.state, "active"), isNotNull(quests.windowEnd),
      lt(quests.windowEnd, now)));
}

async function setProgress(quest: Quest, progress: number, userId: string, day: string, now: Date): Promise<void> {
  const capped = Math.min(Math.round(progress), quest.target);
  if (capped >= quest.target) {
    await db.update(quests).set({ state: "completed", progress: capped, resolvedAt: now }).where(eq(quests.id, quest.id));
    await awardQuestXp(userId, quest, day);
  } else if (capped !== quest.progress) {
    await db.update(quests).set({ progress: capped }).where(eq(quests.id, quest.id));
  }
}

async function offerLiveQuest(userId: string, todayMinutes: Awaited<ReturnType<typeof loadMinuteRows>>, now: Date) {
  const openLive = await db.query.quests.findFirst({
    where: and(eq(quests.userId, userId), eq(quests.kind, "live"), inArray(quests.state, ["offered", "active"])),
  });
  if (openLive) return;
  const recent = await db.query.quests.findMany({
    where: and(eq(quests.userId, userId), eq(quests.kind, "live"),
      gte(quests.createdAt, new Date(now.getTime() - LIVE_REOFFER_COOLDOWN_MS))),
    columns: { template: true },
  });
  const template = liveQuestToOffer(todayMinutes, now, new Set(recent.map((q) => q.template)));
  if (!template) return;
  const def = questDefinition(template)!;
  await db.insert(quests).values({
    userId, kind: "live", template, title: def.title, target: def.target, unit: def.unit, xp: def.xp,
    state: "offered", progress: 0, createdAt: now,
  });
}

/** Guild quests follow the company week so every member shares one quest. */
async function evaluateGuildQuest(guildId: string, now: Date): Promise<void> {
  const tz = companyTimezone();
  const week = getWeekRange(now, tz);
  const weekStartDay = toUserDay(week.start, tz);
  const members = await db.query.users.findMany({ where: eq(users.guildId, guildId), columns: { id: true } });
  const memberIds = members.map((m) => m.id);
  if (memberIds.length === 0) return;

  let quest = await db.query.quests.findFirst({
    where: and(eq(quests.guildId, guildId), eq(quests.kind, "guild"), eq(quests.windowStart, week.start)),
  });
  if (!quest) {
    const anyLinear = (await db.select({ n: sql<number>`COUNT(*)` }).from(linearAccounts)
      .where(inArray(linearAccounts.userId, memberIds)))[0]!.n > 0;
    const template = selectGuildQuest(guildId, weekStartDay, Number(anyLinear) > 0);
    const def = questDefinition(template)!;
    [quest] = await db.insert(quests).values({
      guildId, kind: "guild", template, title: def.title, target: def.target, unit: def.unit, xp: def.xp,
      windowStart: week.start, windowEnd: week.end, state: "active", progress: 0,
    }).returning();
  }
  if (!quest || quest.state !== "active") return;

  const days = await weekRollups(memberIds, weekStartDay);
  const linear = await linearClosedCount(memberIds, week.start, week.end);
  const progress = Math.min(Math.round(weeklyProgress(quest.template, { days, linearClosed: linear })), quest.target);

  if (progress < quest.target) {
    if (progress !== quest.progress) await db.update(quests).set({ progress }).where(eq(quests.id, quest.id));
    return;
  }
  await db.update(quests).set({ state: "completed", progress, resolvedAt: now }).where(eq(quests.id, quest.id));
  // Everyone who put in at least an hour this week shares the reward.
  const contributors = await db
    .select({ userId: dailyRollup.userId })
    .from(dailyRollup)
    .where(and(inArray(dailyRollup.userId, memberIds), gte(dailyRollup.day, weekStartDay)))
    .groupBy(dailyRollup.userId)
    .having(sql`SUM(${dailyRollup.humanSec} + ${dailyRollup.meetingSec}) >= ${GUILD_REWARD_MIN_HUMAN_SEC}`);
  for (const c of contributors) await awardQuestXp(c.userId, quest, toUserDay(now, tz));
}

export async function awardQuestXp(userId: string, quest: Quest, day: string): Promise<void> {
  await db.insert(xpLedger).values({
    userId, day, source: "quest", sourceKey: `quest:${quest.id}`, xp: quest.xp,
    reason: `Quest: ${quest.title}`, rulesVersion: 1,
  }).onConflictDoNothing();
}

// ---------------------------------------------------------------------------
// Accept / decline (from the Mac app or the web)

export type QuestActionResult = "ok" | "not_found" | "not_offered" | "expired";

export async function acceptQuest(userId: string, questId: string, now: Date = new Date()): Promise<QuestActionResult> {
  const quest = await db.query.quests.findFirst({ where: and(eq(quests.id, questId), eq(quests.userId, userId)) });
  if (!quest) return "not_found";
  if (quest.state !== "offered") return "not_offered";
  if (now.getTime() - quest.createdAt.getTime() > LIVE_OFFER_TTL_MS) {
    await db.update(quests).set({ state: "expired", resolvedAt: now }).where(eq(quests.id, questId));
    return "expired";
  }
  const windowMin = questDefinition(quest.template)?.windowMin ?? 60;
  await db.update(quests)
    .set({ state: "active", windowStart: now, windowEnd: new Date(now.getTime() + windowMin * 60_000) })
    .where(eq(quests.id, questId));
  return "ok";
}

export async function declineQuest(userId: string, questId: string, now: Date = new Date()): Promise<QuestActionResult> {
  const quest = await db.query.quests.findFirst({ where: and(eq(quests.id, questId), eq(quests.userId, userId)) });
  if (!quest) return "not_found";
  if (quest.state !== "offered") return "not_offered";
  await db.update(quests).set({ state: "declined", resolvedAt: now }).where(eq(quests.id, questId));
  return "ok";
}

// ---------------------------------------------------------------------------
// Queries shared with status/profile

export async function userHasLinear(userId: string): Promise<boolean> {
  return (await db.query.linearAccounts.findFirst({ where: eq(linearAccounts.userId, userId) })) != null;
}

export async function linearClosedCount(userIds: string[], start: Date, end: Date): Promise<number> {
  const [row] = await db.select({ n: sql<number>`COUNT(*)` }).from(linearIssues)
    .where(and(inArray(linearIssues.userId, userIds), gte(linearIssues.completedAt, start), lt(linearIssues.completedAt, end)));
  return Number(row?.n ?? 0);
}

async function weekRollups(userIds: string[], weekStartDay: string) {
  return db.select({ focusSec: sql<number>`${dailyRollup.humanSec} + ${dailyRollup.meetingSec}`.mapWith(Number), agentSec: dailyRollup.agentSec })
    .from(dailyRollup)
    .where(and(inArray(dailyRollup.userId, userIds), gte(dailyRollup.day, weekStartDay)));
}

/** Quests to show a user: their open personal quests plus their guild's current quest. */
export async function questsForUser(userId: string, guildId: string | null): Promise<Quest[]> {
  const personal = await db.query.quests.findMany({
    where: and(eq(quests.userId, userId), inArray(quests.state, ["offered", "active"])),
  });
  if (!guildId) return personal;
  const guild = await db.query.quests.findMany({
    where: and(eq(quests.guildId, guildId), isNull(quests.userId), gte(quests.windowEnd, new Date())),
  });
  return [...personal, ...guild];
}

function minuteFloor(d: Date): Date {
  return new Date(Math.floor(d.getTime() / 60_000) * 60_000);
}
