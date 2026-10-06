import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { chats, devices, minuteAgent, minuteApp, minuteMeeting, users } from "@/db/schema";
import { authenticateDevice } from "@/lib/device-auth";
import { IngestPayloadSchema, MAX_CHATS, MAX_MINUTES } from "@/lib/ingest-schema";
import { adoptEarlierPairings } from "@/lib/device-merge";
import { ingestCutoff, lockedMinutes, pruneMinutes } from "@/lib/retention";
import { recomputeForDays } from "@/lib/rollup";
import { startInstant } from "@/lib/start-date";
import { changeTimezone } from "@/lib/user-timezone";
import { buildStatusPayload } from "@/lib/status";
import { toUserDay } from "@/lib/timezone";

/**
 * POST /api/ingest (spec §3.1). Replace semantics for the last 24
 * hours: every minute in the payload replaces what this device sent for that
 * minute before (an empty minute clears it). Older minutes can only be written
 * once; chats are replaced per (device, agent, chatId) and
 * `deletedChats` removes this device's chats with those ids.
 */
/** A first upload backfills a week of agent history; give it room on serverless hosts. */
export const maxDuration = 60;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await authenticateDevice(req.headers.get("authorization"));
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw = body as { minutes?: unknown; chats?: unknown; deletedChats?: unknown } | null;
  if (Array.isArray(raw?.minutes) && raw.minutes.length > MAX_MINUTES) {
    return NextResponse.json({ error: `Too many minutes (max ${MAX_MINUTES})` }, { status: 413 });
  }
  if (Array.isArray(raw?.chats) && raw.chats.length > MAX_CHATS) {
    return NextResponse.json({ error: `Too many chats (max ${MAX_CHATS})` }, { status: 413 });
  }
  if (Array.isArray(raw?.deletedChats) && raw.deletedChats.length > MAX_CHATS) {
    return NextResponse.json({ error: `Too many deleted chats (max ${MAX_CHATS})` }, { status: 413 });
  }

  const parsed = IngestPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", details: parsed.error.flatten() }, { status: 400 });
  }
  const payload = parsed.data;
  // Minutes older than the ingest window are ignored (spec §2, retention): their
  // days may already have lost minutes, and recomputing would undercount them.
  // Minutes older than 24 hours that this device already sent are locked: they
  // can be filled in once but never replaced, so history can't be rewritten.
  // An earlier pairing of this Mac hands its rows over first, so the resend after
  // pairing replaces them instead of adding to them, and their lock carries over.
  await adoptEarlierPairings(auth.userId, auth.deviceId, payload.device.id, payload.device.name);

  const now = new Date();
  const cutoff = ingestCutoff(now);
  // Nothing before ARENA_START_DATE counts.
  const start = startInstant();
  const earliest = start && start > cutoff ? start : cutoff;
  const recent = payload.minutes.filter((m) => new Date(m.t) >= earliest);
  const locked = await lockedMinutes(auth.deviceId, recent.map((m) => new Date(m.t)), now);
  const minutes = recent.filter((m) => !locked.has(new Date(m.t).getTime()));

  // The person's days follow their Mac's timezone; a change rebuilds recent days first.
  if (payload.device.timezone) await changeTimezone(auth.userId, payload.device.timezone, now);
  const user = await db.query.users.findFirst({ where: eq(users.id, auth.userId), columns: { timezone: true } });
  const timezone = user?.timezone ?? "UTC";
  const touchedDays = new Set<string>();

  await db.transaction(async (tx) => {
    await tx.update(devices)
      .set({ name: payload.device.name, agentVersion: payload.device.agentVersion ?? null, lastSeenAt: new Date() })
      .where(eq(devices.id, auth.deviceId));

    const times = minutes.map((m) => new Date(m.t));
    for (let i = 0; i < times.length; i += 200) {
      const batch = times.slice(i, i + 200);
      await tx.delete(minuteApp).where(and(eq(minuteApp.deviceId, auth.deviceId), inArray(minuteApp.t, batch)));
      await tx.delete(minuteAgent).where(and(eq(minuteAgent.deviceId, auth.deviceId), inArray(minuteAgent.t, batch)));
      await tx.delete(minuteMeeting).where(and(eq(minuteMeeting.deviceId, auth.deviceId), inArray(minuteMeeting.t, batch)));
    }

    const appRows: (typeof minuteApp.$inferInsert)[] = [];
    const agentRows: (typeof minuteAgent.$inferInsert)[] = [];
    const meetingRows: (typeof minuteMeeting.$inferInsert)[] = [];
    for (const minute of minutes) {
      const t = new Date(minute.t);
      touchedDays.add(toUserDay(t, timezone));
      for (const app of minute.apps) {
        if (app.sec === 0) continue;
        appRows.push({ userId: auth.userId, deviceId: auth.deviceId, t, bundleId: app.id, appName: app.name ?? null, activeSec: app.sec });
      }
      let meetingLeft = 60; // one minute holds at most 60 s of calls
      for (const m of minute.meetings) {
        const sec = Math.min(m.sec, meetingLeft);
        if (sec === 0) continue;
        meetingLeft -= sec;
        meetingRows.push({ userId: auth.userId, deviceId: auth.deviceId, t, bundleId: m.id, appName: m.name ?? null, sec });
      }
      for (const a of minute.agents) {
        if (a.sec === 0 && a.tokensIn === 0 && a.tokensCached === 0 && a.tokensOut === 0) continue;
        agentRows.push({
          userId: auth.userId, deviceId: auth.deviceId, t, agent: a.agent, sessions: a.sessions, agentSec: a.sec,
          peak: a.peak, tokensIn: a.tokensIn, tokensCached: a.tokensCached, tokensOut: a.tokensOut,
          // Total can't be less than clock time; older Macs don't send it.
          workSec: a.workSec === undefined ? null : Math.max(a.sec, a.workSec),
          threads: a.threads ?? null,
        });
      }
    }
    for (let i = 0; i < appRows.length; i += 500) await tx.insert(minuteApp).values(appRows.slice(i, i + 500));
    for (let i = 0; i < agentRows.length; i += 500) await tx.insert(minuteAgent).values(agentRows.slice(i, i + 500));
    for (let i = 0; i < meetingRows.length; i += 500) await tx.insert(minuteMeeting).values(meetingRows.slice(i, i + 500));

    if (payload.deletedChats.length > 0) {
      await tx.delete(chats).where(and(eq(chats.deviceId, auth.deviceId), inArray(chats.chatId, payload.deletedChats)));
    }

    const keptChats = start ? payload.chats.filter((c) => new Date(c.lastAt) >= start) : payload.chats;
    for (let i = 0; i < keptChats.length; i += 200) {
      const batch = keptChats.slice(i, i + 200);
      await tx.insert(chats)
        .values(batch.map((c) => ({
          userId: auth.userId, deviceId: auth.deviceId, agent: c.agent, chatId: c.chatId,
          firstAt: new Date(c.firstAt), lastAt: new Date(c.lastAt), agentSec: c.agentSec, turns: c.turns,
          tokensIn: c.tokensIn, tokensCached: c.tokensCached, tokensOut: c.tokensOut,
        })))
        .onConflictDoUpdate({
          target: [chats.deviceId, chats.agent, chats.chatId],
          set: {
            firstAt: sql`excluded.first_at`, lastAt: sql`excluded.last_at`, agentSec: sql`excluded.agent_sec`,
            turns: sql`excluded.turns`, tokensIn: sql`excluded.tokens_in`, tokensCached: sql`excluded.tokens_cached`,
            tokensOut: sql`excluded.tokens_out`,
          },
        });
    }
  });

  await recomputeForDays(auth.userId, touchedDays);
  await pruneMinutes(auth.userId);
  return NextResponse.json({ accepted: payload.minutes.length, status: await buildStatusPayload(auth.userId) });
}
