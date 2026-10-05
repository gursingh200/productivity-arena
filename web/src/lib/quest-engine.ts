/**
 * Quest rules — pure functions over plain data (spec §5).
 * The database side lives in quest-db.ts.
 */
import {
  activityRuns,
  currentRun,
  focusBlocks,
  focusSec,
  isActive,
  longestParallelStreak,
  type MinuteRow,
} from "@/lib/game/activity";
import { localHour } from "@/lib/timezone";

export type { MinuteRow };

export type QuestKind = "live" | "daily" | "weekly" | "guild";
export type QuestUnit = "sec" | "count";

export interface QuestDefinition {
  kind: QuestKind;
  title: string;
  target: number;
  unit: QuestUnit;
  xp: number;
  /** Live quests: minutes allowed to finish after accepting. */
  windowMin?: number;
  /** Daily quests that only make sense with Linear connected. */
  needsLinear?: boolean;
}

export const QUESTS = {
  // Live — offered in the flow, must be accepted.
  stay_longer: { kind: "live", title: "Stay 15 minutes longer", target: 15 * 60, unit: "sec", xp: 200, windowMin: 25 },
  parallel_push: { kind: "live", title: "Run 3 agents at once for 10 minutes", target: 10 * 60, unit: "sec", xp: 150, windowMin: 60 },
  deep_block: { kind: "live", title: "Do a 50-minute focus block", target: 50 * 60, unit: "sec", xp: 250, windowMin: 90 },
  // Daily — 3 per user per day.
  focus_4h: { kind: "daily", title: "4 hours of focus", target: 4 * 3600, unit: "sec", xp: 100 },
  agents_6h: { kind: "daily", title: "6 agent-hours", target: 6 * 3600, unit: "sec", xp: 100 },
  two_blocks: { kind: "daily", title: "2 focus blocks", target: 2, unit: "count", xp: 80 },
  linear_2: { kind: "daily", title: "Close 2 Linear issues", target: 2, unit: "count", xp: 120, needsLinear: true },
  early_start: { kind: "daily", title: "20 active minutes before 10:00", target: 20 * 60, unit: "sec", xp: 60 },
  parallel_3: { kind: "daily", title: "3 agents at once for 15 minutes", target: 15 * 60, unit: "sec", xp: 100 },
  // Weekly — 3 per user per week.
  focus_20h: { kind: "weekly", title: "20 hours of focus", target: 20 * 3600, unit: "sec", xp: 300 },
  agents_40h: { kind: "weekly", title: "40 agent-hours", target: 40 * 3600, unit: "sec", xp: 300 },
  streak_5: { kind: "weekly", title: "2+ hours on 5 days", target: 5, unit: "count", xp: 250 },
  linear_8: { kind: "weekly", title: "Close 8 Linear issues", target: 8, unit: "count", xp: 300, needsLinear: true },
  // Guild — 1 per guild per week, pooled across members.
  guild_agents_300h: { kind: "guild", title: "Guild: 300 agent-hours", target: 300 * 3600, unit: "sec", xp: 200 },
  guild_focus_200h: { kind: "guild", title: "Guild: 200 hours of focus", target: 200 * 3600, unit: "sec", xp: 200 },
  guild_linear_40: { kind: "guild", title: "Guild: close 40 Linear issues", target: 40, unit: "count", xp: 250 },
} as const satisfies Record<string, QuestDefinition>;

export type QuestTemplate = keyof typeof QUESTS;

export function questDefinition(template: string): QuestDefinition | null {
  return (QUESTS as Record<string, QuestDefinition>)[template] ?? null;
}

const DAILY: QuestTemplate[] = ["focus_4h", "agents_6h", "two_blocks", "linear_2", "early_start", "parallel_3"];
const WEEKLY: QuestTemplate[] = ["focus_20h", "agents_40h", "streak_5", "linear_8"];
const GUILD: QuestTemplate[] = ["guild_agents_300h", "guild_focus_200h", "guild_linear_40"];

// ---------------------------------------------------------------------------
// Deterministic selection
// ---------------------------------------------------------------------------

