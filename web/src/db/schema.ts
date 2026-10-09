import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  uuid,
  primaryKey,
  unique,
  jsonb,
  bigint,
  smallint,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const roleEnum = pgEnum("role", ["member", "admin"]);
export const questKindEnum = pgEnum("quest_kind", ["live", "daily", "weekly", "guild"]);
export const questStateEnum = pgEnum("quest_state", [
  "offered",
  "active",
  "completed",
  "failed",
  "expired",
  "declined",
]);
export const xpSourceEnum = pgEnum("xp_source", [
  "focus",
  "agent",
  "orchestration",
  "linear",
  "quest",
]);

// ─── Guilds ───────────────────────────────────────────────────────────────────

export const guilds = pgTable("guilds", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  color: text("color").notNull().default("#e8743f"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Users ────────────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("email_verified", { withTimezone: true }),
  name: text("name"),
  image: text("image"),
  handle: text("handle").unique(),
  bio: text("bio"),
  role: roleEnum("role").notNull().default("member"),
  guildId: uuid("guild_id").references(() => guilds.id, { onDelete: "set null" }),
  timezone: text("timezone").notNull().default("UTC"),
  /** Colour choices (lib/colours.ts); null = the defaults. */
  palette: text("palette"),
  accent: text("accent"),
  /** When a Mac (or the person) last set the timezone; null means it's still the default. */
  timezoneSetAt: timestamp("timezone_set_at", { withTimezone: true }),
  // What this person shares (spec §7, give to get): you see a stat of someone
  // else only if they share it and you share it too. Nothing is shared by default.
  shareXp: boolean("share_xp").notNull().default(false),
  shareHuman: boolean("share_human").notNull().default(false),
  shareAgents: boolean("share_agents").notNull().default(false),
  shareMeetings: boolean("share_meetings").notNull().default(false),
  shareApps: boolean("share_apps").notNull().default(false),
  shareSkills: boolean("share_skills").notNull().default(false),
  // Set when the person finishes first-login onboarding (their sharing choices).
  onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Auth.js required tables
export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => [primaryKey({ columns: [table.provider, table.providerAccountId] })]
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.identifier, table.token] })]
);

// ─── Devices ──────────────────────────────────────────────────────────────────

export const devices = pgTable("devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  /** The Mac's own stable id (sent with every upload), to recognise it when it pairs again. */
  clientId: text("client_id"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  agentVersion: text("agent_version"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

// ─── Minute-level data ────────────────────────────────────────────────────────

export const minuteApp = pgTable(
  "minute_app",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    t: timestamp("t", { withTimezone: true }).notNull(),
    bundleId: text("bundle_id").notNull(),
    appName: text("app_name"),
    activeSec: smallint("active_sec").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.deviceId, table.t, table.bundleId] }),
    index("minute_app_user_t_idx").on(table.userId, table.t),
  ]
);

export const minuteAgent = pgTable(
  "minute_agent",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    t: timestamp("t", { withTimezone: true }).notNull(),
    agent: text("agent").notNull(),
    sessions: smallint("sessions").notNull().default(1),
    agentSec: integer("agent_sec").notNull().default(0),
    peak: smallint("peak").notNull().default(1),
    tokensIn: bigint("tokens_in", { mode: "number" }).notNull().default(0),
    tokensCached: bigint("tokens_cached", { mode: "number" }).notNull().default(0),
    tokensOut: bigint("tokens_out", { mode: "number" }).notNull().default(0),
    /** Total seconds with every thread (main and sub-agents) counted on its own; null from older Macs (= agent_sec). */
    workSec: integer("work_sec"),
    /** Threads working in the minute, sub-agents included; null from older Macs (= sessions). */
    threads: smallint("threads"),
  },
  (table) => [
    primaryKey({ columns: [table.deviceId, table.t, table.agent] }),
    index("minute_agent_user_t_idx").on(table.userId, table.t),
  ]
);

export const minuteMeeting = pgTable(
  "minute_meeting",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    t: timestamp("t", { withTimezone: true }).notNull(),
    // The call app holding the microphone, or "private".
    bundleId: text("bundle_id").notNull(),
    appName: text("app_name"),
    sec: smallint("sec").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.deviceId, table.t, table.bundleId] }),
    index("minute_meeting_user_t_idx").on(table.userId, table.t),
  ]
);

// ─── Chats ────────────────────────────────────────────────────────────────────

