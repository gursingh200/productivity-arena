/**
 * Recomputes daily_rollup and the derived XP rows for touched days, then
 * evaluates quests. Called after every ingest and Linear sync; idempotent.
 */
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { dailyRollup, linearIssues, minuteAgent, minuteApp, minuteMeeting, users, xpLedger } from "@/db/schema";
import { loadMinuteRows } from "@/lib/game/minutes-db";
import { evaluateQuests } from "@/lib/quest-db";
import { beforeStart } from "@/lib/start-date";
import { dayBounds, toUserDay } from "@/lib/timezone";
import { computeAgentXp, computeFocusXp, computeLinearXp, computeOrchestrationXp } from "@/lib/xp-engine";

type XpSource = "focus" | "agent" | "orchestration" | "linear" | "quest";

export async function recomputeForDays(userId: string, touchedDays: Set<string>, now: Date = new Date()): Promise<void> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { timezone: true } });
  if (!user) return;
  for (const day of [...touchedDays].sort()) {
    await recomputeDay(userId, day, user.timezone);
  }
  await evaluateQuests(userId, now);
}

export async function recomputeDay(userId: string, day: string, timezone: string): Promise<void> {
  const { start, end } = dayBounds(day, timezone);
  const minutes = await loadMinuteRows(userId, start, end);

  const perAgent = await db
    .select({
      agent: minuteAgent.agent,
      sec: sql<number>`SUM(${minuteAgent.agentSec})`,
      tokensIn: sql<number>`SUM(${minuteAgent.tokensIn})`,
      tokensCached: sql<number>`SUM(${minuteAgent.tokensCached})`,
      tokensOut: sql<number>`SUM(${minuteAgent.tokensOut})`,
    })
    .from(minuteAgent)
    .where(and(eq(minuteAgent.userId, userId), gte(minuteAgent.t, start), lt(minuteAgent.t, end)))
    .groupBy(minuteAgent.agent);

  const apps = await db
    .select({ id: minuteApp.bundleId, name: sql<string | null>`MAX(${minuteApp.appName})`, sec: sql<number>`SUM(${minuteApp.activeSec})` })
    .from(minuteApp)
    .where(and(eq(minuteApp.userId, userId), gte(minuteApp.t, start), lt(minuteApp.t, end)))
    .groupBy(minuteApp.bundleId);

  const calls = await db
    .select({ id: minuteMeeting.bundleId, name: sql<string | null>`MAX(${minuteMeeting.appName})`, sec: sql<number>`SUM(${minuteMeeting.sec})` })
    .from(minuteMeeting)
    .where(and(eq(minuteMeeting.userId, userId), gte(minuteMeeting.t, start), lt(minuteMeeting.t, end)))
    .groupBy(minuteMeeting.bundleId);
  const meetingApps = calls
    .map((c) => ({ id: c.id, name: c.name, sec: Number(c.sec) }))
    .sort((a, b) => b.sec - a.sec)
    .slice(0, 5);

  const agentSecByAgent: Record<string, number> = {};
  const tokensByAgent: Record<string, { in: number; cached: number; out: number }> = {};
  for (const a of perAgent) {
    agentSecByAgent[a.agent] = Number(a.sec);
    tokensByAgent[a.agent] = { in: Number(a.tokensIn), cached: Number(a.tokensCached), out: Number(a.tokensOut) };
  }
  const sum = (f: (t: { in: number; cached: number; out: number }) => number) =>
    Object.values(tokensByAgent).reduce((s, t) => s + f(t), 0);

  const appSecTotal = apps.reduce((s, a) => s + Number(a.sec), 0);
  const topApps = apps
    .map((a) => ({ id: a.id, name: a.name, sec: Number(a.sec) }))
    .sort((a, b) => b.sec - a.sec)
    .slice(0, 10)
    .map((a) => ({ ...a, pct: appSecTotal > 0 ? Math.round((a.sec / appSecTotal) * 100) : 0 }));

  const focus = computeFocusXp(minutes);
  const values = {
    humanSec: minutes.reduce((s, m) => s + m.humanSec, 0),
    agentSec: minutes.reduce((s, m) => s + m.agentSec, 0),
    // Call time; human time above already excludes it (a call wins the minute).
    meetingSec: minutes.reduce((s, m) => s + m.meetingSec, 0),
    agentSecByAgent,
    tokensIn: sum((t) => t.in),
    tokensCached: sum((t) => t.cached),
    tokensOut: sum((t) => t.out),
    tokensByAgent,
    peakParallel: minutes.reduce((s, m) => Math.max(s, m.peak), 0),
    longestFocusSec: focus.longestBlockSec,
    focusBlocks: focus.blocks,
    topApps,
    meetingApps,
    updatedAt: new Date(),
  };
  await db.insert(dailyRollup).values({ userId, day, ...values })
    .onConflictDoUpdate({ target: [dailyRollup.userId, dailyRollup.day], set: values });

  const agent = computeAgentXp(minutes);
  const orchestration = computeOrchestrationXp(minutes);
  await upsertXp(userId, day, "focus", `focus:${day}`, focus.xp, focus.reason);
  await upsertXp(userId, day, "agent", `agent:${day}`, agent.xp, agent.reason);
  await upsertXp(userId, day, "orchestration", `orchestration:${day}`, orchestration.xp, orchestration.reason);
  await recomputeLinearXp(userId, day, timezone);
}

/**
 * Linear XP for one local day. Issues no longer completed that day keep
 * their ledger row with 0 XP and a reversal reason, so history stays explained.
 */
export async function recomputeLinearXp(userId: string, day: string, timezone: string): Promise<void> {
  const { start, end } = dayBounds(day, timezone);
  const issues = await db.query.linearIssues.findMany({
    where: and(eq(linearIssues.userId, userId), gte(linearIssues.completedAt, start), lt(linearIssues.completedAt, end)),
  });
  const rows = computeLinearXp(
    issues.map((i) => ({ issueId: i.issueId, identifier: i.identifier, estimate: i.estimate, completedAt: i.completedAt! })),
    (d) => toUserDay(d, timezone),
  );
  const current = new Set(rows.map((r) => `linear:${r.issueId}`));
  for (const r of rows) await upsertXp(userId, day, "linear", `linear:${r.issueId}`, r.xp, r.reason);

  const previous = await db.query.xpLedger.findMany({
    where: and(eq(xpLedger.userId, userId), eq(xpLedger.source, "linear"), eq(xpLedger.day, day)),
  });
  for (const p of previous) {
    if (current.has(p.sourceKey) || p.xp === 0) continue;
    await db.update(xpLedger)
      .set({ xp: 0, reason: `Reversed: issue reopened or moved (was ${p.xp} XP)` })
      .where(eq(xpLedger.id, p.id));
  }
}

async function upsertXp(userId: string, day: string, source: XpSource, sourceKey: string, xp: number, reason: string) {
  if (beforeStart(day)) return; // Nothing before ARENA_START_DATE earns XP.
  const rounded = Math.round(xp);
  await db.insert(xpLedger)
    .values({ userId, day, source, sourceKey, xp: rounded, reason, rulesVersion: 1 })
    .onConflictDoUpdate({
      target: [xpLedger.userId, xpLedger.source, xpLedger.sourceKey],
      set: { xp: rounded, reason, day },
    });
}
