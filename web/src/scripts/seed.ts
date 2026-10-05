/**
 * Local demo data: 12 teammates in 3 guilds with 90 days of activity, run
 * through the real rollup, XP and quest code. Also creates SEED_OWNER_EMAIL
 * (SEED_OWNER_EMAIL, default you@<ALLOWED_EMAIL_DOMAIN>) with no history, so a paired Mac fills it
 * with real data.
 *
 *   pnpm seed            # wipes and reseeds the local database
 *
 * Refuses to run against anything but localhost.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { hashDeviceToken } from "@/lib/device-auth";
import { encryptApiKey } from "@/lib/linear-crypto";
import { evaluateQuests } from "@/lib/quest-db";
import { sharingColumns, type Visibility } from "@/lib/sharing";
import { recomputeDay } from "@/lib/rollup";
import { addDays, dayBounds, toUserDay } from "@/lib/timezone";

const url = process.env.DATABASE_URL ?? "postgresql://arena:arena@localhost:5433/arena";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("Refusing to seed a non-local database:", url.replace(/:[^:@/]+@/, ":***@"));
  process.exit(1);
}

// Deterministic PRNG (mulberry32) so every seed run looks the same.
let state = 0x5eed;
function rand(): number {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (min: number, max: number) => min + rand() * (max - min);
const int = (min: number, max: number) => Math.floor(between(min, max + 1));
function weighted<T>(items: Array<[T, number]>): T {
  let r = rand() * items.reduce((s, [, w]) => s + w, 0);
  for (const [item, w] of items) if ((r -= w) <= 0) return item;
  return items[items.length - 1]![0];
}
const hex16 = () => Array.from({ length: 16 }, () => int(0, 15).toString(16)).join("");

const APPS: Record<string, [string, string]> = {
  cursor: ["com.todesktop.230313mzl4w4u92", "Cursor"],
  code: ["com.microsoft.VSCode", "Visual Studio Code"],
  ghostty: ["com.mitchellh.ghostty", "Ghostty"],
  terminal: ["com.apple.Terminal", "Terminal"],
  arc: ["company.thebrowser.Browser", "Arc"],
  chrome: ["com.google.Chrome", "Google Chrome"],
  slack: ["com.tinyspeck.slackmacgap", "Slack"],
  figma: ["com.figma.Desktop", "Figma"],
  linear: ["com.linear", "Linear"],
  notion: ["notion.id", "Notion"],
  zoom: ["us.zoom.xos", "zoom.us"],
};

interface Persona {
  name: string;
  handle: string;
  guild: number;
  bio: string;
  tz: string;
  /** Typical focus hours on a workday. */
  hours: number;
  /** Probability of working on a given weekday / weekend day. */
  weekday: number;
  weekend: number;
  apps: Array<[keyof typeof APPS, number]>;
  agents: Array<[string, number]>;
  /** How many agent chats they usually run at once. */
  parallel: number;
  linear: boolean;
}

