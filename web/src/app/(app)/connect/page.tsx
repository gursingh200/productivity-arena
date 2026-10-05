import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { devices } from "@/db/schema";
import { requireViewer } from "@/lib/viewer";
import Link from "next/link";
import { DownloadButton } from "@/components/DownloadButton";
import ConnectDevice from "./ConnectDevice";

function date(d: Date) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function lastSeen(d: Date | null) {
  if (!d) return "Never synced";
  const min = Math.round((Date.now() - d.getTime()) / 60_000);
  if (min < 2) return "Synced just now";
  if (min < 60) return `Synced ${min}m ago`;
  if (min < 48 * 60) return `Synced ${Math.round(min / 60)}h ago`;
  return `Last synced ${date(d)}`;
}

export default async function ConnectPage() {
  const viewer = await requireViewer();
  const userDevices = await db.query.devices.findMany({
    where: and(eq(devices.userId, viewer.id), isNull(devices.revokedAt)),
    orderBy: [desc(devices.createdAt)],
  });

  return (
    <div className="page-narrow" style={{ margin: "0 auto", maxWidth: 680 }}>
      <h1 className="page-title">Connect your Mac</h1>
      <p className="page-sub">Arena runs in the menu bar and sends your active time and agent time once a minute.</p>

      <ol className="steps">
        <li>
          <div className="step-title">Install Arena</div>
          <p className="help">
            Open Arena.app once. It lives in the menu bar and starts at login.{" "}
            <Link href="/download">Install help, or let your AI install it</Link>.
          </p>
          <div className="pair"><DownloadButton className="btn btn-sm btn-quiet" /></div>
        </li>
        <li>
          <div className="step-title">Link it to your account</div>
          <ConnectDevice />
        </li>
      </ol>

      <h2 className="section-label">Your devices</h2>
      <div className="panel">
        {userDevices.length === 0 ? <div className="empty">No devices yet. Link your Mac above to start tracking.</div> : null}
        {userDevices.map((d) => (
          <div className="device-row" key={d.id}>
            <i className={`status-dot${d.lastSeenAt ? " on" : ""}`} aria-hidden />
            <div>
              <div className="device-name">{d.name}</div>
              <div className="help">
                {lastSeen(d.lastSeenAt)}{d.agentVersion ? `, version ${d.agentVersion}` : ""}. Added {date(d.createdAt)}.
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
