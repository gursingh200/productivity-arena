/**
 * API route tests against the real Postgres (docker compose, port 5433).
 * Skipped when DATABASE_URL isn't set.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";

const DB_URL = process.env.DATABASE_URL;

describe.skipIf(!DB_URL)("device API", async () => {
  const { db } = await import("@/db");
  const schema = await import("@/db/schema");
  const { hashDeviceToken } = await import("@/lib/device-auth");
  const ingest = (await import("@/app/api/ingest/route")).POST;
  const status = (await import("@/app/api/agent/status/route")).GET;
  const accept = (await import("@/app/api/agent/quests/[id]/accept/route")).POST;
  const decline = (await import("@/app/api/agent/quests/[id]/decline/route")).POST;

  const TOKEN = "test-token-" + Math.random().toString(36).slice(2);
  const DEVICE_UUID = "6f1c2d3e-4b5a-4c7d-8e9f-0a1b2c3d4e5f";
  let userId = "";
  let deviceId = "";

  const minuteIso = (minutesAgo: number) => {
    const t = new Date(Math.floor(Date.now() / 60_000) * 60_000 - minutesAgo * 60_000);
    return t.toISOString().replace(".000Z", "Z");
  };
  const payload = (minutes: unknown[], chats?: unknown[]) => ({
    schema: 1,
    device: { id: DEVICE_UUID, name: "Test Mac", os: "macOS 26.0", agentVersion: "0.1.0" },
    minutes,
    ...(chats ? { chats } : {}),
  });
  const post = (body: unknown, token: string | null = TOKEN) =>
    ingest(new NextRequest("http://localhost/api/ingest", {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }));
  const questAction = (fn: typeof accept, id: string) =>
    fn(new NextRequest(`http://localhost/api/agent/quests/${id}/x`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` } }),
      { params: Promise.resolve({ id }) });
  const chat = (id: string, agentSec: number, turns: number, tokensOut: number) => ({
    agent: "claude", chatId: id, firstAt: minuteIso(30), lastAt: minuteIso(1), agentSec, turns,
    tokensIn: 10, tokensCached: 100, tokensOut,
  });

  beforeAll(async () => {
    const [u] = await db.insert(schema.users)
      .values({ email: `api-test-${Date.now()}@clueso.io`, name: "API Test", handle: `apitest${Date.now()}` })
      .returning();
    userId = u!.id;
    const [d] = await db.insert(schema.devices).values({ userId, name: "Test Mac", tokenHash: hashDeviceToken(TOKEN) }).returning();
    deviceId = d!.id;
  });

  afterAll(async () => {
    if (userId) await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  beforeEach(async () => {
    await db.delete(schema.minuteApp).where(eq(schema.minuteApp.userId, userId));
    await db.delete(schema.minuteAgent).where(eq(schema.minuteAgent.userId, userId));
    await db.delete(schema.quests).where(eq(schema.quests.userId, userId));
    await db.delete(schema.minuteMeeting).where(eq(schema.minuteMeeting.userId, userId));
    await db.delete(schema.chats).where(eq(schema.chats.userId, userId));
  });

  it("rejects missing or wrong tokens with 401", async () => {
    expect((await post(payload([]), null)).status).toBe(401);
    expect((await post(payload([]), "nope")).status).toBe(401);
  });

  it("rejects bad JSON and invalid payloads with 400", async () => {
    expect((await post("{not json")).status).toBe(400);
    expect((await post({ schema: 2, device: {}, minutes: [] })).status).toBe(400);
  });

  it("returns 413 for more than 1440 minutes or 2000 chats", async () => {
    const minutes = Array.from({ length: 1441 }, (_, i) => ({ t: minuteIso(i), apps: [], agents: [] }));
    expect((await post(payload(minutes))).status).toBe(413);
    const chats = Array.from({ length: 2001 }, (_, i) => chat(i.toString(16).padStart(16, "0"), 1, 1, 1));
    expect((await post(payload([], chats))).status).toBe(413);
  });

  it("replaces a minute on resend and clears it when sent empty", async () => {
    const t = minuteIso(5);
    const agentRow = { agent: "claude", sec: 90, sessions: 2, peak: 2, tokensIn: 5, tokensCached: 50, tokensOut: 20 };
    expect((await post(payload([{ t, apps: [{ id: "com.apple.Safari", name: "Safari", sec: 30 }], agents: [agentRow] }]))).status).toBe(200);
    await post(payload([{ t, apps: [{ id: "com.apple.Safari", name: "Safari", sec: 10 }], agents: [{ ...agentRow, sec: 40 }] }]));

    const apps = await db.select().from(schema.minuteApp).where(eq(schema.minuteApp.deviceId, deviceId));
    const agents = await db.select().from(schema.minuteAgent).where(eq(schema.minuteAgent.deviceId, deviceId));
    expect(apps.map((a) => a.activeSec)).toEqual([10]);
    expect(agents.map((a) => a.agentSec)).toEqual([40]);

    await post(payload([{ t, apps: [], agents: [] }]));
    expect(await db.select().from(schema.minuteApp).where(eq(schema.minuteApp.deviceId, deviceId))).toHaveLength(0);
    expect(await db.select().from(schema.minuteAgent).where(eq(schema.minuteAgent.deviceId, deviceId))).toHaveLength(0);
  });

  it("keeps token-only agent rows", async () => {
    await post(payload([{ t: minuteIso(3), apps: [], agents: [{ agent: "codex", sec: 0, sessions: 0, peak: 0, tokensIn: 1, tokensCached: 2, tokensOut: 3 }] }]));
    const rows = await db.select().from(schema.minuteAgent).where(eq(schema.minuteAgent.deviceId, deviceId));
    expect(rows.map((r) => r.tokensOut)).toEqual([3]);
  });

  it("replaces each chat with its own values", async () => {
    const ids = ["aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb", "cccccccccccccccc"];
    await post(payload([], ids.map((id, i) => chat(id, 100 * (i + 1), i + 1, 10 * (i + 1)))));
    await post(payload([], ids.map((id, i) => chat(id, 1000 * (i + 1), 10 * (i + 1), 500 * (i + 1)))));
    const rows = await db.select().from(schema.chats).where(eq(schema.chats.deviceId, deviceId));
    const byId = Object.fromEntries(rows.map((r) => [r.chatId, [r.agentSec, r.turns, r.tokensOut]]));
    expect(byId).toEqual({ [ids[0]!]: [1000, 10, 500], [ids[1]!]: [2000, 20, 1000], [ids[2]!]: [3000, 30, 1500] });
  });

  it("sums parallel sessions across agents and pays orchestration XP", async () => {
    const minutes = Array.from({ length: 5 }, (_, i) => ({
      t: minuteIso(10 + i),
      apps: [{ id: "com.microsoft.VSCode", name: "Code", sec: 60 }],
      agents: [
        { agent: "claude", sec: 60, sessions: 1, peak: 1, tokensIn: 0, tokensCached: 0, tokensOut: 10 },
        { agent: "codex", sec: 60, sessions: 1, peak: 1, tokensIn: 0, tokensCached: 0, tokensOut: 10 },
      ],
    }));
    await post(payload(minutes));
    const rollups = await db.select().from(schema.dailyRollup).where(eq(schema.dailyRollup.userId, userId));
    expect(Math.max(...rollups.map((r) => r.peakParallel))).toBe(2);
    const orchestration = await db.select().from(schema.xpLedger)
      .where(and(eq(schema.xpLedger.userId, userId), eq(schema.xpLedger.source, "orchestration")));
    expect(orchestration.reduce((s, r) => s + r.xp, 0)).toBeGreaterThan(0);
  });

  it("returns the spec §3.2 status shape and assigns daily, weekly and live quests", async () => {
    // 46 active minutes ending now → daily/weekly quests exist and stay_longer is offered.
    const minutes = Array.from({ length: 46 }, (_, i) => ({ t: minuteIso(i), apps: [{ id: "com.apple.Terminal", name: "Terminal", sec: 60 }], agents: [] }));
    const res = await post(payload(minutes));
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["accepted", "status"]);

    const s = await (await status(new NextRequest("http://localhost/api/agent/status", { headers: { authorization: `Bearer ${TOKEN}` } }))).json();
    expect(Object.keys(s).sort()).toEqual(["dashboardUrl", "quests", "today", "user"]);
    expect(Object.keys(s.user).sort()).toEqual(["handle", "league", "level", "name", "weeklyOf", "weeklyRank", "xp", "xpForNext"]);
    expect(Object.keys(s.today).sort()).toEqual(["agentSec", "humanSec", "meetingSec", "xp"]);
    for (const q of s.quests) {
      expect(Object.keys(q).sort()).toEqual(["expiresAt", "id", "kind", "progress", "state", "target", "title", "unit", "xp"]);
    }
    // Open quests are listed; one may already be completed by this data, so count all of them.
    const assigned = await db.select().from(schema.quests).where(eq(schema.quests.userId, userId));
    expect(assigned.filter((q) => q.kind === "daily")).toHaveLength(3);
    expect(assigned.filter((q) => q.kind === "weekly")).toHaveLength(3);
    const completed = assigned.filter((q) => q.state === "completed");
    const questXp = await db.select().from(schema.xpLedger)
      .where(and(eq(schema.xpLedger.userId, userId), eq(schema.xpLedger.source, "quest")));
    expect(questXp).toHaveLength(completed.length);
    const live = s.quests.find((q: { kind: string }) => q.kind === "live");
    expect(live).toMatchObject({ state: "offered", title: "Stay 15 minutes longer", xp: 200 });
  });

  it("stores meeting time, at most 60 s a minute, and lets a call win over typing", async () => {
    const minutes = [
      { t: minuteIso(5), apps: [], agents: [], meetings: [{ id: "us.zoom.xos", name: "zoom.us", sec: 45 }, { id: "com.granola.app", name: "Granola", sec: 40 }] },
      { t: minuteIso(4), apps: [{ id: "com.apple.Terminal", name: "Terminal", sec: 60 }], agents: [], meetings: [{ id: "us.zoom.xos", name: "zoom.us", sec: 60 }] },
    ];
    expect((await post(payload(minutes))).status).toBe(200);
    const rows = await db.select().from(schema.minuteMeeting).where(eq(schema.minuteMeeting.userId, userId));
    expect(rows.reduce((s, r) => s + r.sec, 0)).toBe(120);
    // Minute 4 had typing and a call: the call wins, so it counts once, as meeting time.
    const [rollup] = await db.select().from(schema.dailyRollup).where(eq(schema.dailyRollup.userId, userId));
    expect(rollup!.meetingSec).toBe(120);
    expect(rollup!.humanSec).toBe(0);
    const focus = await db.select().from(schema.xpLedger)
      .where(and(eq(schema.xpLedger.userId, userId), eq(schema.xpLedger.source, "focus")));
    expect(focus[0]!.reason).toBe("2 active minutes");

    // Resending the minutes without meetings clears them.
    expect((await post(payload(minutes.map((m) => ({ ...m, meetings: [] }))))).status).toBe(200);
    expect(await db.select().from(schema.minuteMeeting).where(eq(schema.minuteMeeting.userId, userId))).toHaveLength(0);
  });

  it("ignores minutes older than the ingest window and prunes minutes past retention", async () => {
    const day = 86_400_000;
    const old = new Date(Math.floor((Date.now() - 20 * day) / 60_000) * 60_000);
    await db.insert(schema.minuteApp).values({ userId, deviceId, t: old, bundleId: "com.old.app", appName: "Old", activeSec: 60 });
    const tooOld = new Date(Math.floor((Date.now() - 15 * day) / 60_000) * 60_000).toISOString().replace(".000Z", "Z");
    const res = await post(payload([
      { t: tooOld, apps: [{ id: "com.late.app", name: "Late", sec: 60 }], agents: [] },
      { t: minuteIso(1), apps: [{ id: "com.apple.Terminal", name: "Terminal", sec: 60 }], agents: [] },
    ]));
    expect(res.status).toBe(200);
    const apps = (await db.select().from(schema.minuteApp).where(eq(schema.minuteApp.userId, userId))).map((r) => r.bundleId);
    expect(apps).toEqual(["com.apple.Terminal"]);
  });

  it("lets a minute older than 24 hours be written once but never replaced", async () => {
    const t = minuteIso(30 * 60); // 30 hours ago
    expect((await post(payload([{ t, apps: [{ id: "com.first.app", name: "First", sec: 60 }], agents: [] }]))).status).toBe(200);
    // A resend, an empty "clear", and a change of app are all ignored.
    await post(payload([{ t, apps: [{ id: "com.rewrite.app", name: "Rewrite", sec: 60 }], agents: [] }]));
    await post(payload([{ t, apps: [], agents: [] }]));
    const apps = (await db.select().from(schema.minuteApp).where(eq(schema.minuteApp.userId, userId))).map((r) => r.bundleId);
    expect(apps).toEqual(["com.first.app"]);
  });

  it("deletes this device's chats listed in deletedChats", async () => {
    await post(payload([], [chat("aaaaaaaaaaaaaaaa", 60, 1, 10), chat("bbbbbbbbbbbbbbbb", 60, 1, 10)]));
    expect((await post({ ...payload([]), deletedChats: ["aaaaaaaaaaaaaaaa"] })).status).toBe(200);
    const left = await db.select().from(schema.chats).where(eq(schema.chats.userId, userId));
    expect(left.map((c) => c.chatId)).toEqual(["bbbbbbbbbbbbbbbb"]);
    expect((await post({ ...payload([]), deletedChats: ["not-a-chat-id"] })).status).toBe(400);
  });

  it("accepts, declines and expires live quest offers", async () => {
    const offer = async (createdAt = new Date()) => (await db.insert(schema.quests).values({
      userId, kind: "live", template: "stay_longer", title: "Stay 15 minutes longer", target: 900, unit: "sec", xp: 200,
      state: "offered", createdAt,
    }).returning())[0]!;

    const a = await offer();
    expect((await questAction(accept, a.id)).status).toBe(200);
    const accepted = await db.query.quests.findFirst({ where: eq(schema.quests.id, a.id) });
    expect(accepted?.state).toBe("active");
    expect(accepted!.windowEnd!.getTime() - accepted!.windowStart!.getTime()).toBe(25 * 60_000);
    expect((await questAction(accept, a.id)).status).toBe(409);

    const d = await offer();
    expect((await questAction(decline, d.id)).status).toBe(200);
    expect((await db.query.quests.findFirst({ where: eq(schema.quests.id, d.id) }))?.state).toBe("declined");

    const old = await offer(new Date(Date.now() - 11 * 60_000));
    expect((await questAction(accept, old.id)).status).toBe(410);
    expect((await questAction(accept, "00000000-0000-0000-0000-000000000000")).status).toBe(404);
  });
});
