/**
 * Leaderboard history (spec §4): finished boards are saved with only the people
 * sharing each category, and read back with give-to-get applied.
 * Runs against the real Postgres; skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import type { Visibility } from "@/lib/sharing";

const DB_URL = process.env.DATABASE_URL;
const none: Visibility = { xp: false, human: false, agents: false, meetings: false, apps: false, skills: false };
const all: Visibility = { xp: true, human: true, agents: true, meetings: true, apps: true, skills: true };

describe.skipIf(!DB_URL)("leaderboard history", async () => {
  const { db } = await import("@/db");
  const schema = await import("@/db/schema");
  const { readHistory, savePeriod } = await import("@/lib/history");
  const { sharingColumns } = await import("@/lib/sharing");

  // A week long before any other data, so nothing else lands on its boards.
  const WEEK = "2020-01-06";
  const stamp = Date.now();
  const ids: string[] = [];
  const person = async (name: string, v: Visibility, humanSec: number, xp: number) => {
    const [u] = await db.insert(schema.users).values({
      email: `hist-${name}-${stamp}@clueso.io`, name: `${name} ${stamp}`, handle: `hist${name}${stamp}`, ...sharingColumns(v),
    }).returning();
    ids.push(u!.id);
    await db.insert(schema.dailyRollup).values({ userId: u!.id, day: "2020-01-07", humanSec, agentSec: humanSec * 2, meetingSec: 600 });
    await db.insert(schema.xpLedger).values({ userId: u!.id, day: "2020-01-07", source: "focus", sourceKey: `focus:hist:${stamp}`, xp, reason: "test" });
    return u!;
  };
  let alice: typeof schema.users.$inferSelect;
  let bob: typeof schema.users.$inferSelect;
  let hidden: typeof schema.users.$inferSelect;

  beforeAll(async () => {
    alice = await person("alice", all, 9000, 300);
    bob = await person("bob", { ...none, human: true }, 12000, 500);
    hidden = await person("hidden", none, 50000, 900);
    await savePeriod("week", WEEK, "2020-01-13");
  });

  afterAll(async () => {
    await db.delete(schema.periodTotals).where(and(eq(schema.periodTotals.period, "week"), eq(schema.periodTotals.periodStart, WEEK)));
    await db.delete(schema.leaderboardHistory).where(eq(schema.leaderboardHistory.periodStart, WEEK));
    if (ids.length) await db.delete(schema.users).where(inArray(schema.users.id, ids));
  });

  const week = async (viewer: typeof alice, board: "xp" | "human" | "agents") => {
    const h = await readHistory(viewer, "week", board, "all", 500);
    if (h.locked) return null;
    return h.periods.find((p) => p.start === WEEK)!;
  };

  it("saves only people who share the board's category, ranked by value", async () => {
    const human = (await week(alice, "human"))!;
    expect(human.rows.map((r) => r.userId)).toEqual([bob.id, alice.id]);
    expect(human.rows.map((r) => r.rank)).toEqual([1, 2]);
    const xp = (await week(alice, "xp"))!;
    expect(xp.rows.map((r) => r.userId)).toEqual([alice.id]);
  });

  it("locks boards for categories the reader doesn't share", async () => {
    expect(await week(bob, "xp")).toBeNull();
    expect(await week(bob, "human")).not.toBeNull();
  });

  it("gives team totals only for shared categories, summed over sharers", async () => {
    const p = (await week(bob, "human"))!;
    expect(p.totals.human).toEqual({ value: 21000, people: 2 });
    expect(p.totals.xp).toBeNull();
    expect(p.totals.agents).toBeNull();
  });

  it("drops people from past boards once they stop sharing", async () => {
    await db.update(schema.users).set({ shareHuman: false }).where(eq(schema.users.id, bob.id));
    const human = (await week(alice, "human"))!;
    expect(human.rows.map((r) => r.userId)).toEqual([alice.id]);
    await db.update(schema.users).set({ shareHuman: true }).where(eq(schema.users.id, bob.id));
  });

  it("never lists someone who didn't share at save time", async () => {
    for (const board of ["xp", "human", "agents"] as const) {
      const p = await week(alice, board);
      expect(p?.rows.some((r) => r.userId === hidden.id) ?? false).toBe(false);
    }
  });
});