const PEOPLE: Persona[] = [
  { name: "Priya Sharma", handle: "priya", guild: 0, bio: "Recording engine and capture pipeline", tz: "Asia/Kolkata", hours: 7.5, weekday: 0.95, weekend: 0.25, apps: [["cursor", 5], ["ghostty", 3], ["arc", 2], ["slack", 1]], agents: [["claude", 6], ["codex", 3]], parallel: 4, linear: true },
  { name: "Arjun Mehta", handle: "arjun", guild: 0, bio: "Editor timeline, undo and export", tz: "Asia/Kolkata", hours: 6.5, weekday: 0.9, weekend: 0.15, apps: [["code", 5], ["terminal", 2], ["chrome", 2], ["slack", 1]], agents: [["codex", 5], ["claude", 3], ["opencode", 1]], parallel: 3, linear: true },
  { name: "Mei Lin", handle: "mei", guild: 0, bio: "AI voiceover and captions", tz: "Asia/Singapore", hours: 6, weekday: 0.9, weekend: 0.1, apps: [["cursor", 4], ["arc", 3], ["notion", 1], ["slack", 1]], agents: [["cursor", 4], ["claude", 3]], parallel: 2, linear: true },
  { name: "Daniel Okafor", handle: "daniel", guild: 0, bio: "Infra, queues and the render farm", tz: "Europe/London", hours: 7, weekday: 0.92, weekend: 0.3, apps: [["ghostty", 5], ["code", 3], ["chrome", 2], ["slack", 1]], agents: [["claude", 5], ["codex", 2], ["pi", 1]], parallel: 5, linear: true },
  { name: "Sara Kapoor", handle: "sara", guild: 1, bio: "Design systems and the docs editor", tz: "Asia/Kolkata", hours: 6, weekday: 0.9, weekend: 0.1, apps: [["figma", 6], ["arc", 2], ["linear", 1], ["slack", 2]], agents: [["claude", 3], ["cursor", 1]], parallel: 1, linear: true },
  { name: "Rohan Iyer", handle: "rohan", guild: 1, bio: "Onboarding and growth experiments", tz: "Asia/Kolkata", hours: 5.5, weekday: 0.85, weekend: 0.1, apps: [["chrome", 4], ["cursor", 3], ["notion", 2], ["slack", 2]], agents: [["claude", 4], ["codex", 2]], parallel: 2, linear: true },
  { name: "Lena Fischer", handle: "lena", guild: 1, bio: "Marketing site and launch videos", tz: "Europe/Berlin", hours: 5, weekday: 0.88, weekend: 0.05, apps: [["figma", 3], ["arc", 3], ["notion", 2], ["zoom", 1]], agents: [["claude", 3]], parallel: 1, linear: false },
  { name: "Kabir Singh", handle: "kabir", guild: 1, bio: "Billing, auth and the admin console", tz: "Asia/Kolkata", hours: 7, weekday: 0.93, weekend: 0.2, apps: [["code", 5], ["terminal", 3], ["chrome", 2], ["slack", 1]], agents: [["codex", 4], ["opencode", 3], ["claude", 2]], parallel: 3, linear: true },
  { name: "Ana Souza", handle: "ana", guild: 2, bio: "Customer success and help-center videos", tz: "America/Sao_Paulo", hours: 5, weekday: 0.9, weekend: 0.05, apps: [["chrome", 4], ["slack", 4], ["zoom", 2], ["notion", 2]], agents: [["claude", 2], ["gemini", 1]], parallel: 1, linear: false },
  { name: "Vikram Rao", handle: "vikram", guild: 2, bio: "Integrations: Zendesk, Intercom, Notion", tz: "Asia/Kolkata", hours: 6.5, weekday: 0.9, weekend: 0.2, apps: [["cursor", 4], ["ghostty", 2], ["chrome", 2], ["slack", 1]], agents: [["claude", 4], ["amp", 1], ["codex", 2]], parallel: 3, linear: true },
  { name: "Hana Park", handle: "hana", guild: 2, bio: "Data, analytics and the weekly numbers", tz: "Asia/Seoul", hours: 6, weekday: 0.88, weekend: 0.1, apps: [["code", 3], ["chrome", 3], ["notion", 2], ["slack", 1]], agents: [["codex", 3], ["claude", 2]], parallel: 2, linear: true },
  { name: "Tom Becker", handle: "tom", guild: 2, bio: "Sales engineering and demos", tz: "America/New_York", hours: 4.5, weekday: 0.85, weekend: 0.05, apps: [["chrome", 4], ["zoom", 3], ["slack", 3], ["notion", 1]], agents: [["claude", 2]], parallel: 1, linear: false },
];

/** Agents detected only by process scan have no token data (spec §1.3). */
const NO_TOKENS = new Set(["gemini", "amp"]);

interface Minute { human: Map<string, number>; agents: Map<string, { sec: number; sessions: number; tin: number; tcached: number; tout: number }> }

/** Who shares what in the demo data: most share everything, a few hold some back. */
const SHARING: Record<string, Partial<Visibility>> = {
  lena: { apps: false, skills: false },
  hana: { meetings: false },
  vikram: { agents: false },
  tom: { xp: false, human: false, agents: false, meetings: false, apps: false, skills: false },
};

