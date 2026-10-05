/**
 * Shared definitions of "active" human time and focus blocks, used by XP,
 * quests and skills so they always agree (spec §4, §5).
 *
 * Minute arrays may be sparse: minutes with no activity are simply absent.
 * Everything here works on minute indices, never on array positions.
 */

export interface MinuteRow {
  t: Date;
  /** Human-active seconds in the minute outside calls (0–60). */
  humanSec: number;
  /** Seconds in a call (0–60). humanSec + meetingSec ≤ 60: a call wins the minute. */
  meetingSec: number;
  /** Agent seconds summed over parallel sessions (can exceed 60). */
  agentSec: number;
  /** Concurrent agent sessions in the minute, summed across agents. */
  peak: number;
}

/**
 * A minute counts as active when it has any focus time: human time (the Mac
 * app sends a full 60 s for every minute with keyboard, mouse or dictation
 * input) or call time. XP, focus blocks and quests all use this.
 */
export const ACTIVE_MINUTE_SEC = 1;

/** Human plus call seconds: the time that counts for XP and quests. */
export function focusSec(m: MinuteRow): number {
  return m.humanSec + m.meetingSec;
}
/** Inactive minutes allowed inside a focus block. */
export const BLOCK_MAX_GAP_MIN = 2;
/** Active minutes needed for a block to count as a focus block. */
export const FOCUS_BLOCK_MIN = 25;

export interface FocusBlock {
  start: Date;
  /** Exclusive end (start of the minute after the last active minute). */
  end: Date;
  activeMinutes: number;
}

export function minuteIndex(t: Date): number {
  return Math.floor(t.getTime() / 60_000);
}

export function isActive(m: MinuteRow): boolean {
  return focusSec(m) >= ACTIVE_MINUTE_SEC;
}

/** Every run of active minutes (gaps ≤ 2 min), including short ones. */
export function activityRuns(minutes: MinuteRow[]): FocusBlock[] {
  const active = [...new Set(minutes.filter(isActive).map((m) => minuteIndex(m.t)))].sort((a, b) => a - b);
  const runs: FocusBlock[] = [];
  let first = -1;
  let last = -1;
  let count = 0;
  for (const idx of active) {
    if (count > 0 && idx - last <= BLOCK_MAX_GAP_MIN + 1) {
      last = idx;
      count++;
      continue;
    }
    if (count > 0) runs.push(toBlock(first, last, count));
    first = idx;
    last = idx;
    count = 1;
  }
  if (count > 0) runs.push(toBlock(first, last, count));
  return runs;
}

/** Runs with at least 25 active minutes. */
export function focusBlocks(minutes: MinuteRow[]): FocusBlock[] {
  return activityRuns(minutes).filter((b) => b.activeMinutes >= FOCUS_BLOCK_MIN);
}

/** The run that is still going at `now` (last active minute within the gap allowance), if any. */
export function currentRun(minutes: MinuteRow[], now: Date): FocusBlock | null {
  const runs = activityRuns(minutes);
  const last = runs[runs.length - 1];
  if (!last) return null;
  const minutesSinceEnd = minuteIndex(now) - (minuteIndex(last.end) - 1);
  return minutesSinceEnd <= BLOCK_MAX_GAP_MIN + 1 ? last : null;
}

export function activeMinuteCount(minutes: MinuteRow[]): number {
  return minutes.filter(isActive).length;
}

/** Minutes where at least `sessions` agent sessions ran concurrently. */
export function parallelMinutes(minutes: MinuteRow[], sessions: number): number {
  return minutes.filter((m) => m.peak >= sessions).length;
}

/** Longest run of consecutive minutes with at least `sessions` concurrent sessions. */
export function longestParallelStreak(minutes: MinuteRow[], sessions: number): number {
  const idx = minutes.filter((m) => m.peak >= sessions).map((m) => minuteIndex(m.t)).sort((a, b) => a - b);
  let best = 0;
  let current = 0;
  for (let i = 0; i < idx.length; i++) {
    current = i > 0 && idx[i]! - idx[i - 1]! === 1 ? current + 1 : 1;
    best = Math.max(best, current);
  }
  return best;
}

function toBlock(first: number, last: number, count: number): FocusBlock {
  return { start: new Date(first * 60_000), end: new Date((last + 1) * 60_000), activeMinutes: count };
}
