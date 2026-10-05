/**
 * League ladder saved week by week, and away-day rules, against the real
 * Postgres (skipped without DATABASE_URL). Uses weeks in 2030 so it can't
 * collide with other data.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, like } from "drizzle-orm";

const DB_URL = process.env.DATABASE_URL;

describe.skipIf(!DB_URL)("league ladder and away days", async () => {
  const { db } = await import("@/db");
  const schema = await import("@/db/schema");
  const { leaguesForWeek, setAway, awayInWeek } = await import("@/lib/league-db");

  const W1 = "2030-01-07"; // a Monday
  const W2 = "2030-01-14";
  const W3 = "2030-01-21";
  const stamp = Date.now();
  let climber = "";
  let resting = "";

  beforeAll(async () => {
    process.env.ARENA_START_DATE = W1;
    process.env.ARENA_TIMEZONE = "UTC";
    const rows = await db.insert(schema.users).values([
      { email: `ladder-a-${stamp}@clueso.io`, handle: `laddera${stamp}` },
      { email: `ladder-b-${stamp}@clueso.io`, handle: `ladderb${stamp}` },
    ]).returning();
    climber = rows[0]!.id;
    resting = rows[1]!.id;
    // Week 1: the climber earns 1,200 XP with 5 hours of focus.
    await db.insert(schema.xpLedger).values({ userId: climber, day: "2030-01-08", source: "focus", sourceKey: `focus:${stamp}`, xp: 1200, reason: "test", rulesVersion: 1 });
    await db.insert(schema.dailyRollup).values({ userId: climber, day: "2030-01-08", humanSec: 5 * 3600 });
  });

  afterAll(async () => {
    delete process.env.ARENA_START_DATE;
    delete process.env.ARENA_TIMEZONE;
    await db.delete(schema.leagueWeeks).where(like(schema.leagueWeeks.weekStart, "2030-%"));
    await db.delete(schema.users).where(inArray(schema.users.id, [climber, resting]));
  });

  it("everyone starts in Bronze, then moves one league on last week's XP, and it's saved", async () => {
    expect((await leaguesForWeek(W1, new Date("2030-01-08T12:00:00Z"))).size).toBe(0); // first week: all Bronze
    const week2 = await leaguesForWeek(W2, new Date("2030-01-15T12:00:00Z"));
    expect(week2.get(climber)).toEqual({ league: "silver", move: "up" });
    expect(week2.get(resting)?.league).toBe("bronze");
    const saved = await db.select().from(schema.leagueWeeks).where(eq(schema.leagueWeeks.userId, climber));
    expect(saved.map((r) => r.weekStart)).toEqual([W2]);
  });

  it("this week's away days change only on Monday", async () => {
    expect(await setAway(resting, "this", ["2030-01-16"], new Date("2030-01-15T12:00:00Z"))).toEqual({ ok: false, error: "monday_only" });
    expect(await setAway(resting, "this", ["2030-01-16"], new Date("2030-01-14T12:00:00Z"))).toEqual({ ok: true });
    expect(await awayInWeek(resting, W2)).toEqual(["2030-01-16"]);
    expect(await setAway(resting, "next", ["2030-01-26"], new Date("2030-01-14T12:00:00Z"))).toEqual({ ok: false, error: "not_a_weekday" });
  });

  it("allows at most two whole weeks away in a row", async () => {
    const whole = (week: string) => [0, 1, 2, 3, 4].map((i) => new Date(Date.parse(week) + i * 86_400_000).toISOString().slice(0, 10));
    expect(await setAway(resting, "this", whole(W2), new Date("2030-01-14T12:00:00Z"))).toEqual({ ok: true });
    expect(await setAway(resting, "next", whole(W3), new Date("2030-01-14T12:00:00Z"))).toEqual({ ok: true });
    expect(await setAway(resting, "next", whole("2030-01-28"), new Date("2030-01-21T12:00:00Z"))).toEqual({ ok: false, error: "too_many_weeks" });
    await db.delete(schema.awayDays).where(eq(schema.awayDays.userId, resting));
  });
});
