import { describe, expect, it } from "vitest";
import {
  dailyProgress,
  liveProgress,
  liveQuestToOffer,
  QUESTS,
  questDefinition,
  selectDailyQuests,
  selectGuildQuest,
  selectWeeklyQuests,
  weeklyProgress,
} from "@/lib/quest-engine";
import { activityRuns, currentRun, focusBlocks, type MinuteRow } from "@/lib/game/activity";

const T0 = new Date("2026-10-05T09:00:00Z");

/** `count` consecutive minutes from `startMin` minutes after T0. */
function run(startMin: number, count: number, fields: Partial<MinuteRow> = {}): MinuteRow[] {
  return Array.from({ length: count }, (_, i) => ({
    t: new Date(T0.getTime() + (startMin + i) * 60_000),
    humanSec: 60,
    meetingSec: 0,
    agentSec: 0,
    peak: 0,
    ...fields,
  }));
}
const at = (min: number) => new Date(T0.getTime() + min * 60_000);

describe("activity runs and focus blocks", () => {
  it("bridges gaps of up to 2 minutes and splits on longer ones (sparse input)", () => {
    const minutes = [...run(0, 10), ...run(12, 10), ...run(25, 5)];
    expect(activityRuns(minutes).map((r) => r.activeMinutes)).toEqual([20, 5]);
  });

  it("counts any minute with human time as active", () => {
    expect(activityRuns(run(0, 30, { humanSec: 0 }))).toEqual([]);
    expect(focusBlocks(run(0, 25, { humanSec: 1 }))).toHaveLength(1);
  });

  it("knows whether the latest run is still going", () => {
    const minutes = run(0, 50);
    expect(currentRun(minutes, at(51))?.activeMinutes).toBe(50);
    expect(currentRun(minutes, at(60))).toBeNull();
  });
});

describe("deterministic selection", () => {
  it("picks 3 distinct daily quests, stable per user and day", () => {
    const a = selectDailyQuests("u1", "2026-10-05", true);
    expect(a).toHaveLength(3);
    expect(new Set(a).size).toBe(3);
    expect(selectDailyQuests("u1", "2026-10-05", true)).toEqual(a);
    const days = ["2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"].map((d) => selectDailyQuests("u1", d, true).join());
    expect(new Set([a.join(), ...days]).size).toBeGreaterThan(1);
  });

  it("never picks Linear quests without Linear", () => {
    for (let i = 0; i < 50; i++) {
      expect(selectDailyQuests(`u${i}`, "2026-10-05", false)).not.toContain("linear_2");
      expect(selectWeeklyQuests(`u${i}`, "2026-10-05", false)).not.toContain("linear_8");
      expect(selectGuildQuest(`g${i}`, "2026-10-05", false)).not.toBe("guild_linear_40");
    }
  });

  it("every template has a definition matching its kind", () => {
    for (const [template, def] of Object.entries(QUESTS)) {
      expect(questDefinition(template)).toBe(def);
      expect(def.target).toBeGreaterThan(0);
    }
  });
});

describe("daily and weekly progress", () => {
  const ctx = (minutes: MinuteRow[], linearClosed = 0) => ({ timezone: "UTC", minutes, linearClosed });

  it("measures focus, agent time and blocks", () => {
    const minutes = [...run(0, 30, { agentSec: 120 }), ...run(40, 26)];
    expect(dailyProgress("focus_4h", ctx(minutes))).toBe(56 * 60);
    expect(dailyProgress("agents_6h", ctx(minutes))).toBe(30 * 120);
    expect(dailyProgress("two_blocks", ctx(minutes))).toBe(2);
    expect(dailyProgress("linear_2", ctx(minutes, 3))).toBe(3);
  });

  it("early_start counts active minutes before 10:00 local", () => {
    // T0 is 09:00 UTC; 70 minutes run until 10:10.
    expect(dailyProgress("early_start", ctx(run(0, 70)))).toBe(60 * 60);
    expect(dailyProgress("early_start", { timezone: "Asia/Kolkata", minutes: run(0, 70), linearClosed: 0 })).toBe(0);
  });

  it("counts call minutes towards focus quests and blocks", () => {
    // 15 minutes typing, then 15 minutes on a call with no typing.
    const minutes = [...run(0, 15), ...run(15, 15, { humanSec: 0, meetingSec: 60 })];
    expect(dailyProgress("focus_4h", ctx(minutes))).toBe(30 * 60);
    expect(focusBlocks(minutes)).toHaveLength(1);
  });

  it("parallel_3 uses the longest consecutive streak of 3+ sessions", () => {
    const minutes = [...run(0, 10, { peak: 3 }), ...run(10, 1, { peak: 2 }), ...run(11, 12, { peak: 4 })];
    expect(dailyProgress("parallel_3", ctx(minutes))).toBe(12 * 60);
  });

  it("weekly and guild progress sum days", () => {
    const days = [{ focusSec: 3 * 3600, agentSec: 10 * 3600 }, { focusSec: 3600, agentSec: 0 }, { focusSec: 7200, agentSec: 5 }];
    expect(weeklyProgress("focus_20h", { days, linearClosed: 0 })).toBe(6 * 3600);
    expect(weeklyProgress("guild_agents_300h", { days, linearClosed: 0 })).toBe(10 * 3600 + 5);
    expect(weeklyProgress("streak_5", { days, linearClosed: 0 })).toBe(2);
    expect(weeklyProgress("guild_linear_40", { days, linearClosed: 7 })).toBe(7);
  });
});

describe("live quests", () => {
  it("offers stay_longer after 45 active minutes in the current block", () => {
    expect(liveQuestToOffer(run(0, 44), at(44), new Set())).not.toBe("stay_longer");
    expect(liveQuestToOffer(run(0, 45), at(45), new Set())).toBe("stay_longer");
  });

  it("offers deep_block once the human has been active 10 minutes with no block yet", () => {
    expect(liveQuestToOffer(run(0, 9), at(9), new Set())).toBeNull();
    expect(liveQuestToOffer(run(0, 10), at(10), new Set())).toBe("deep_block");
  });

  it("offers parallel_push when an agent is running alongside the human", () => {
    const minutes = [...run(0, 30), ...run(30, 1, { peak: 1, agentSec: 30 })];
    expect(liveQuestToOffer(minutes, at(31), new Set(["deep_block"]))).toBe("parallel_push");
  });

  it("respects the cooldown and never offers to someone away from the keyboard", () => {
    expect(liveQuestToOffer(run(0, 45), at(45), new Set(["stay_longer", "deep_block", "parallel_push"]))).toBeNull();
    expect(liveQuestToOffer(run(0, 45), at(80), new Set())).toBeNull();
  });

  it("measures progress after accepting", () => {
    expect(liveProgress("stay_longer", run(0, 15))).toBe(900);
    expect(liveProgress("parallel_push", run(0, 10, { peak: 3 }))).toBe(600);
    expect(liveProgress("deep_block", [...run(0, 20), ...run(30, 50)])).toBe(3000);
  });
});
