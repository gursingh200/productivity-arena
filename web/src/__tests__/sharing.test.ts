/**
 * Give-to-get sharing (spec §7), checked on what the server actually returns:
 * hidden stats must not appear anywhere in a profile, a leaderboard or the
 * leaderboard API. Runs against the real Postgres; skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { visibility, type Visibility } from "@/lib/sharing";

const DB_URL = process.env.DATABASE_URL;
const session = { user: { id: "" } };
vi.mock("@/auth", () => ({ auth: async () => session }));

const none: Visibility = { xp: false, human: false, agents: false, meetings: false, apps: false, skills: false };
const all: Visibility = { xp: true, human: true, agents: true, meetings: true, apps: true, skills: true };
const sharer = (id: string, v: Visibility) => ({
  id, shareXp: v.xp, shareHuman: v.human, shareAgents: v.agents, shareMeetings: v.meetings, shareApps: v.apps, shareSkills: v.skills,
});

describe("visibility", () => {
  it("needs both people to share a category", () => {
    expect(visibility(sharer("a", { ...none, human: true }), sharer("b", all))).toEqual({ ...none, human: true });
    expect(visibility(sharer("a", all), sharer("b", { ...none, apps: true }))).toEqual({ ...none, apps: true });
    expect(visibility(sharer("a", none), sharer("b", all))).toEqual(none);
  });
  it("always shows you your own stats", () => {
    expect(visibility(sharer("a", none), sharer("a", none))).toEqual(all);
  });
});

describe.skipIf(!DB_URL)("sharing on the server", async () => {
  const { db } = await import("@/db");
  const schema = await import("@/db/schema");
  const { loadProfile } = await import("@/lib/profile");
  const { leaderboard } = await import("@/lib/leaderboard");
  const { sharingColumns } = await import("@/lib/sharing");
  const leaderboardApi = (await import("@/app/api/leaderboard/route")).GET;
  const sharingApi = (await import("@/app/api/settings/sharing/route")).PUT;

  const stamp = Date.now();
  // Distinctive numbers so a leak is easy to spot in serialized output.
  const SECRET = { human: 31337, agent: 42424, meeting: 13131, app: `com.secret.app${stamp}`, xp: 9871 };
  const ids: string[] = [];
  let owner: typeof schema.users.$inferSelect;
  const user = async (name: string, v: Visibility, role: "member" | "admin" = "member") => {
    const [u] = await db.insert(schema.users).values({
      email: `share-${name}-${stamp}@clueso.io`, name: `${name} ${stamp}`, handle: `share${name}${stamp}`, role, ...sharingColumns(v),
    }).returning();
    ids.push(u!.id);
    return u!;
  };
  const fresh = async (id: string) => (await db.query.users.findFirst({ where: eq(schema.users.id, id) }))!;

  beforeAll(async () => {
    owner = await user("owner", all);
    const [device] = await db.insert(schema.devices).values({ userId: owner.id, name: "Mac", tokenHash: `share-${stamp}` }).returning();
    const day = new Date().toISOString().slice(0, 10);
    await db.insert(schema.dailyRollup).values({
      userId: owner.id, day, humanSec: SECRET.human, agentSec: SECRET.agent, meetingSec: SECRET.meeting,
      agentSecByAgent: { claude: SECRET.agent }, tokensByAgent: { claude: { in: 1, cached: 1, out: 55555 } }, peakParallel: 7,
      topApps: [{ id: SECRET.app, name: "Secret App", sec: 60, pct: 100 }],
      meetingApps: [{ id: "us.zoom.xos", name: "zoom.us", sec: SECRET.meeting }],
    });
    await db.insert(schema.minuteApp).values({
      userId: owner.id, deviceId: device!.id, t: new Date(Math.floor(Date.now() / 60_000) * 60_000 - 3_600_000),
      bundleId: SECRET.app, appName: "Secret App", activeSec: 60,
    });
    await db.insert(schema.xpLedger).values([
      { userId: owner.id, day, source: "focus", sourceKey: `focus:${day}`, xp: SECRET.xp, reason: "secret reason" },
      { userId: owner.id, day, source: "agent", sourceKey: `agent:${day}`, xp: 101, reason: "404 agent-minutes" },
      { userId: owner.id, day, source: "linear", sourceKey: `linear:x${stamp}`, xp: 65, reason: "Closed ENG-1, estimate 3" },
    ]);
  });

  afterAll(async () => {
    if (ids.length) await db.delete(schema.users).where(inArray(schema.users.id, ids));
  });

  const leaks = (value: unknown) => {
    const text = JSON.stringify(value);
    return [String(SECRET.human), String(SECRET.agent), String(SECRET.meeting), SECRET.app, String(SECRET.xp), "secret reason", "55555"]
      .filter((s) => text.includes(s));
  };

  it("shows nothing to a viewer who shares nothing, admins included", async () => {
    for (const role of ["member", "admin"] as const) {
      const viewer = await user(`nothing${role}`, none, role);
      const profile = (await loadProfile(owner.handle!, viewer))!;
      expect(leaks(profile)).toEqual([]);
      expect(profile.visible).toEqual(none);
      expect(profile.hidden.human).toBe("yours");
    }
  });

  it("shows only the categories both people share", async () => {
    const viewer = await user("humanonly", { ...none, human: true });
    const profile = (await loadProfile(owner.handle!, viewer))!;
    expect(profile.week.humanSec).not.toBeNull();
    expect(profile.week.agentSec).toBeNull();
    expect(profile.xp).toBeNull();
    expect(profile.apps).toBeNull();
    expect(profile.agents).toBeNull();
    expect(profile.skills).toBeNull();
    expect(JSON.stringify(profile)).not.toContain(SECRET.app);
    expect(JSON.stringify(profile)).not.toContain(String(SECRET.agent));
  });

  it("shows only XP rows from categories the viewer can see", async () => {
    const viewer = await user("xponly", { ...none, xp: true });
    const profile = (await loadProfile(owner.handle!, viewer))!;
    expect(profile.xp!.recentXp.map((r) => r.source)).toEqual(["linear"]);
    expect(JSON.stringify(profile)).not.toContain("agent-minutes");
  });

  it("hides skills axes computed from categories the viewer can't see", async () => {
    const viewer = await user("skillsonly", { ...none, skills: true });
    const skills = (await loadProfile(owner.handle!, viewer))!.skills!;
    // Every scale hides the same axes: a team rank gives away as much as the score.
    for (const scale of [skills.absolute, skills.team, ...(skills.guild ? [skills.guild] : [])]) {
      expect(scale.orchestration).toBeNull();
      expect(scale.intensity).toBeNull();
      expect(scale.endurance).toBeNull();
      expect(scale.camaraderie).toBeNull();
      expect(scale.parallelism).toBeNull();
    }
  });

  it("hides a category the owner doesn't share even from a viewer who does", async () => {
    await db.update(schema.users).set({ shareApps: false }).where(eq(schema.users.id, owner.id));
    const viewer = await user("appsfan", all);
    const profile = (await loadProfile(owner.handle!, viewer))!;
    expect(profile.apps).toBeNull();
    expect(profile.hidden.apps).toBe("theirs");
    expect(JSON.stringify(profile)).not.toContain(SECRET.app);
    await db.update(schema.users).set({ shareApps: true }).where(eq(schema.users.id, owner.id));
  });

  it("shows apps, and call apps only with meetings, to a viewer who shares them", async () => {
    const appsOnly = (await loadProfile(owner.handle!, await user("appsviewer", { ...none, apps: true })))!;
    expect(appsOnly.apps!.top[0]!.id).toBe(SECRET.app);
    expect(appsOnly.apps!.calls).toBeNull();
    const withMeetings = (await loadProfile(owner.handle!, await user("callsviewer", { ...none, apps: true, meetings: true })))!;
    expect(withMeetings.apps!.calls![0]!.sec).toBe(SECRET.meeting);
  });

  it("shows owners everything about themselves", async () => {
    const solo = await user("solo", none);
    const profile = (await loadProfile(solo.handle!, solo))!;
    expect(profile.visible).toEqual(all);
  });

  it("locks a board for a viewer who doesn't share its category, and leaves non-sharers off it", async () => {
    const viewer = await user("nolb", none);
    expect((await leaderboard("weekly_xp", viewer)).locked).toBe(true);
    expect((await leaderboard("human_hours", viewer)).locked).toBe(true);

    const hider = await user("hider", { ...none, xp: true });
    const xpViewer = await user("xpfan", { ...none, xp: true });
    const board = await leaderboard("weekly_xp", xpViewer);
    if (board.locked) throw new Error("board should be open");
    const ownerRow = board.rows.find((r) => r.userId === owner.id)!;
    // The viewer doesn't share human or agents, so the split stays hidden.
    expect(ownerRow.weeklyHumanSec).toBeNull();
    expect(ownerRow.weeklyAgentSec).toBeNull();
    expect(ownerRow.weeklyAgentWorkSec).toBeNull();
    expect(board.rows.some((r) => r.userId === hider.id)).toBe(true);
    const humanBoard = await leaderboard("human_hours", await user("humanfan", { ...none, human: true }));
    if (humanBoard.locked) throw new Error("board should be open");
    expect(humanBoard.rows.some((r) => r.userId === hider.id)).toBe(false);
  });

  it("returns the same filtered board from the API, whatever the request asks for", async () => {
    const viewer = await user("api", none);
    session.user.id = viewer.id;
    for (const tab of ["weekly_xp", "human_hours", "agent_hours", "level", "bogus"]) {
      const res = await leaderboardApi(new NextRequest(`http://localhost/api/leaderboard?tab=${tab}&showAll=1`));
      const body = await res.json();
      expect(body.board.locked).toBe(true);
      expect(leaks(body)).toEqual([]);
    }
  });

  it("saves sharing only with all six choices, and completes onboarding", async () => {
    const viewer = await user("onboard", none);
    session.user.id = viewer.id;
    const put = (body: unknown) => sharingApi(new NextRequest("http://localhost/api/settings/sharing", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }));
    expect((await put({ xp: true })).status).toBe(400);
    expect((await put({ ...all, admin: true })).status).toBe(400);
    expect((await put({ ...none, human: true })).status).toBe(200);
    const saved = await fresh(viewer.id);
    expect(saved.shareHuman).toBe(true);
    expect(saved.shareXp).toBe(false);
    expect(saved.onboardedAt).not.toBeNull();
  });
});