/** 32-bit FNV-1a hash of a string. */
export function seedHash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Picks `count` items, the same ones every time for the same seed. */
function pick<T>(items: T[], seed: string, count: number): T[] {
  return [...items]
    .map((item, i) => ({ item, rank: seedHash(`${seed}:${i}`) }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, count)
    .map((x) => x.item);
}

export function selectDailyQuests(userId: string, day: string, hasLinear: boolean): QuestTemplate[] {
  const pool = DAILY.filter((t) => hasLinear || !questDefinition(t)!.needsLinear);
  return pick(pool, `${userId}:${day}`, 3);
}

export function selectWeeklyQuests(userId: string, weekStartDay: string, hasLinear: boolean): QuestTemplate[] {
  const pool = WEEKLY.filter((t) => hasLinear || !questDefinition(t)!.needsLinear);
  return pick(pool, `${userId}:${weekStartDay}`, 3);
}

export function selectGuildQuest(guildId: string, weekStartDay: string, anyMemberHasLinear: boolean): QuestTemplate {
  const pool = GUILD.filter((t) => anyMemberHasLinear || t !== "guild_linear_40");
  return pick(pool, `${guildId}:${weekStartDay}`, 1)[0]!;
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export interface DayContext {
  timezone: string;
  /** Today's minutes (sparse). */
  minutes: MinuteRow[];
  linearClosed: number;
}

export function dailyProgress(template: string, ctx: DayContext): number {
  switch (template) {
    case "focus_4h":
      return ctx.minutes.reduce((s, m) => s + focusSec(m), 0);
    case "agents_6h":
      return ctx.minutes.reduce((s, m) => s + m.agentSec, 0);
    case "two_blocks":
      return focusBlocks(ctx.minutes).length;
    case "linear_2":
      return ctx.linearClosed;
    case "early_start":
      return ctx.minutes.filter((m) => isActive(m) && localHour(m.t, ctx.timezone) < 10).length * 60;
    case "parallel_3":
      return longestParallelStreak(ctx.minutes, 3) * 60;
    default:
      return 0;
  }
}

export interface WeekContext {
  /** One entry per day of the current week so far. focusSec = human + call time. */
  days: Array<{ focusSec: number; agentSec: number }>;
  linearClosed: number;
}

export function weeklyProgress(template: string, ctx: WeekContext): number {
  switch (template) {
    case "focus_20h":
    case "guild_focus_200h":
      return ctx.days.reduce((s, d) => s + d.focusSec, 0);
    case "agents_40h":
    case "guild_agents_300h":
      return ctx.days.reduce((s, d) => s + d.agentSec, 0);
    case "streak_5":
      return ctx.days.filter((d) => d.focusSec >= 2 * 3600).length;
    case "linear_8":
    case "guild_linear_40":
      return ctx.linearClosed;
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------
// Live quests
// ---------------------------------------------------------------------------

/** Offers expire if not accepted within 10 minutes. */
export const LIVE_OFFER_TTL_MS = 10 * 60_000;
/** The same live quest isn't offered again within 2 hours. */
export const LIVE_REOFFER_COOLDOWN_MS = 2 * 3600_000;

/**
 * Which live quest to offer now, if any. `todayMinutes` are today's minutes;
 * `recentlyOffered` are templates offered within the cooldown.
 * Priority: stay_longer, deep_block, parallel_push.
 */
export function liveQuestToOffer(
  todayMinutes: MinuteRow[],
  now: Date,
  recentlyOffered: Set<string>,
): QuestTemplate | null {
  const run = currentRun(todayMinutes, now);
  if (!run) return null; // only offer while the human is at the keyboard

  const candidates: Array<[QuestTemplate, boolean]> = [
    ["stay_longer", run.activeMinutes >= 45],
    ["deep_block", run.activeMinutes >= 10 && focusBlocks(todayMinutes).length === 0],
    ["parallel_push", lastMinutes(todayMinutes, now, 2).some((m) => m.peak >= 1)],
  ];
  for (const [template, eligible] of candidates) {
    if (eligible && !recentlyOffered.has(template)) return template;
  }
  return null;
}

/** Progress of an accepted live quest, from minutes since it was accepted. */
export function liveProgress(template: string, minutesSinceAccept: MinuteRow[]): number {
  switch (template) {
    case "stay_longer":
      return minutesSinceAccept.filter(isActive).length * 60;
    case "parallel_push":
      return longestParallelStreak(minutesSinceAccept, 3) * 60;
    case "deep_block":
      return Math.max(0, ...activityRuns(minutesSinceAccept).map((r) => r.activeMinutes)) * 60;
    default:
      return 0;
  }
}

function lastMinutes(minutes: MinuteRow[], now: Date, count: number): MinuteRow[] {
  const cutoff = now.getTime() - count * 60_000;
  return minutes.filter((m) => m.t.getTime() >= cutoff);
}
