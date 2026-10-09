/**
 * Achievements against the real Postgres (skipped without DATABASE_URL).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

const DB_URL = process.env.DATABASE_URL;

describe.skipIf(!DB_URL)("achievements", async () => {
  const { db } = await import("@/db");
  const schema = await import("@/db/schema");
  const { evaluateAchievements, recordEvent, globalRates, ACHIEVEMENTS } = await import("@/lib/achievements");
  let userId = "";

  beforeAll(async () => {
    const [u] = await db.insert(schema.users).values({ email: `ach-${Date.now()}@clueso.io`, handle: `ach${Date.now()}`, timezone: "UTC" }).returning();
    userId = u!.id;
    await db.insert(schema.dailyRollup).values([
      // A finished day: exactly 8h 00m, with a 100-minute block.
      { userId, day: "2026-09-01", humanSec: 8 * 3600, longestFocusSec: 100 * 60, agentSec: 0 },
      // Agents worked 5 hours while nobody was there, with 3 different agents.
      { userId, day: "2026-09-02", humanSec: 0, agentSec: 5 * 3600, agentSecByAgent: { claude: 3600, codex: 3600, cursor: 3600 } },
    ]);
  });

  afterAll(async () => {
    if (userId) await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  it("unlocks what the data shows, once", async () => {
    const first = await evaluateAchievements(userId, new Date("2026-09-10T12:00:00Z"));
    expect(first).toEqual(expect.arrayContaining(["first_steps", "first_agent", "deep_diver", "full_day", "right_on_time", "ghost", "polyglot"]));
    expect(first).not.toContain("zen");
    expect(await evaluateAchievements(userId, new Date("2026-09-10T12:00:00Z"))).toEqual([]);
  });

  it("Rivalry needs five different teammates compared", async () => {
    for (const t of ["a", "b", "c", "d"]) expect(await recordEvent(userId, "compare", t)).toEqual([]);
    expect(await recordEvent(userId, "compare", "d")).toEqual([]); // the same teammate again doesn't count
    expect(await recordEvent(userId, "compare", "e")).toEqual(["rivalry"]);
  });

  it("every achievement id is unique and global rates count unlocks", async () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
    const { counts } = await globalRates();
    expect(counts.get("ghost")).toBeGreaterThanOrEqual(1);
  });
});
