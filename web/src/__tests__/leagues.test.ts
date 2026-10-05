import { describe, it, expect } from "vitest";
import { computeLeaguesForAll, type UserWeeklyData } from "@/lib/leagues";

function makeUsers(count: number, xpFn: (i: number) => number, humanSec = 7200): UserWeeklyData[] {
  return Array.from({ length: count }, (_, i) => ({
    userId: `user-${i}`,
    weeklyXp: xpFn(i),
    humanSec,
  }));
}

describe("computeLeaguesForAll", () => {
  it("returns empty map for empty input", () => {
    const result = computeLeaguesForAll([]);
    expect(result.size).toBe(0);
  });

  it("marks a single inactive user as bronze", () => {
    const users: UserWeeklyData[] = [
      { userId: "u1", weeklyXp: 9999, humanSec: 3599 }, // 1 sec below 1h
    ];
    const result = computeLeaguesForAll(users);
    expect(result.get("u1")).toBe("bronze");
  });

  it("marks a single active user (>= 1h) as legend (top 5% of 1)", () => {
    const users: UserWeeklyData[] = [
      { userId: "u1", weeklyXp: 500, humanSec: 3600 },
    ];
    const result = computeLeaguesForAll(users);
    expect(result.get("u1")).toBe("legend");
  });

  it("threshold: exactly 3600 humanSec → active (legend with 1 user)", () => {
    const users: UserWeeklyData[] = [
      { userId: "u1", weeklyXp: 100, humanSec: 3600 },
    ];
    const result = computeLeaguesForAll(users);
    expect(result.get("u1")).toBe("legend");
  });

  it("threshold: 3599 humanSec → inactive → bronze", () => {
    const users: UserWeeklyData[] = [
      { userId: "u1", weeklyXp: 9999, humanSec: 3599 },
    ];
    const result = computeLeaguesForAll(users);
    expect(result.get("u1")).toBe("bronze");
  });

  it("inactive users always get bronze, even with high XP", () => {
    const users: UserWeeklyData[] = [
      { userId: "active", weeklyXp: 100, humanSec: 7200 },
      { userId: "inactive-high", weeklyXp: 9999, humanSec: 0 },
    ];
    const result = computeLeaguesForAll(users);
    expect(result.get("inactive-high")).toBe("bronze");
    expect(result.get("active")).toBe("legend"); // only active user
  });

  describe("20 active users — exact percentile boundaries", () => {
    // Users sorted by XP descending (user-0 = highest XP = rank 1)
    // For N=20: legend≤1, diamond≤4, gold≤10, silver≤16, bronze=17-20
    const users = makeUsers(20, (i) => 1000 - i * 10); // all distinct XP

    it("rank 1 (top 5%) → legend", () => {
      const result = computeLeaguesForAll(users);
      expect(result.get("user-0")).toBe("legend"); // 1000 XP
    });

    it("ranks 2–4 (next 15%) → diamond", () => {
      const result = computeLeaguesForAll(users);
      expect(result.get("user-1")).toBe("diamond"); // 990 XP
      expect(result.get("user-2")).toBe("diamond"); // 980 XP
      expect(result.get("user-3")).toBe("diamond"); // 970 XP
    });

    it("ranks 5–10 (next 30%) → gold", () => {
      const result = computeLeaguesForAll(users);
      expect(result.get("user-4")).toBe("gold");  // 960 XP
      expect(result.get("user-9")).toBe("gold");  // 910 XP
    });

    it("ranks 11–16 (next 30%) → silver", () => {
      const result = computeLeaguesForAll(users);
      expect(result.get("user-10")).toBe("silver"); // 900 XP
      expect(result.get("user-15")).toBe("silver"); // 850 XP
    });

    it("ranks 17–20 (bottom 20%) → bronze", () => {
      const result = computeLeaguesForAll(users);
      expect(result.get("user-16")).toBe("bronze"); // 840 XP
      expect(result.get("user-19")).toBe("bronze"); // 810 XP
    });
  });

  it("users with identical XP receive the same league (ties)", () => {
    // 3 users with the same XP → all rank 1 → all legend (for N=3, ceil(3*0.05)=1)
    // Actually with N=3: legendCut=ceil(0.15)=1. All have rank 1 → legend
    // Let's use N=20 with a tie at the top
    const users: UserWeeklyData[] = [
      ...makeUsers(18, (i) => 500 - i * 10), // distinct XP 500,490,...,330
      { userId: "tie-a", weeklyXp: 1000, humanSec: 7200 },
      { userId: "tie-b", weeklyXp: 1000, humanSec: 7200 },
    ];
    const result = computeLeaguesForAll(users);
    // Both tied-top users should get the same league
    expect(result.get("tie-a")).toBe(result.get("tie-b"));
  });

  it("inactive users do not affect the percentile rank of active users", () => {
    // 1 active + 10 inactive → active user should be legend (1 active user)
    const users: UserWeeklyData[] = [
      { userId: "active", weeklyXp: 100, humanSec: 7200 },
      ...Array.from({ length: 10 }, (_, i) => ({
        userId: `inactive-${i}`,
        weeklyXp: 9999, // high XP but inactive
        humanSec: 0,
      })),
    ];
    const result = computeLeaguesForAll(users);
    expect(result.get("active")).toBe("legend");
  });

  it("all users with equal XP get the same league", () => {
    const users = makeUsers(10, () => 500); // all same XP → all rank 1
    const result = computeLeaguesForAll(users);
    // All should have the same league (legend, since rank 1 for all)
    const leagues = [...result.values()];
    expect(new Set(leagues).size).toBe(1);
    expect(leagues[0]).toBe("legend");
  });
});
