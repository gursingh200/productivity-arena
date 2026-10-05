/**
 * XP Engine — pure functions, no database dependencies.
 * All calculations are deterministic and unit-testable in isolation.
 * rules_version: 1
 */

import { activityRuns, activeMinuteCount, FOCUS_BLOCK_MIN, isActive, minuteIndex, type MinuteRow } from "@/lib/game/activity";

export type { MinuteRow };

export interface DailyXpResult {
  focusXp: number;
  focusReason: string;
  agentXp: number;
  agentReason: string;
  orchestrationXp: number;
  orchestrationReason: string;
  activeMinutes: number;
  focusBlocks: number;
  longestFocusSec: number;
}

// ---------------------------------------------------------------------------
// Focus XP
// ---------------------------------------------------------------------------

export interface FocusXpResult {
  xp: number;
  reason: string;
  blocks: number;
  longestBlockSec: number;
  activeMinutes: number;
}

/**
 * Compute focus XP from an array of minute rows for a single day.
 *
 * A minute is "active" if humanSec >= 30.
 * Base: 1 XP per active minute up to 480; 0.5 XP per minute beyond 480.
 * Block bonus: +15 XP per block of ≥ 25 contiguous active minutes
 *   (gaps of ≤ 2 inactive minutes are allowed within a block).
 */
export function computeFocusXp(minutes: MinuteRow[]): FocusXpResult {
  const runs = activityRuns(minutes);
  const qualifying = runs.filter((b) => b.activeMinutes >= FOCUS_BLOCK_MIN);
  const longestBlockSec = runs.reduce(
    (best, b) => Math.max(best, (b.end.getTime() - b.start.getTime()) / 1000), 0);
  const activeMinutes = activeMinuteCount(minutes);
  if (activeMinutes === 0) {
    return { xp: 0, reason: "No activity", blocks: 0, longestBlockSec: 0, activeMinutes: 0 };
  }

  const baseXp = Math.min(activeMinutes, 480) + Math.max(0, activeMinutes - 480) * 0.5;
  const blockBonus = qualifying.length * 15;
  const blocksText = qualifying.length === 1 ? "1 focus block" : `${qualifying.length} focus blocks`;
  const reason = `${activeMinutes} active minutes${qualifying.length > 0 ? `, ${blocksText}` : ""}`;

  return { xp: baseXp + blockBonus, reason, blocks: qualifying.length, longestBlockSec, activeMinutes };
}

// ---------------------------------------------------------------------------
// Agent XP
// ---------------------------------------------------------------------------

export interface AgentXpResult {
  xp: number;
  reason: string;
}

const AGENT_XP_CAP = 300;

/**
 * Compute agent XP from an array of minute rows for a single day.
 *
 * 0.25 XP per agent-minute (agentSec / 60 rounded to whole minutes).
 * Cap: 300 XP/day.
 */
export function computeAgentXp(minutes: MinuteRow[]): AgentXpResult {
  const totalAgentSec = minutes.reduce((sum, r) => sum + r.agentSec, 0);
  const agentMinutes = Math.round(totalAgentSec / 60);
  const rawXp = agentMinutes * 0.25;
  const xp = Math.min(rawXp, AGENT_XP_CAP);
  const capped = rawXp > AGENT_XP_CAP;

  const reason = `${agentMinutes} agent-minutes${capped ? ` (daily cap of ${AGENT_XP_CAP} XP)` : ""}`;
  return { xp, reason };
}

// ---------------------------------------------------------------------------
// Orchestration XP
// ---------------------------------------------------------------------------

export interface OrchestrationXpResult {
  xp: number;
  reason: string;
}

const ORCHESTRATION_XP_CAP = 150;

/**
 * Compute orchestration XP from an array of minute rows for a single day.
 *
 * A minute qualifies if:
 *   - peak >= 2 (multiple concurrent agents)
 *   - a human-active minute (humanSec >= 30) exists within ±5 min of it
 *
 * 0.5 XP per qualifying minute. Cap: 150 XP/day.
 */