async function main() {
  console.log("Wiping local database…");
  await db.execute(sql`TRUNCATE guilds, users, devices, minute_app, minute_agent, minute_meeting, chats, daily_rollup, xp_ledger, quests, linear_accounts, linear_issues RESTART IDENTITY CASCADE`);

  const guilds = await db.insert(schema.guilds).values([
    { name: "Capture", slug: "capture", color: "#d2683a" },
    { name: "Studio", slug: "studio", color: "#9b6ad6" },
    { name: "Frontline", slug: "frontline", color: "#3fa58b" },
  ]).returning();

  const domain = process.env.ALLOWED_EMAIL_DOMAIN || "example.com";
  const ownerEmail = process.env.SEED_OWNER_EMAIL ?? `you@${domain}`;
  const ownerHandle = ownerEmail.split("@")[0]!.toLowerCase().replace(/[^a-z0-9]/g, "");
  await db.insert(schema.users).values({
    email: ownerEmail, name: ownerHandle.charAt(0).toUpperCase() + ownerHandle.slice(1), handle: ownerHandle,
    role: "admin", guildId: guilds[0]!.id, timezone: "Asia/Kolkata", bio: "Building Arena",
  });

  const now = new Date();
  for (const person of PEOPLE) {
    const [user] = await db.insert(schema.users).values({
      email: `${person.handle}@${domain}`, name: person.name, handle: person.handle, bio: person.bio,
      guildId: guilds[person.guild]!.id, timezone: person.tz,
      createdAt: new Date(now.getTime() - 120 * 86_400_000),
      ...sharingColumns({ xp: true, human: true, agents: true, meetings: true, apps: true, skills: true, ...SHARING[person.handle] }),
      onboardedAt: now,
    }).returning();
    const [device] = await db.insert(schema.devices).values({
      userId: user!.id, name: `${person.name.split(" ")[0]}'s MacBook Pro`, tokenHash: hashDeviceToken(hex16() + hex16()), agentVersion: "0.1.0",
    }).returning();
    if (person.linear) {
      await db.insert(schema.linearAccounts).values({ userId: user!.id, apiKeyEnc: encryptApiKey("lin_api_seed_placeholder"), lastSyncedAt: now });
    }
    await seedPerson(person, user!.id, device!.id, now);
    console.log(`  ${person.name}`);
  }
  console.log("Done.");
  process.exit(0);
}

async function seedPerson(p: Persona, userId: string, deviceId: string, now: Date) {
  const today = toUserDay(now, p.tz);
  const appRows: (typeof schema.minuteApp.$inferInsert)[] = [];
  const agentRows: (typeof schema.minuteAgent.$inferInsert)[] = [];
  const meetingRows: (typeof schema.minuteMeeting.$inferInsert)[] = [];
  const chatRows: (typeof schema.chats.$inferInsert)[] = [];
  const issueRows: (typeof schema.linearIssues.$inferInsert)[] = [];
  const days: string[] = [];

  for (let back = 89; back >= 0; back--) {
    const day = addDays(today, -back);
    const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
    const weekend = dow === 0 || dow === 6;
    if (rand() > (weekend ? p.weekend : p.weekday)) continue;
    days.push(day);

    const { start } = dayBounds(day, p.tz);
    const minutes = new Map<number, Minute>();
    const at = (idx: number) => {
      let m = minutes.get(idx);
      if (!m) minutes.set(idx, (m = { human: new Map(), agents: new Map() }));
      return m;
    };

    // Focus sessions through the day; ramp up over the 90 days a little.
    const effort = (weekend ? 0.4 : 1) * (0.8 + 0.3 * ((89 - back) / 89)) * between(0.7, 1.2);
    let cursor = Math.round(between(8.5, 10.5) * 60); // local minute of day
    let focusLeft = p.hours * 60 * effort;
    while (focusLeft > 15 && cursor < 21 * 60) {
      const length = Math.min(focusLeft, between(35, 130));
      for (let i = 0; i < length; i++) {
        if (rand() < 0.06) continue; // brief pauses
        const app = weighted(p.apps);
        const idx = cursor + i;
        const m = at(idx);
        m.human.set(app, 60); // the Mac app sends a full minute for every minute with input
      }
      startChats(p, cursor, length, at, chatRows, { userId, deviceId, dayStart: start, now });
      cursor += Math.round(length + between(8, 50));
      focusLeft -= length;
    }

    for (const [idx, m] of minutes) {
      const t = new Date(start.getTime() + idx * 60_000);
      if (t > now) continue;
      for (const [app, sec] of m.human) {
        const [bundleId, appName] = APPS[app]!;
        appRows.push({ userId, deviceId, t, bundleId, appName, activeSec: Math.min(60, sec) });
      }
      for (const [agent, a] of m.agents) {
        agentRows.push({ userId, deviceId, t, agent, sessions: a.sessions, peak: a.sessions, agentSec: Math.round(a.sec),
          tokensIn: Math.round(a.tin), tokensCached: Math.round(a.tcached), tokensOut: Math.round(a.tout) });
      }
    }

    if (!weekend) meetingRows.push(...meetingsForDay(userId, deviceId, start, now));

    if (p.linear && !weekend) {
      for (let i = int(0, 3); i > 0; i--) {
        const completedAt = new Date(start.getTime() + between(11, 19) * 3_600_000);
        if (completedAt > now) continue;
        const n = int(100, 999);
        issueRows.push({ userId, issueId: `seed-${p.handle}-${day}-${i}`, identifier: `ENG-${n}`, title: `Seed issue ${n}`,
          estimate: weighted([[1, 3], [2, 3], [3, 2], [5, 1]]), completedAt, url: null });
      }
    }
  }

  for (let i = 0; i < appRows.length; i += 1000) await db.insert(schema.minuteApp).values(appRows.slice(i, i + 1000)).onConflictDoNothing();
  for (let i = 0; i < agentRows.length; i += 1000) await db.insert(schema.minuteAgent).values(agentRows.slice(i, i + 1000)).onConflictDoNothing();
  for (let i = 0; i < meetingRows.length; i += 1000) await db.insert(schema.minuteMeeting).values(meetingRows.slice(i, i + 1000)).onConflictDoNothing();
  for (let i = 0; i < chatRows.length; i += 500) await db.insert(schema.chats).values(chatRows.slice(i, i + 500)).onConflictDoNothing();
  if (issueRows.length) await db.insert(schema.linearIssues).values(issueRows);

  for (const day of days) await recomputeDay(userId, day, p.tz);
  await evaluateQuests(userId, now);
}

