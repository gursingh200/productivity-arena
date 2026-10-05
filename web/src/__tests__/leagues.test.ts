import { describe, expect, it } from "vitest";
import { nextLeagues, type League, type WeekResult } from "@/lib/leagues";

const person = (userId: string, league: League, weeklyXp: number, extra: Partial<WeekResult> = {}): WeekResult => ({
  userId, league, weeklyXp, focusSec: 10 * 3600, availableDays: 5, ...extra,
});
const leagueOf = (results: WeekResult[]) => {
  const next = nextLeagues(results);
  return Object.fromEntries(results.map((r) => [r.userId, next.get(r.userId)!.league]));
};

describe("small leagues use fixed thresholds", () => {
  it("one person climbs one league at a time, however much XP", () => {
    expect(leagueOf([person("a", "bronze", 99_999)])).toEqual({ a: "silver" });
  });

  it("moves up at the bar, down below the floor, otherwise stays", () => {
    expect(leagueOf([
      person("up", "silver", 1750), person("stay", "silver", 1749), person("down", "silver", 499),
    ])).toEqual({ up: "gold", stay: "silver", down: "bronze" });
  });

  it("Bronze never drops and Legend never rises", () => {
    expect(leagueOf([person("b", "bronze", 0), person("l", "legend", 99_999)])).toEqual({ b: "bronze", l: "legend" });
  });
});

describe("bigger leagues rank people against each other", () => {
  const silver = (xps: number[]) => xps.map((xp, i) => person(`s${i}`, "silver", xp));

  it("Silver: top 25% up, bottom 15% down", () => {
    // 8 people: ceil(8 × 0.25) = 2 up, ceil(8 × 0.15) = 2 down.
    expect(leagueOf(silver([800, 700, 600, 500, 400, 300, 200, 100]))).toEqual({
      s0: "gold", s1: "gold", s2: "silver", s3: "silver", s4: "silver", s5: "silver", s6: "bronze", s7: "bronze",
    });
  });

  it("Gold: the top need 1,500 XP to move up", () => {
    const gold = [1600, 1400, 1000, 900, 800].map((xp, i) => person(`g${i}`, "gold", xp));
    const next = leagueOf(gold);
    expect(next.g0).toBe("diamond"); // top 20% of 5 = 1 person, over the floor
    expect(next.g4).toBe("silver"); // bottom 20%
  });

  it("Legend: under 3,000 XP drops even when not in the bottom 30%", () => {
    const legend = [5000, 4500, 4000, 2900, 2800, 100].map((xp, i) => person(`l${i}`, "legend", xp));
    const next = leagueOf(legend);
    expect(next.l3).toBe("diamond");
    expect(next.l0).toBe("legend");
  });
});

describe("activity and away days", () => {
  it("under an hour of focus time moves you down", () => {
    expect(leagueOf([person("a", "gold", 5000, { focusSec: 3599 })])).toEqual({ a: "silver" });
  });

  it("a fully away week freezes the league", () => {
    const next = nextLeagues([person("a", "gold", 0, { focusSec: 0, availableDays: 0 })]);
    expect(next.get("a")).toEqual({ league: "gold", move: "frozen" });
  });

  it("away days shrink the bars", () => {
    // 2 of 5 days available: Silver's 1,750 bar becomes 700, the 1-hour bar 24 minutes.
    expect(leagueOf([person("a", "silver", 700, { availableDays: 2, focusSec: 1440 })])).toEqual({ a: "gold" });
  });

  it("ranks partly away people by XP per available day", () => {
    const group = [
      person("part", "bronze", 600, { availableDays: 1 }), // 600 a day
      ...[2000, 1500, 1000, 900, 800].map((xp, i) => person(`b${i}`, "bronze", xp)), // ≤ 400 a day
    ];
    const next = leagueOf(group);
    expect(next.part).toBe("silver");
    expect(next.b0).toBe("silver"); // top 30% of 6 = 2
    expect(next.b1).toBe("bronze");
  });
});
