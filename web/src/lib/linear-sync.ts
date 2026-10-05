/**
 * Linear GraphQL sync.
 * Uses plain fetch — no Linear SDK needed.
 */
import { db } from "@/db";
import { linearAccounts, linearIssues, users } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { decryptApiKey } from "@/lib/linear-crypto";
import { toUserDay } from "@/lib/timezone";
import { recomputeLinearXp } from "@/lib/rollup";

const LINEAR_GRAPHQL = "https://api.linear.app/graphql";
const SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

const ASSIGNED_ISSUES_QUERY = `
  query AssignedIssues($since: DateTime) {
    viewer {
      id
      assignedIssues(
        filter: { updatedAt: { gte: $since } }
        first: 250
      ) {
        nodes {
          id
          identifier
          title
          estimate
          completedAt
          url
          state {
            type
          }
        }
      }
    }
  }
`;

interface LinearIssueNode {
  id: string;
  identifier: string;
  title: string;
  estimate: number | null;
  completedAt: string | null;
  url: string;
  state: { type: string } | null;
}

interface LinearResponse {
  data?: {
    viewer?: {
      id: string;
      assignedIssues?: {
        nodes: LinearIssueNode[];
      };
    };
  };
  errors?: Array<{ message: string }>;
}

async function callLinear(apiKey: string, query: string, variables: Record<string, unknown>): Promise<LinearResponse> {
  const res = await fetch(LINEAR_GRAPHQL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`Linear API error: ${res.status}`);
  }

  return res.json() as Promise<LinearResponse>;
}

export async function syncLinearIfNeeded(userId: string): Promise<void> {
  const account = await db.query.linearAccounts.findFirst({
    where: eq(linearAccounts.userId, userId),
  });

  if (!account) return;

  const now = new Date();
  if (
    account.lastSyncedAt &&
    now.getTime() - account.lastSyncedAt.getTime() < SYNC_INTERVAL_MS
  ) {
    return; // Not time yet
  }

  await syncLinear(userId);
}

export async function syncLinear(userId: string): Promise<void> {
  const account = await db.query.linearAccounts.findFirst({
    where: eq(linearAccounts.userId, userId),
  });

  if (!account) return;

  let apiKey: string;
  try {
    apiKey = decryptApiKey(account.apiKeyEnc);
  } catch {
    return; // Bad key, skip
  }

  const since = account.lastSyncedAt
    ? new Date(account.lastSyncedAt.getTime() - 24 * 60 * 60 * 1000) // Go back 1 day
    : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // 90 days on first sync

  const response = await callLinear(apiKey, ASSIGNED_ISSUES_QUERY, {
    since: since.toISOString(),
  });

  if (response.errors?.length) {
    throw new Error(response.errors[0]?.message ?? "Linear API error");
  }

  const viewer = response.data?.viewer;
  if (!viewer) return;

  // Update linear_user_id if needed
  if (!account.linearUserId) {
    await db
      .update(linearAccounts)
      .set({ linearUserId: viewer.id })
      .where(eq(linearAccounts.userId, userId));
  }

  const nodes = viewer.assignedIssues?.nodes ?? [];

  // Get user timezone for day bucketing
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { timezone: true },
  });
  const timezone = user?.timezone ?? "UTC";

  // Upsert issues, remembering which local days gained or lost a completion.
  const touchedDays = new Set<string>();
  for (const node of nodes) {
    const isCompleted = node.state?.type === "completed" && node.completedAt != null;
    const completedAt = isCompleted ? new Date(node.completedAt!) : null;

    const previous = await db.query.linearIssues.findFirst({
      where: and(eq(linearIssues.userId, userId), eq(linearIssues.issueId, node.id)),
      columns: { completedAt: true },
    });
    if (previous?.completedAt) touchedDays.add(toUserDay(previous.completedAt, timezone));
    if (completedAt) touchedDays.add(toUserDay(completedAt, timezone));

    const fields = { identifier: node.identifier, title: node.title, estimate: node.estimate, completedAt, url: node.url };
    await db
      .insert(linearIssues)
      .values({ userId, issueId: node.id, ...fields })
      .onConflictDoUpdate({ target: [linearIssues.userId, linearIssues.issueId], set: fields });
  }

  // Linear XP is derived per day in one place (rollup), including reversals.
  for (const day of touchedDays) await recomputeLinearXp(userId, day, timezone);

  // Update last synced
  await db
    .update(linearAccounts)
    .set({ lastSyncedAt: new Date() })
    .where(eq(linearAccounts.userId, userId));
}
