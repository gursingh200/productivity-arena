import { describe, it, expect } from 'vitest';
import { computeSkillMeasures, computeSkillsRadar, percentileScore } from '../lib/skills';
import type { SkillsInput, DailyRollup } from '../lib/skills';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeRollup(
  day: string,
  humanSec: number,
  agentSec: number,
  longestFocusSec = 0,
  focusBlocks = 0,
  peakParallel = 0,
  tokensOut = 0
): DailyRollup {
  return { day, humanSec, agentSec, longestFocusSec, focusBlocks, peakParallel, tokensOut };
}

const zeroInput: SkillsInput = {
  dailyRollups: [],
  weekdays: 20,
  questsOffered: 0,
  questsCompleted: 0,
  totalAgentWorkSec: 0,
  guildContributionShare: 0,
  guildSize: 1,
  totalOutputTokens: 0,
  totalAgentSec: 0,
};

// ---------------------------------------------------------------------------
// Zero / baseline
// ---------------------------------------------------------------------------

describe('computeSkillsRadar — zero data', () => {
  it('willpower is 0 with no activity', () => {
    expect(computeSkillsRadar(zeroInput).willpower).toBe(0);
  });

  it('consistency is 0 with no active days', () => {
    expect(computeSkillsRadar(zeroInput).consistency).toBe(0);
  });

  it('endurance is 0 with no active days', () => {
    expect(computeSkillsRadar(zeroInput).endurance).toBe(0);
  });

  it('orchestration is 0 when no human activity', () => {
    expect(computeSkillsRadar(zeroInput).orchestration).toBe(0);
  });

  it('parallelism is 0 with no agent time', () => {
    expect(computeSkillsRadar(zeroInput).parallelism).toBe(0);
  });

  it('competitive defaults to 5 when no quests offered', () => {
    expect(computeSkillsRadar(zeroInput).competitive).toBe(5);
  });

  it('camaraderie is 0 with zero guild contribution', () => {
    expect(computeSkillsRadar(zeroInput).camaraderie).toBe(0);
  });

  it('intensity is 0 with no agent activity', () => {
    expect(computeSkillsRadar(zeroInput).intensity).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// willpower
// ---------------------------------------------------------------------------

describe('computeSkillsRadar — willpower', () => {
  it('120-min median focus block => 10', () => {
    const rollups = [makeRollup('2024-01-15', 7200, 0, 120 * 60)];
    expect(computeSkillsRadar({ ...zeroInput, dailyRollups: rollups }).willpower).toBe(10);
  });

  it('60-min median focus block => 5', () => {
    const rollups = [makeRollup('2024-01-15', 7200, 0, 60 * 60)];
    expect(computeSkillsRadar({ ...zeroInput, dailyRollups: rollups }).willpower).toBeCloseTo(5, 5);
  });

  it('30-min median focus block => 2.5', () => {
    const rollups = [makeRollup('2024-01-15', 7200, 0, 30 * 60)];
    expect(computeSkillsRadar({ ...zeroInput, dailyRollups: rollups }).willpower).toBeCloseTo(2.5, 5);
  });

  it('capped at 10 even for very long focus blocks', () => {
    const rollups = [makeRollup('2024-01-15', 7200, 0, 600 * 60)]; // 10-hour block
    expect(computeSkillsRadar({ ...zeroInput, dailyRollups: rollups }).willpower).toBe(10);
  });

  it('uses median, not average, across multiple days', () => {
    // median of [60, 60, 120] = 60 => score = 5
    const rollups = [
      makeRollup('2024-01-15', 7200, 0, 60 * 60),
      makeRollup('2024-01-16', 7200, 0, 60 * 60),
      makeRollup('2024-01-17', 7200, 0, 120 * 60),
    ];
    expect(computeSkillsRadar({ ...zeroInput, dailyRollups: rollups }).willpower).toBeCloseTo(5, 5);
  });

  it('ignores inactive days (humanSec=0) when computing median', () => {
    // Only 1 active day with 120-min block; other day is inactive
    const rollups = [
      makeRollup('2024-01-15', 7200, 0, 120 * 60),
      makeRollup('2024-01-16', 0, 0, 0), // inactive
    ];
    expect(computeSkillsRadar({ ...zeroInput, dailyRollups: rollups }).willpower).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// consistency
// ---------------------------------------------------------------------------

describe('computeSkillsRadar — consistency', () => {
  it('100% weekdays with >= 2h => 10', () => {
    const rollups = Array.from({ length: 20 }, (_, i) =>
      makeRollup(`2024-01-${String(i + 1).padStart(2, '0')}`, 7200, 0)
    );
    expect(computeSkillsRadar({ ...zeroInput, dailyRollups: rollups, weekdays: 20 }).consistency).toBe(10);
  });

  it('50% weekdays with >= 2h => 5', () => {
    const rollups = [
      makeRollup('2024-01-15', 7200, 0),
      makeRollup('2024-01-16', 3600, 0), // < 2h
    ];
    expect(computeSkillsRadar({ ...zeroInput, dailyRollups: rollups, weekdays: 2 }).consistency).toBeCloseTo(5, 5);
  });

  it('exactly 7200 s counts as a qualifying day', () => {
    const rollups = [makeRollup('2024-01-15', 7200, 0)];
    expect(computeSkillsRadar({ ...zeroInput, dailyRollups: rollups, weekdays: 1 }).consistency).toBe(10);
  });

  it('7199 s does not count as a qualifying day', () => {
    const rollups = [makeRollup('2024-01-15', 7199, 0)];
    expect(computeSkillsRadar({ ...zeroInput, dailyRollups: rollups, weekdays: 1 }).consistency).toBe(0);
  });

  it('0 weekdays returns 0 (no division by zero)', () => {
    const rollups = [makeRollup('2024-01-15', 7200, 0)];
    expect(computeSkillsRadar({ ...zeroInput, dailyRollups: rollups, weekdays: 0 }).consistency).toBe(0);
  });

  it('capped at 10', () => {
    // More qualifying days than weekdays (shouldn't happen in practice, but test the cap)
    const rollups = [
      makeRollup('2024-01-15', 7200, 0),
      makeRollup('2024-01-16', 7200, 0),
    ];
    expect(computeSkillsRadar({ ...zeroInput, dailyRollups: rollups, weekdays: 1 }).consistency).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// endurance
// ---------------------------------------------------------------------------

describe('computeSkillsRadar — endurance', () => {
  it('average 8h on active days => 10', () => {
    const rollups = [makeRollup('2024-01-15', 8 * 3600, 0)];
    expect(computeSkillsRadar({ ...zeroInput, dailyRollups: rollups }).endurance).toBe(10);
  });

  it('average 4h on active days => 5', () => {
    const rollups = [makeRollup('2024-01-15', 4 * 3600, 0)];
    expect(computeSkillsRadar({ ...zeroInput, dailyRollups: rollups }).endurance).toBeCloseTo(5, 5);
  });

  it('capped at 10 for > 8h average', () => {
    const rollups = [makeRollup('2024-01-15', 16 * 3600, 0)];
    expect(computeSkillsRadar({ ...zeroInput, dailyRollups: rollups }).endurance).toBe(10);
  });

  it('inactive days (humanSec=0) are excluded from the average', () => {
    const rollups = [
      makeRollup('2024-01-15', 8 * 3600, 0), // active
      makeRollup('2024-01-16', 0, 0),          // inactive
    ];
    // avg = 8h => endurance = 10
    expect(computeSkillsRadar({ ...zeroInput, dailyRollups: rollups }).endurance).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// orchestration
// ---------------------------------------------------------------------------

describe('computeSkillsRadar — orchestration', () => {
  it('3× agent hours vs human hours => 10', () => {
    const rollups = [makeRollup('2024-01-15', 3600, 0)]; // 1h human
    const input: SkillsInput = { ...zeroInput, dailyRollups: rollups, totalAgentSec: 3 * 3600 };
    expect(computeSkillsRadar(input).orchestration).toBe(10);
  });

  it('1.5× agent vs human => 5', () => {
    const rollups = [makeRollup('2024-01-15', 3600, 0)];
    const input: SkillsInput = { ...zeroInput, dailyRollups: rollups, totalAgentSec: 1.5 * 3600 };
    expect(computeSkillsRadar(input).orchestration).toBeCloseTo(5, 5);
  });

  it('returns 0 when humanSec is 0 (no division by zero)', () => {
    const input: SkillsInput = { ...zeroInput, dailyRollups: [], totalAgentSec: 3600 };
    expect(computeSkillsRadar(input).orchestration).toBe(0);
  });

  it('capped at 10 when agent/human ratio > 3.0', () => {
    const rollups = [makeRollup('2024-01-15', 3600, 0)];
    const input: SkillsInput = { ...zeroInput, dailyRollups: rollups, totalAgentSec: 10 * 3600 };
    expect(computeSkillsRadar(input).orchestration).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// parallelism
// ---------------------------------------------------------------------------

describe('computeSkillsRadar — parallelism', () => {
  const agents = (clockH: number, totalH: number) =>
    computeSkillsRadar({ ...zeroInput, totalAgentSec: clockH * 3600, totalAgentWorkSec: totalH * 3600 }).parallelism;

  it('one thing at a time (1×) => 0', () => expect(agents(10, 10)).toBe(0));
  it('2× => 5', () => expect(agents(10, 20)).toBeCloseTo(5, 5));
  it('3× and above => 10', () => expect(agents(10, 50)).toBe(10));
  it('total below clock time counts as 1×', () => expect(agents(10, 5)).toBe(0));
});

describe('percentileScore', () => {
  it('top of the group is 10, bottom is 0, ties count half', () => {
    expect(percentileScore(9, [1, 5, 9])).toBe(10);
    expect(percentileScore(1, [1, 5, 9])).toBe(0);
    expect(percentileScore(5, [1, 5, 9])).toBe(5);
    expect(percentileScore(5, [5, 5, 5])).toBe(5);
  });

  it('alone: 10 if you have any, else 0', () => {
    expect(percentileScore(3, [3])).toBe(10);
    expect(percentileScore(0, [0])).toBe(0);
  });

  it('measures keep their order above the absolute cap', () => {
    const big = computeSkillMeasures({ ...zeroInput, totalAgentSec: 10 * 3600, totalAgentWorkSec: 60 * 3600 }).parallelism;
    expect(big).toBeGreaterThan(10);
  });
});

// ---------------------------------------------------------------------------
// competitive
// ---------------------------------------------------------------------------

describe('computeSkillsRadar — competitive', () => {
  it('100% quest completion => 10', () => {
    const input: SkillsInput = { ...zeroInput, questsOffered: 10, questsCompleted: 10 };
    expect(computeSkillsRadar(input).competitive).toBe(10);
  });

  it('50% quest completion => 5', () => {
    const input: SkillsInput = { ...zeroInput, questsOffered: 10, questsCompleted: 5 };
    expect(computeSkillsRadar(input).competitive).toBeCloseTo(5, 5);
  });

  it('defaults to 5 when no quests have been offered', () => {
    expect(computeSkillsRadar({ ...zeroInput, questsOffered: 0, questsCompleted: 0 }).competitive).toBe(5);
  });

  it('capped at 10 (in case completions > offered due to data lag)', () => {
    const input: SkillsInput = { ...zeroInput, questsOffered: 5, questsCompleted: 10 };
    expect(computeSkillsRadar(input).competitive).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// camaraderie
// ---------------------------------------------------------------------------

describe('computeSkillsRadar — camaraderie', () => {
  it('equal share in a guild of 10 => 10', () => {
    // equal share = 1/10 = 0.1; score = 0.1 * 10 * 10 = 10
    const input: SkillsInput = { ...zeroInput, guildContributionShare: 0.1, guildSize: 10 };
    expect(computeSkillsRadar(input).camaraderie).toBe(10);
  });

  it('half the equal share in a guild of 10 => 5', () => {
    // 0.05 * 10 * 10 = 5
    const input: SkillsInput = { ...zeroInput, guildContributionShare: 0.05, guildSize: 10 };
    expect(computeSkillsRadar(input).camaraderie).toBeCloseTo(5, 5);
  });

  it('over-contribution is capped at 10', () => {
    // 0.5 * 10 * 10 = 50 => capped at 10
    const input: SkillsInput = { ...zeroInput, guildContributionShare: 0.5, guildSize: 10 };
    expect(computeSkillsRadar(input).camaraderie).toBe(10);
  });

  it('equal share in a solo guild (guildSize=1) => 10', () => {
    // 1.0 * 1 * 10 = 10
    const input: SkillsInput = { ...zeroInput, guildContributionShare: 1.0, guildSize: 1 };
    expect(computeSkillsRadar(input).camaraderie).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// intensity
// ---------------------------------------------------------------------------

describe('computeSkillsRadar — intensity', () => {
  it('200K tokens per agent-hour => 10', () => {
    const input: SkillsInput = {
      ...zeroInput,
      totalOutputTokens: 200_000,
      totalAgentSec: 3600, // 1 hour
    };
    expect(computeSkillsRadar(input).intensity).toBe(10);
  });

  it('100K tokens per agent-hour => 5', () => {
    const input: SkillsInput = {
      ...zeroInput,
      totalOutputTokens: 100_000,
      totalAgentSec: 3600,
    };
    expect(computeSkillsRadar(input).intensity).toBeCloseTo(5, 5);
  });

  it('returns 0 when totalAgentSec is 0 (no division by zero)', () => {
    const input: SkillsInput = {
      ...zeroInput,
      totalOutputTokens: 100_000,
      totalAgentSec: 0,
    };
    expect(computeSkillsRadar(input).intensity).toBe(0);
  });

  it('capped at 10 for very high token rate', () => {
    const input: SkillsInput = {
      ...zeroInput,
      totalOutputTokens: 1_000_000,
      totalAgentSec: 3600,
    };
    expect(computeSkillsRadar(input).intensity).toBe(10);
  });

  it('works correctly across multiple agent hours', () => {
    // 400K tokens over 2 hours = 200K/hr => 10
    const input: SkillsInput = {
      ...zeroInput,
      totalOutputTokens: 400_000,
      totalAgentSec: 2 * 3600,
    };
    expect(computeSkillsRadar(input).intensity).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// All values are in [0, 10] range
// ---------------------------------------------------------------------------

describe('computeSkillsRadar — boundary', () => {
  it('all axes are between 0 and 10 for typical heavy-usage data', () => {
    const rollups = Array.from({ length: 30 }, (_, i) =>
      makeRollup(
        `2024-01-${String((i % 28) + 1).padStart(2, '0')}`,
        28_800,  // 8h human
        14_400,  // 4h agent
        7_200,   // 120-min focus block
        2,
        3,
        50_000
      )
    );
    const result = computeSkillsRadar({
      dailyRollups: rollups,
      weekdays: 22,
      questsOffered: 15,
      questsCompleted: 12,
      totalAgentWorkSec: 80 * 3600,
      guildContributionShare: 0.1,
      guildSize: 10,
      totalOutputTokens: 500_000,
      totalAgentSec: 50 * 3600,
    });

    for (const [axis, value] of Object.entries(result)) {
      expect(value, `${axis} should be >= 0`).toBeGreaterThanOrEqual(0);
      expect(value, `${axis} should be <= 10`).toBeLessThanOrEqual(10);
    }
  });

  it('all axes are 0 or 5 (competitive default) with truly empty input', () => {
    const result = computeSkillsRadar(zeroInput);
    for (const [axis, value] of Object.entries(result)) {
      if (axis === 'competitive') {
        expect(value).toBe(5);
      } else {
        expect(value, `${axis} should be 0`).toBe(0);
      }
    }
  });
});
