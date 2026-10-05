import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { minuteAgent, minuteApp, minuteMeeting } from "@/db/schema";
import type { MinuteRow } from "@/lib/game/activity";

/**
 * A user's minutes in [start, end), merged across devices and agents:
 * call seconds capped at 60; human seconds capped at what the call leaves
 * (a call wins the minute, so human + call ≤ 60); agent seconds summed;
 * peak = concurrent sessions summed across agents and devices.
 */
export async function loadMinuteRows(userId: string, start: Date, end: Date): Promise<MinuteRow[]> {
  const human = await db
    .select({ t: minuteApp.t, sec: sql<number>`SUM(${minuteApp.activeSec})` })
    .from(minuteApp)
    .where(and(eq(minuteApp.userId, userId), gte(minuteApp.t, start), lt(minuteApp.t, end)))
    .groupBy(minuteApp.t);
  const calls = await db
    .select({ t: minuteMeeting.t, sec: sql<number>`SUM(${minuteMeeting.sec})` })
    .from(minuteMeeting)
    .where(and(eq(minuteMeeting.userId, userId), gte(minuteMeeting.t, start), lt(minuteMeeting.t, end)))
    .groupBy(minuteMeeting.t);
  const agents = await db
    .select({
      t: minuteAgent.t,
      sec: sql<number>`SUM(${minuteAgent.agentSec})`,
      peak: sql<number>`SUM(${minuteAgent.peak})`,
    })
    .from(minuteAgent)
    .where(and(eq(minuteAgent.userId, userId), gte(minuteAgent.t, start), lt(minuteAgent.t, end)))
    .groupBy(minuteAgent.t);

  const byMinute = new Map<number, MinuteRow>();
  const row = (t: Date) => {
    const key = t.getTime();
    let r = byMinute.get(key);
    if (!r) {
      r = { t, humanSec: 0, meetingSec: 0, agentSec: 0, peak: 0 };
      byMinute.set(key, r);
    }
    return r;
  };
  for (const c of calls) row(c.t).meetingSec = Math.min(60, Number(c.sec));
  for (const h of human) {
    const r = row(h.t);
    r.humanSec = Math.min(Number(h.sec), 60 - r.meetingSec);
  }
  for (const a of agents) {
    const r = row(a.t);
    r.agentSec = Number(a.sec);
    r.peak = Number(a.peak);
  }
  return [...byMinute.values()].sort((a, b) => a.t.getTime() - b.t.getTime());
}
