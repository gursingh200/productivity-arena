/**
 * League ladder (spec §4) — pure functions, no database.
 *
 * Everyone starts in Bronze. After each week, people move at most one league:
 *
 * - A league with fewer than RELATIVE_MIN_PEOPLE active people uses fixed
 *   weekly XP thresholds (ABSOLUTE): up at `up`, down below `down`.
 * - A bigger league ranks its people against each other (RELATIVE): the top
 *   `upShare` move up if they also reach `upFloor` XP, the bottom `downShare`
 *   move down, and in Legend anyone under `keepFloor` XP moves down too.
 * - Under 1 hour of focus time that week moves you down one league.
 * - Away days: a fully away week freezes your league and leaves you out of
 *   the ranking; some days away shrink every XP bar (and the 1-hour bar) to
 *   the share of weekdays you were available, and ranking uses XP per
 *   available day.
 */

export type League = "legend" | "diamond" | "gold" | "silver" | "bronze";

export const LADDER: League[] = ["bronze", "silver", "gold", "diamond", "legend"];

export const LEAGUE_LABELS: Record<League, string> = {
  legend: "Legend",
  diamond: "Diamond",
  gold: "Gold",
  silver: "Silver",
  bronze: "Bronze",
};

/** Weekdays a full week has; away days are counted out of these. */
export const WORK_DAYS = 5;
/** Below this much focus time in a (full) week, you move down. */
export const ACTIVE_MIN_FOCUS_SEC = 3600;
/** Leagues with fewer active people than this use the fixed thresholds. */
export const RELATIVE_MIN_PEOPLE = 5;

/** Small leagues: weekly XP to move up, and below which you move down. */
export const ABSOLUTE: Record<League, { up: number | null; down: number | null }> = {
  bronze: { up: 1000, down: null },
  silver: { up: 1750, down: 500 },
  gold: { up: 2500, down: 1000 },
  diamond: { up: 3250, down: 1750 },
  legend: { up: null, down: 2500 },
};

/** Bigger leagues: shares that move up and down, and XP floors. */
export const RELATIVE: Record<League, { upShare: number; downShare: number; upFloor: number; keepFloor: number }> = {
  bronze: { upShare: 0.3, downShare: 0, upFloor: 0, keepFloor: 0 },
  silver: { upShare: 0.25, downShare: 0.15, upFloor: 0, keepFloor: 0 },
  gold: { upShare: 0.2, downShare: 0.2, upFloor: 1500, keepFloor: 0 },
  diamond: { upShare: 0.15, downShare: 0.25, upFloor: 2500, keepFloor: 0 },
  legend: { upShare: 0, downShare: 0.3, upFloor: 0, keepFloor: 3000 },
};

export interface WeekResult {
  userId: string;
  /** League held during the finished week. */
  league: League;
  weeklyXp: number;
  /** Human + call time that week. */
  focusSec: number;
  /** Weekdays (of WORK_DAYS) the person was available. */
  availableDays: number;
}

export type Move = "up" | "down" | "stay" | "frozen";

const step = (league: League, by: number): League =>
  LADDER[Math.min(LADDER.length - 1, Math.max(0, LADDER.indexOf(league) + by))]!;

/** Next week's league for everyone in `results`, with why. */
export function nextLeagues(results: WeekResult[]): Map<string, { league: League; move: Move }> {
  const out = new Map<string, { league: League; move: Move }>();
  const set = (r: WeekResult, move: Move) =>
    out.set(r.userId, { league: move === "up" ? step(r.league, 1) : move === "down" ? step(r.league, -1) : r.league, move });

  const ranked: WeekResult[] = [];
  for (const r of results) {
    const available = Math.max(0, Math.min(WORK_DAYS, r.availableDays));
    if (available === 0) set(r, "frozen");
    else if (r.focusSec < ACTIVE_MIN_FOCUS_SEC * (available / WORK_DAYS)) set(r, "down");
    else ranked.push(r);
  }

  for (const league of LADDER) {
    const group = ranked.filter((r) => r.league === league);
    if (group.length === 0) continue;
    const share = (r: WeekResult) => Math.max(0, Math.min(WORK_DAYS, r.availableDays)) / WORK_DAYS;

    if (group.length < RELATIVE_MIN_PEOPLE) {
      const { up, down } = ABSOLUTE[league];
      for (const r of group) {
        if (up !== null && r.weeklyXp >= up * share(r)) set(r, "up");
        else if (down !== null && r.weeklyXp < down * share(r)) set(r, "down");
        else set(r, "stay");
      }
      continue;
    }

    const rule = RELATIVE[league];
    const n = group.length;
    const upCount = Math.ceil(n * rule.upShare);
    const downCount = Math.ceil(n * rule.downShare);
    // XP per available day, so partly away people aren't penalised; ties share a rank.
    const perDay = (r: WeekResult) => r.weeklyXp / Math.max(1, r.availableDays);
    const sorted = [...group].sort((a, b) => perDay(b) - perDay(a));
    let rank = 0;
    sorted.forEach((r, i) => {
      if (i === 0 || perDay(sorted[i - 1]!) !== perDay(r)) rank = i + 1;
      const fromBottom = n - rank + 1; // 1 = (tied for) last
      if (rank <= upCount && r.weeklyXp >= rule.upFloor * share(r)) set(r, "up");
      else if ((downCount > 0 && fromBottom <= downCount && rank > upCount) || r.weeklyXp < rule.keepFloor * share(r)) set(r, "down");
      else set(r, "stay");
    });
  }
  return out;
}
