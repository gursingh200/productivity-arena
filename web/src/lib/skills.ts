// Skills radar (spec §6): pure functions, no database dependencies.
//
// Each axis has a raw measure (uncapped, on the absolute scale where 10 is the
// target). Scores are then either absolute (capped at 10) or relative: your
// percentile among a group (the team, or your guild), top = 10.

/** The daily_rollup fields the radar needs. */
export interface DailyRollup {
  day: string;
  humanSec: number;
  agentSec: number;
  longestFocusSec: number;
  focusBlocks: number;
  peakParallel: number;
  tokensOut: number;
}

export interface SkillsInput {
  dailyRollups: DailyRollup[];       // last 30 days
  weekdays: number;                   // count of weekdays in last 30 days
  questsOffered: number;
  questsCompleted: number;
  totalAgentWorkSec: number;          // total agent time, sub-agents counted separately (for Parallelism)
  guildContributionShare: number;     // 0-1, user's share of guild agent-hours
  guildSize: number;
  totalOutputTokens: number;          // for Intensity (over last 30d)
  totalAgentSec: number;              // for Intensity denominator
}

export interface SkillsRadar {
  willpower: number;      // 0–10
  consistency: number;    // 0–10
  endurance: number;      // 0–10
  orchestration: number;  // 0–10
  parallelism: number;    // 0–10
  competitive: number;    // 0–10
  camaraderie: number;    // 0–10
  intensity: number;      // 0–10
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
}

function cap10(v: number): number {
  return Math.min(10, v);
}

function raw(v: number): number {
  return Math.max(0, v);
}

// ---------------------------------------------------------------------------
// Main computation
// ---------------------------------------------------------------------------

/**
 * Computes the 8-axis skills radar from the last-30-days aggregated input.
 * All axes are 0–10; none can exceed 10.
 */
export function computeSkillsRadar(input: SkillsInput): SkillsRadar {
  const m = computeSkillMeasures(input);
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, cap10(v)])) as unknown as SkillsRadar;
}

/** The radar's measures on the absolute scale, not capped (so relative ranks keep their order above 10). */
export function computeSkillMeasures(input: SkillsInput): SkillsRadar {
  const {
    dailyRollups,
    weekdays,
    questsOffered,
    questsCompleted,
    totalAgentWorkSec,
    guildContributionShare,
    guildSize,
    totalOutputTokens,
    totalAgentSec,
  } = input;

  // willpower: median(longestFocusSec on active days) / 60 / 120 * 10
  const activeDayFocusSecs = dailyRollups
    .filter((d) => d.humanSec > 0)
    .map((d) => d.longestFocusSec);
  const willpower =
    activeDayFocusSecs.length === 0
      ? 0
      : raw((median(activeDayFocusSecs) / 60 / 120) * 10);

  // consistency: (days with humanSec >= 7200) / weekdays * 10
  const daysWithTwoHours = dailyRollups.filter((d) => d.humanSec >= 7200).length;
  const consistency =
    weekdays === 0 ? 0 : raw((daysWithTwoHours / weekdays) * 10);

  // endurance: avg humanSec on active days / 3600 / 8 * 10
  const activeDays = dailyRollups.filter((d) => d.humanSec > 0);
  const avgHumanSec =
    activeDays.length === 0
      ? 0
      : activeDays.reduce((sum, d) => sum + d.humanSec, 0) / activeDays.length;
  const endurance = raw((avgHumanSec / 3600 / 8) * 10);

  // orchestration: (totalAgentSec / totalHumanSec) * 10 / 3.0; 0 if no human activity
  const totalHumanSec = dailyRollups.reduce((sum, d) => sum + d.humanSec, 0);
  const orchestration =
    totalHumanSec === 0
      ? 0
      : raw((totalAgentSec / totalHumanSec) * (10 / 3.0));

  // parallelism: total agent hours / agent hours; 1× = 0, 3× = 10
  const parallelism = totalAgentSec === 0 ? 0 : raw(((Math.max(totalAgentWorkSec, totalAgentSec) / totalAgentSec - 1) / 2) * 10);

  // competitive: questsCompleted / questsOffered * 10; default 5 if no quests offered
  const competitive =
    questsOffered > 0
      ? raw((questsCompleted / questsOffered) * 10)
      : 5;

  // camaraderie: (guildContributionShare * guildSize) * 10
  // Equal share (1/guildSize) => 1/guildSize * guildSize * 10 = 10
  const camaraderie = raw(guildContributionShare * guildSize * 10);

  // intensity: (totalOutputTokens / (totalAgentSec / 3600)) / 200000 * 10; 0 if no agent activity
  const intensity =
    totalAgentSec === 0
      ? 0
      : raw((totalOutputTokens / (totalAgentSec / 3600) / 200000) * 10);

  return {
    willpower,
    consistency,
    endurance,
    orchestration,
    parallelism,
    competitive,
    camaraderie,
    intensity,
  };
}

/**
 * Relative score: where `mine` sits among `values` (everyone in the group,
 * including mine), 0–10. Ties count half. A group of one scores 10 if the
 * measure is above zero, else 0.
 */
export function percentileScore(mine: number, values: number[]): number {
  if (values.length <= 1) return mine > 0 ? 10 : 0;
  let below = 0;
  let equal = -1; // don't count yourself
  for (const v of values) {
    if (v < mine) below++;
    else if (v === mine) equal++;
  }
  return Math.round(((below + equal / 2) / (values.length - 1)) * 100) / 10;
}