export const chats = pgTable(
  "chats",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    agent: text("agent").notNull(),
    chatId: text("chat_id").notNull(), // 16 hex chars
    firstAt: timestamp("first_at", { withTimezone: true }).notNull(),
    lastAt: timestamp("last_at", { withTimezone: true }).notNull(),
    agentSec: integer("agent_sec").notNull().default(0),
    turns: integer("turns").notNull().default(0),
    tokensIn: bigint("tokens_in", { mode: "number" }).notNull().default(0),
    tokensCached: bigint("tokens_cached", { mode: "number" }).notNull().default(0),
    tokensOut: bigint("tokens_out", { mode: "number" }).notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.deviceId, table.agent, table.chatId] }),
    index("chats_user_idx").on(table.userId),
    index("chats_user_agent_idx").on(table.userId, table.agent),
  ]
);

// ─── Daily rollup ─────────────────────────────────────────────────────────────

export const dailyRollup = pgTable(
  "daily_rollup",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // YYYY-MM-DD in user's timezone
    day: text("day").notNull(),
    humanSec: integer("human_sec").notNull().default(0),
    agentSec: integer("agent_sec").notNull().default(0),
    // Seconds in calls (a call app holding the microphone); not part of humanSec.
    meetingSec: integer("meeting_sec").notNull().default(0),
    // { claude: 3600, codex: 1800, ... }
    agentSecByAgent: jsonb("agent_sec_by_agent").notNull().default({}),
    // total uncached input + cache writes
    tokensIn: bigint("tokens_in", { mode: "number" }).notNull().default(0),
    tokensCached: bigint("tokens_cached", { mode: "number" }).notNull().default(0),
    tokensOut: bigint("tokens_out", { mode: "number" }).notNull().default(0),
    // tokens by agent { claude: { in, cached, out }, ... }
    tokensByAgent: jsonb("tokens_by_agent").notNull().default({}),
    peakParallel: smallint("peak_parallel").notNull().default(0),
    /** Total agent seconds, sub-agents counted separately (≥ agent_sec). */
    agentWorkSec: integer("agent_work_sec").notNull().default(0),
    /** Most threads working at once, sub-agents included. */
    peakThreads: smallint("peak_threads").notNull().default(0),
    longestFocusSec: integer("longest_focus_sec").notNull().default(0),
    focusBlocks: smallint("focus_blocks").notNull().default(0),
    // [{ id, name, sec, pct }]
    topApps: jsonb("top_apps").notNull().default([]),
    // Call apps by meeting time: [{ id, name, sec }]. Kept here because minutes are only kept for a few weeks.
    meetingApps: jsonb("meeting_apps").notNull().default([]),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.day] }),
    index("daily_rollup_user_day_idx").on(table.userId, table.day),
  ]
);

// ─── Leaderboard history ──────────────────────────────────────────────────────

/**
 * Top 10 of each finished board, kept for good (spec §4). Weekly boards are
 * per league and for everyone ("all"); monthly boards are for everyone.
 * Only people who shared the board's category when it was saved are included.
 */
export const leaderboardHistory = pgTable(
  "leaderboard_history",
  {
    period: text("period").notNull(), // "week" | "month"
    periodStart: text("period_start").notNull(), // YYYY-MM-DD (company timezone)
    board: text("board").notNull(), // "xp" | "human" | "agents"
    league: text("league").notNull(), // "all" or a league
    rank: smallint("rank").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    value: bigint("value", { mode: "number" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.period, table.periodStart, table.board, table.league, table.userId] }),
    index("leaderboard_history_lookup_idx").on(table.period, table.board, table.league, table.periodStart),
  ]
);

/** Team totals per finished period, each summed over the people sharing that category. */
export const periodTotals = pgTable(
  "period_totals",
  {
    period: text("period").notNull(),
    periodStart: text("period_start").notNull(),
    xp: bigint("xp", { mode: "number" }).notNull().default(0),
    xpPeople: smallint("xp_people").notNull().default(0),
    humanSec: bigint("human_sec", { mode: "number" }).notNull().default(0),
    humanPeople: smallint("human_people").notNull().default(0),
    agentSec: bigint("agent_sec", { mode: "number" }).notNull().default(0),
    agentPeople: smallint("agent_people").notNull().default(0),
    meetingSec: bigint("meeting_sec", { mode: "number" }).notNull().default(0),
    meetingPeople: smallint("meeting_people").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.period, table.periodStart] })]
);

// ─── XP ledger ────────────────────────────────────────────────────────────────

export const xpLedger = pgTable(
  "xp_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    day: text("day").notNull(), // YYYY-MM-DD
    source: xpSourceEnum("source").notNull(),
    sourceKey: text("source_key").notNull(),
    xp: integer("xp").notNull(),
    reason: text("reason").notNull(),
    rulesVersion: integer("rules_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("xp_ledger_user_source_key_unique").on(table.userId, table.source, table.sourceKey),
    index("xp_ledger_user_day_idx").on(table.userId, table.day),
  ]
);

