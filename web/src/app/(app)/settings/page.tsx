import { eq } from "drizzle-orm";
import { db } from "@/db";
import { linearAccounts, users } from "@/db/schema";
import { requireViewer } from "@/lib/viewer";
import LinearSettings from "./LinearSettings";
import ProfileForm from "./ProfileForm";
import { SharingForm } from "@/components/SharingForm";
import { shares } from "@/lib/sharing";

export default async function SettingsPage() {
  const viewer = await requireViewer();
  const user = (await db.query.users.findFirst({ where: eq(users.id, viewer.id) }))!;
  const linearAccount = await db.query.linearAccounts.findFirst({ where: eq(linearAccounts.userId, viewer.id) });

  return (
    <div className="page-narrow" style={{ margin: "0 auto", maxWidth: 680 }}>
      <h1 className="page-title">Settings</h1>
      <p className="page-sub">Signed in as {user.email}.</p>

      <section className="settings-section">
        <h2 className="section-label" style={{ marginTop: 0 }}>Profile</h2>
        <div className="panel">
          <ProfileForm
            initialName={user.name ?? ""}
            initialHandle={user.handle ?? ""}
            initialBio={user.bio ?? ""}
            initialTimezone={user.timezone}
          />
        </div>
      </section>

      <section className="settings-section" id="sharing">
        <h2 className="section-label" style={{ marginTop: 0 }}>Sharing</h2>
        <div className="panel">
          <p className="rule"><b>Give to get.</b> You see a stat of someone else only if you share that stat too. Nobody can see more, admins included.</p>
          <SharingForm initial={shares(user)} submitLabel="Save sharing" />
        </div>
      </section>

      <section className="settings-section">
        <h2 className="section-label" style={{ marginTop: 0 }}>Linear</h2>
        <div className="panel">
          <LinearSettings connected={Boolean(linearAccount)} lastSyncedAt={linearAccount?.lastSyncedAt?.toISOString() ?? null} />
        </div>
      </section>
    </div>
  );
}
