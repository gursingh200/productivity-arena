import { eq } from "drizzle-orm";
import { db } from "@/db";
import { linearAccounts, users } from "@/db/schema";
import { requireViewer } from "@/lib/viewer";
import AwayForm from "./AwayForm";
import LinearSettings from "./LinearSettings";
import { awayInWeek, workDays } from "@/lib/league-db";
import { companyTimezone, weekDays } from "@/lib/standings";
import { toUserDay } from "@/lib/timezone";
import ProfileForm from "./ProfileForm";
import { SharingForm } from "@/components/SharingForm";
import { shares } from "@/lib/sharing";

export default async function SettingsPage() {
  const viewer = await requireViewer();
  const user = (await db.query.users.findFirst({ where: eq(users.id, viewer.id) }))!;
  const linearAccount = await db.query.linearAccounts.findFirst({ where: eq(linearAccounts.userId, viewer.id) });
  const now = new Date();
  const { thisWeek, nextWeek } = weekDays(now);
  const isMonday = toUserDay(now, companyTimezone()) === thisWeek;
  const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", day: "numeric", timeZone: "UTC" });
  const awayWeeks = await Promise.all(([["this", thisWeek, "This week"], ["next", nextWeek, "Next week"]] as const).map(async ([key, week, label]) => ({
    key, label, locked: key === "this" && !isMonday,
    days: workDays(week).map((day) => ({ day, label: dayLabel(day) })),
    away: await awayInWeek(viewer.id, week),
  })));

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

      <section className="settings-section" id="away">
        <h2 className="section-label" style={{ marginTop: 0 }}>Away</h2>
        <div className="panel">
          <p className="help" style={{ marginTop: 0 }}>
            Mark weekdays you’re away. A whole week away keeps your league as it is; some days away lower the XP you need
            in proportion. Teammates see “Away” on those days. At most two whole weeks in a row.
          </p>
          <AwayForm weeks={awayWeeks} />
        </div>
      </section>

      <section className="settings-section">
        <h2 className="section-label" style={{ marginTop: 0 }}>Linear</h2>
        <div className="panel">
          <LinearSettings connected={Boolean(linearAccount)} lastSyncedAt={linearAccount?.lastSyncedAt ?? null} />
        </div>
      </section>
    </div>
  );
}