// ─── Quests ───────────────────────────────────────────────────────────────────

export const quests = pgTable(
  "quests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    guildId: uuid("guild_id").references(() => guilds.id, { onDelete: "cascade" }),
    kind: questKindEnum("kind").notNull(),
    template: text("template").notNull(),
    title: text("title").notNull(),
    target: integer("target").notNull(),
    unit: text("unit").notNull().default("sec"),
    xp: integer("xp").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }),
    windowEnd: timestamp("window_end", { withTimezone: true }),
    state: questStateEnum("state").notNull().default("offered"),
    progress: integer("progress").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    index("quests_user_state_idx").on(table.userId, table.state),
    index("quests_guild_idx").on(table.guildId),
    index("quests_user_kind_idx").on(table.userId, table.kind),
    uniqueIndex("quests_user_template_window_idx").on(table.userId, table.template, table.windowStart),
  ]
);

// ─── Leagues ──────────────────────────────────────────────────────────────────

/** The league each person holds during a company week (Monday), saved once the week before is over. */
export const leagueWeeks = pgTable(
  "league_weeks",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    weekStart: text("week_start").notNull(), // YYYY-MM-DD, a Monday
    league: text("league").notNull(),
    /** How they got here from last week: up, down, stay, frozen (away) or start. */
    move: text("move").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.weekStart] }), index("league_weeks_week_idx").on(table.weekStart)]
);

/** Weekdays someone marked themselves away (company-timezone dates). */
export const awayDays = pgTable(
  "away_days",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    day: text("day").notNull(), // YYYY-MM-DD
  },
  (table) => [primaryKey({ columns: [table.userId, table.day] }), index("away_days_day_idx").on(table.day)]
);

// ─── Achievements ─────────────────────────────────────────────────────────────

/** When each person unlocked each achievement (ids in lib/achievements.ts). Saved once, kept for good. */
export const userAchievements = pgTable(
  "user_achievements",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    achievementId: text("achievement_id").notNull(),
    unlockedAt: timestamp("unlocked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.achievementId] }), index("user_achievements_id_idx").on(table.achievementId)]
);

/** Things people did on the site that some achievements count (e.g. whom they compared with). */
export const achievementEvents = pgTable(
  "achievement_events",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    detail: text("detail").notNull().default(""),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.kind, table.detail] })]
);

// ─── Bug reports ──────────────────────────────────────────────────────────────

export const bugReports = pgTable(
  "bug_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    /** Where the reporter was, e.g. "Mac app" or a page path. */
    context: text("context"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("bug_reports_created_idx").on(table.createdAt)]
);

// ─── Linear ───────────────────────────────────────────────────────────────────

export const linearAccounts = pgTable("linear_accounts", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
});

export const linearIssues = pgTable(
  "linear_issues",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    issueId: text("issue_id").notNull(),
    identifier: text("identifier").notNull(),
    estimate: integer("estimate"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.issueId] }),
    index("linear_issues_user_idx").on(table.userId),
  ]
);

// ─── Relations ────────────────────────────────────────────────────────────────

export const guildsRelations = relations(guilds, ({ many }) => ({
  users: many(users),
  quests: many(quests),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  guild: one(guilds, { fields: [users.guildId], references: [guilds.id] }),
  devices: many(devices),
  minuteApps: many(minuteApp),
  minuteAgents: many(minuteAgent),
  chats: many(chats),
  dailyRollups: many(dailyRollup),
  xpLedger: many(xpLedger),
  quests: many(quests),
  linearAccount: one(linearAccounts, { fields: [users.id], references: [linearAccounts.userId] }),
  linearIssues: many(linearIssues),
}));

export const devicesRelations = relations(devices, ({ one }) => ({
  user: one(users, { fields: [devices.userId], references: [users.id] }),
}));

// ─── Type exports ─────────────────────────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type Guild = typeof guilds.$inferSelect;
export type Device = typeof devices.$inferSelect;
export type MinuteApp = typeof minuteApp.$inferSelect;
export type MinuteAgent = typeof minuteAgent.$inferSelect;
export type Chat = typeof chats.$inferSelect;
export type DailyRollup = typeof dailyRollup.$inferSelect;
export type XpLedger = typeof xpLedger.$inferSelect;
export type Quest = typeof quests.$inferSelect;
export type LinearAccount = typeof linearAccounts.$inferSelect;
export type LinearIssue = typeof linearIssues.$inferSelect;