/** Agent chats started during a focus session, some outliving it. */
const CALL_APPS: Array<[[string, string], number]> = [
  [["us.zoom.xos", "zoom.us"], 4], [["com.google.Chrome", "Google Chrome"], 3], [["com.tinyspeck.slackmacgap", "Slack"], 2],
];

/** A 15-minute standup most days plus up to two longer calls. */
export function meetingsForDay(userId: string, deviceId: string, dayStart: Date, now: Date): (typeof schema.minuteMeeting.$inferInsert)[] {
  const calls: Array<[number, number]> = [];
  if (rand() < 0.85) calls.push([10 * 60, 15]);
  for (let i = int(0, 2); i > 0; i--) calls.push([Math.round(between(12, 18) * 60), weighted([[30, 3], [45, 2], [60, 2]])]);
  const rows: (typeof schema.minuteMeeting.$inferInsert)[] = [];
  const seen = new Set<number>();
  for (const [startMin, length] of calls) {
    const [bundleId, appName] = weighted(CALL_APPS);
    for (let i = 0; i < length; i++) {
      const idx = startMin + i;
      const t = new Date(dayStart.getTime() + idx * 60_000);
      if (t > now || seen.has(idx)) continue;
      seen.add(idx);
      rows.push({ userId, deviceId, t, bundleId, appName, sec: 60 });
    }
  }
  return rows;
}

function startChats(
  p: Persona, from: number, length: number, at: (idx: number) => Minute,
  chatRows: (typeof schema.chats.$inferInsert)[],
  ctx: { userId: string; deviceId: string; dayStart: Date; now: Date },
) {
  const { dayStart, now } = ctx;
  const count = Math.max(0, Math.round(between(p.parallel * 0.5, p.parallel * 1.3)));
  for (let c = 0; c < count; c++) {
    const agent = weighted(p.agents);
    const begin = from + int(0, Math.max(0, Math.round(length * 0.5)));
    const span = Math.round(between(12, Math.max(20, length * 1.1)));
    const duty = between(0.45, 0.85);
    const tokensPerSec = NO_TOKENS.has(agent) ? 0 : between(35, 75);
    let agentSec = 0;
    let tout = 0;
    let tin = 0;
    let tcached = 0;
    for (let i = 0; i < span; i++) {
      const sec = 60 * duty * between(0.6, 1.2);
      const m = at(begin + i);
      const a = m.agents.get(agent) ?? { sec: 0, sessions: 0, tin: 0, tcached: 0, tout: 0 };
      const out = sec * tokensPerSec * between(0.5, 1.5);
      a.sec += Math.min(60, sec);
      a.sessions += 1;
      a.tout += out;
      a.tin += out * between(2, 5);
      a.tcached += out * between(20, 45);
      m.agents.set(agent, a);
      agentSec += Math.min(60, sec);
      tout += out;
      tin += out * 3;
      tcached += out * 30;
    }
    if (NO_TOKENS.has(agent)) continue; // process-scanned agents don't produce chats
    const firstAt = new Date(dayStart.getTime() + begin * 60_000);
    if (firstAt > now) continue;
    const lastAt = new Date(Math.min(now.getTime(), dayStart.getTime() + (begin + span) * 60_000));
    chatRows.push({
      userId: ctx.userId, deviceId: ctx.deviceId, agent, chatId: hex16(), firstAt, lastAt,
      agentSec: Math.round(agentSec), turns: int(3, 30), tokensIn: Math.round(tin), tokensCached: Math.round(tcached), tokensOut: Math.round(tout),
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
