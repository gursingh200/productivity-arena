import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { devices } from "@/db/schema";
import { downloadUrl, isOlderVersion, latestRelease } from "@/lib/download";

/** "Update available!" when the viewer's most recently seen Mac is behind the latest release. */
export async function UpdateBanner({ userId }: { userId: string }) {
  const latest = await latestRelease();
  if (!latest) return null;
  const mac = await db.query.devices.findFirst({
    where: and(eq(devices.userId, userId), isNull(devices.revokedAt), isNotNull(devices.agentVersion)),
    orderBy: [desc(devices.lastSeenAt)],
    columns: { name: true, agentVersion: true },
  });
  if (!mac?.agentVersion || !isOlderVersion(mac.agentVersion, latest.version)) return null;
  const dmg = downloadUrl();
  return (
    <div className="update-banner" role="status">
      <div>
        <b>Update available!</b> Arena {latest.version} is out; {mac.name} has {mac.agentVersion}. Choose Check for Updates
        in Arena’s menu, or download it.
      </div>
      {dmg ? <a className="btn btn-sm" href={dmg}>Download {latest.version}</a> : null}
    </div>
  );
}
