import { eq } from "drizzle-orm";
import { db } from "@/db";
import { linearAccounts } from "@/db/schema";
import { requireViewer } from "@/lib/viewer";
import LinearSettings from "../LinearSettings";

export default async function LinearSettingsPage() {
  const viewer = await requireViewer();
  const account = await db.query.linearAccounts.findFirst({ where: eq(linearAccounts.userId, viewer.id) });
  return (
    <div className="panel">
      <LinearSettings connected={Boolean(account)} lastSyncedAt={account?.lastSyncedAt ?? null} />
    </div>
  );
}