export function computeOrchestrationXp(minutes: MinuteRow[]): OrchestrationXpResult {
  if (minutes.length === 0) {
    return { xp: 0, reason: "No activity" };
  }

  // Build a set of minute indices where the human was active
  const activeHumanIndices = new Set(minutes.filter(isActive).map((r) => minuteIndex(r.t)));

  let qualifyingMinutes = 0;

  for (const r of minutes) {
    if (r.peak < 2) continue;

    const minuteIdx = minuteIndex(r.t);
    // Check ±5 min window for human activity
    let humanNearby = false;
    for (let offset = -5; offset <= 5; offset++) {
      if (activeHumanIndices.has(minuteIdx + offset)) {
        humanNearby = true;
        break;
      }
    }
    if (humanNearby) qualifyingMinutes++;
  }

  const rawXp = qualifyingMinutes * 0.5;
  const xp = Math.min(rawXp, ORCHESTRATION_XP_CAP);
  const capped = rawXp > ORCHESTRATION_XP_CAP;

  const reason =
    `${qualifyingMinutes} minutes running 2+ agents while you worked` +
    (capped ? ` (daily cap of ${ORCHESTRATION_XP_CAP} XP)` : "");
  return { xp, reason };
}

// ---------------------------------------------------------------------------
// Linear XP
// ---------------------------------------------------------------------------

export interface LinearIssue {
  issueId: string;
  /** Human-readable key such as "ENG-142"; falls back to issueId. */
  identifier?: string;
  estimate: number | null;
  completedAt: Date;
}

export interface LinearXpRow {
  issueId: string;
  day: string;
  xp: number;
  reason: string;
}

export const LINEAR_XP_CAP_PER_DAY = 400;

/**
 * XP for completed Linear issues: 20 + 15 × estimate (missing estimate = 1).
 * Issues are grouped by `dayOf(completedAt)` (the user's local day); a day's
 * total is scaled down proportionally to stay within 400 XP.
 * Reopened issues are handled by the caller (their row drops to 0 XP).
 */
export function computeLinearXp(
  issues: LinearIssue[],
  dayOf: (d: Date) => string = (d) => d.toISOString().slice(0, 10),
): LinearXpRow[] {
  const byDay = new Map<string, LinearIssue[]>();
  for (const issue of issues) {
    const day = dayOf(issue.completedAt);
    byDay.set(day, [...(byDay.get(day) ?? []), issue]);
  }

  const results: LinearXpRow[] = [];
  for (const [day, dayIssues] of byDay) {
    const raw = dayIssues.map((i) => 20 + 15 * (i.estimate ?? 1));
    const total = raw.reduce((s, x) => s + x, 0);
    const scale = total > LINEAR_XP_CAP_PER_DAY ? LINEAR_XP_CAP_PER_DAY / total : 1;
    dayIssues.forEach((issue, i) => {
      const xp = Math.round(raw[i]! * scale);
      results.push({
        issueId: issue.issueId,
        day,
        xp,
        reason: `Closed ${issue.identifier ?? issue.issueId}, estimate ${issue.estimate ?? 1}` +
          (scale < 1 ? ` (daily cap of ${LINEAR_XP_CAP_PER_DAY} XP shared across issues)` : ""),
      });
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Weekly Score
// ---------------------------------------------------------------------------

/**
 * Sum XP ledger rows that fall within a given week range.
 * weekStart / weekEnd are Mon 00:00 and next Mon 00:00 (in the user's timezone),
 * expressed as YYYY-MM-DD date strings.
 */
export function computeWeeklyScore(
  rows: Array<{ day: string; xp: number }>,
  weekStartDay: string,
  weekEndDay: string,
): number {
  return rows
    .filter((r) => r.day >= weekStartDay && r.day < weekEndDay)
    .reduce((sum, r) => sum + r.xp, 0);
}
