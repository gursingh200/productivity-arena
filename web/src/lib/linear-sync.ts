/**
 * Linear issues reported by the Mac app (spec §8). The Mac keeps the Linear
 * API key in its Keychain and asks Linear itself; the server never sees the key.
 * It only receives each assigned issue's id, number, estimate and completion time.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { linearAccounts, linearIssues, users } from "@/db/schema";
import { recomputeLinearXp } from "@/lib/rollup";
import { toUserDay } from "@/lib/timezone";

export interface ReportedIssue {
  id: string;
  identifier: string;
  estimate: number | null;
  /** Set only while the issue is completed. */
  completedAt: Date | null;
}

/** Saves the issues, marks Linear as connected, and recomputes Linear XP for every day that changed. */
export async function applyLinearIssues(userId: string, issues: ReportedIssue[], now: Date = new Date()): Promise<void> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { timezone: true } });
  const timezone = user?.timezone ?? "UTC";

  const touchedDays = new Set<string>();
  for (const issue of issues) {
    // A completion can't be in the future.
    const completedAt = issue.completedAt && issue.completedAt <= now ? issue.completedAt : null;
    const previous = await db.query.linearIssues.findFirst({
      where: and(eq(linearIssues.userId, userId), eq(linearIssues.issueId, issue.id)),
      columns: { completedAt: true },
    });
    if (previous?.completedAt) touchedDays.add(toUserDay(previous.completedAt, timezone));
    if (completedAt) touchedDays.add(toUserDay(completedAt, timezone));

    const fields = { identifier: issue.identifier, estimate: issue.estimate === null ? null : Math.round(issue.estimate), completedAt };
    await db.insert(linearIssues)
      .values({ userId, issueId: issue.id, ...fields })
      .onConflictDoUpdate({ target: [linearIssues.userId, linearIssues.issueId], set: fields });
  }

  // Linear XP is derived per day in one place (rollup), including reversals.
  for (const day of touchedDays) await recomputeLinearXp(userId, day, timezone);

  await db.insert(linearAccounts).values({ userId, lastSyncedAt: now })
    .onConflictDoUpdate({ target: [linearAccounts.userId], set: { lastSyncedAt: now } });
}

/** Linear is disconnected on the Mac. XP already earned stays. */
export async function disconnectLinear(userId: string): Promise<void> {
  await db.delete(linearAccounts).where(eq(linearAccounts.userId, userId));
}
