/**
 * League computation — pure functions, no database dependencies.
 *
 * League for week W comes from the previous week's percentile among active users.
 * Active = >= 1 h human time (>= 3600 humanSec).
 *
 * Percentiles among active users (sorted descending by weeklyXp):
 *   top  5%  → legend
 *   next 15% → diamond  (cumulative 20%)
 *   next 30% → gold     (cumulative 50%)
 *   next 30% → silver   (cumulative 80%)
 *   rest     → bronze
 *
 * Ties share rank: users with equal weeklyXp receive the same league.
 * Inactive users (< 3600 humanSec) → bronze regardless of XP.
 * New / no-previous-week users start bronze (humanSec = 0 → bronze).
 */

export type League = "legend" | "diamond" | "gold" | "silver" | "bronze";

export interface UserWeeklyData {
  userId: string;
  weeklyXp: number;
  /** Total human-active seconds for the week. */
  humanSec: number;
}

const ACTIVITY_THRESHOLD_SEC = 3_600; // 1 hour

/**
 * Compute the league for every user in a single pass.
 *
 * @returns Map<userId, League>
 */
export function computeLeaguesForAll(allUsers: UserWeeklyData[]): Map<string, League> {
  const result = new Map<string, League>();

  const active = allUsers.filter((u) => u.humanSec >= ACTIVITY_THRESHOLD_SEC);
  const inactive = allUsers.filter((u) => u.humanSec < ACTIVITY_THRESHOLD_SEC);

  for (const u of inactive) {
    result.set(u.userId, "bronze");
  }

  if (active.length === 0) return result;

  const N = active.length;

  // Ceiling-based cutoffs ensure the top 5% always maps to at least 1 user
  // and handles edge cases like N=1 correctly.
  const legendCut = Math.ceil(N * 0.05);
  const diamondCut = Math.ceil(N * 0.20);
  const goldCut = Math.ceil(N * 0.50);
  const silverCut = Math.ceil(N * 0.80);

  for (const u of active) {
    // Competition ranking: rank = 1 + (count of active users with strictly higher XP)
    const rank = active.filter((o) => o.weeklyXp > u.weeklyXp).length + 1;

    let league: League;
    if (rank <= legendCut) {
      league = "legend";
    } else if (rank <= diamondCut) {
      league = "diamond";
    } else if (rank <= goldCut) {
      league = "gold";
    } else if (rank <= silverCut) {
      league = "silver";
    } else {
      league = "bronze";
    }

    result.set(u.userId, league);
  }

  return result;
}

/**
 * Convenience function: compute the league for a single user given all users'
 * previous-week data.
 */
export function computeLeague(
  userId: string,
  userXp: number,
  userHumanSec: number,
  allUsers: UserWeeklyData[],
): League {
  const map = computeLeaguesForAll(allUsers);
  // If the user isn't in allUsers, treat them as inactive
  return map.get(userId) ?? "bronze";
}

export const LEAGUE_LABELS: Record<League, string> = {
  legend: "Legend",
  diamond: "Diamond",
  gold: "Gold",
  silver: "Silver",
  bronze: "Bronze",
};
